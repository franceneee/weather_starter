import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    AreaResolutionError,
    WeatherProviderError,
    type ForecastArea,
    type WeatherSnapshot,
} from '../weather.js';

const bishan: ForecastArea = {
    key: 'bishan',
    name: 'Bishan',
    latitude: 1.3508,
    longitude: 103.839,
};

const weather: WeatherSnapshot = {
    condition: 'Cloudy',
    observed_at: '2026-05-04T00:00:00Z',
    source: 'test',
    area: 'Bishan',
    valid_period_text: 'Now',
    temperature_c: 29,
    humidity_percent: 80,
    rainfall_mm: 0,
    wind_speed_knots: 4,
    wind_direction_degrees: 180,
    forecast_low_c: 25,
    forecast_high_c: 32,
    uv_index: 7,
    psi_twenty_four_hourly: 42,
    pm25_one_hourly: 9,
    air_quality_region: 'central',
    forecast_periods: [{ label: 'Now', forecast: 'Cloudy' }],
    daily_forecast: [
        { date: '2026-05-04', forecast: 'Cloudy', temperature_low_c: 25, temperature_high_c: 32 },
    ],
};

describe('locations API', () => {
    let tempDir: string;
    let app: Awaited<ReturnType<typeof import('../server.js').createApp>>;
    let resolveArea: (latitude: number, longitude: number) => Promise<ForecastArea>;
    let getWeather: (latitude: number, longitude: number) => Promise<WeatherSnapshot>;
    let resetStore: () => Promise<void>;
    let closeStore: () => void;

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'weather-starter-test-'));
        process.env.DATABASE_PATH = join(tempDir, 'weather.db');
        process.env.LOG_LEVEL = 'silent';
        const server = await import('../server.js');
        ({ resetStore, closeStore } = await import('../db.js'));
        app = await server.createApp({
            serveFrontend: false,
            enableRequestLogging: false,
            areaResolver: { resolveForecastArea: (lat, lon) => resolveArea(lat, lon) },
            weatherClient: { getCurrentWeather: (lat, lon) => getWeather(lat, lon) },
        });
    });

    beforeEach(async () => {
        await resetStore();
        resolveArea = async () => bishan;
        getWeather = async () => weather;
    });

    afterAll(async () => {
        closeStore();
        await rm(tempDir, { recursive: true, force: true });
    });

    it('persists canonical identity and coordinates rather than precise device coordinates', async () => {
        const response = await request(app)
            .post('/api/locations')
            .send({ latitude: 1.35123456, longitude: 103.84876543 })
            .expect(201);

        expect(response.body).toMatchObject({
            id: 1,
            canonical_area_key: 'bishan',
            canonical_area_name: 'Bishan',
            latitude: bishan.latitude,
            longitude: bishan.longitude,
            weather: { condition: 'Cloudy', area: 'Bishan' },
        });
        expect(JSON.stringify(response.body)).not.toContain('1.35123456');
        expect(JSON.stringify(response.body)).not.toContain('103.84876543');
    });

    it('deduplicates GPS jitter by canonical area and refreshes the existing row', async () => {
        await request(app)
            .post('/api/locations')
            .send({ latitude: 1.35, longitude: 103.84 })
            .expect(201);

        const response = await request(app)
            .post('/api/locations')
            .send({ latitude: 1.352, longitude: 103.842 })
            .expect(200);

        expect(response.body.id).toBe(1);
        const list = await request(app).get('/api/locations').expect(200);
        expect(list.body.locations).toHaveLength(1);
    });

    it('rejects coordinates outside Singapore before area resolution', async () => {
        let called = false;
        resolveArea = async () => {
            called = true;
            return bishan;
        };
        await request(app)
            .post('/api/locations')
            .send({ latitude: 51.5, longitude: -0.1 })
            .expect(422);
        expect(called).toBe(false);
        expect((await request(app).get('/api/locations')).body.locations).toHaveLength(0);
    });

    it('returns a retryable error and writes nothing when area resolution fails', async () => {
        resolveArea = async () => {
            throw new AreaResolutionError('offline');
        };
        const response = await request(app)
            .post('/api/locations')
            .send({ latitude: 1.35, longitude: 103.84 })
            .expect(503);
        expect(response.body.retryable).toBe(true);
        expect((await request(app).get('/api/locations')).body.locations).toHaveLength(0);
    });

    it('keeps a resolved area with an area-labelled empty snapshot when weather fails', async () => {
        getWeather = async () => {
            throw new WeatherProviderError('offline');
        };
        const response = await request(app)
            .post('/api/locations')
            .send({ latitude: 1.35, longitude: 103.84 })
            .expect(201);
        expect(response.body.weather).toMatchObject({
            condition: 'Not refreshed',
            source: 'not-refreshed',
            area: 'Bishan',
        });
        expect((await request(app).get('/api/locations')).body.locations).toHaveLength(1);
    });
});

describe('canonical-area migration', () => {
    it('backfills representative legacy rows before creating uniqueness', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'weather-migration-test-'));
        const sqlite = new DatabaseSync(join(tempDir, 'legacy.db'));
        try {
            for (const file of ['0000_dusty_gladiator.sql', '0001_canonical_forecast_areas.sql']) {
                const sql = await readFile(join(process.cwd(), 'backend', 'drizzle', file), 'utf8');
                if (file.startsWith('0000')) {
                    sqlite.exec(sql.replaceAll('--> statement-breakpoint', ''));
                    sqlite
                        .prepare(
                            "INSERT INTO locations (latitude, longitude, created_at, area, forecast_periods, daily_forecast) VALUES (?, ?, ?, ?, '[]', '[]')"
                        )
                        .run(1.35, 103.84, '2026-01-01', 'Bishan');
                } else {
                    sqlite.exec(sql.replaceAll('--> statement-breakpoint', ''));
                }
            }
            const row = sqlite
                .prepare('SELECT canonical_area_key, canonical_area_name FROM locations')
                .get();
            expect(row).toMatchObject({
                canonical_area_key: 'bishan',
                canonical_area_name: 'Bishan',
            });
        } finally {
            sqlite.close();
            await rm(tempDir, { recursive: true, force: true });
        }
    });
});
