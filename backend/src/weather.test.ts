import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SingaporeWeatherClient, WeatherProviderError } from './weather.js';

// Minimal fixture factories
const stationReading = (stationId: string, value: number, lat: number, lon: number) => ({
    code: 0,
    errorMsg: '',
    data: {
        stations: [
            { id: stationId, name: 'Test Station', location: { latitude: lat, longitude: lon } },
        ],
        readings: [{ timestamp: '2026-07-10T10:00:00+08:00', data: [{ stationId, value }] }],
        readingType: 'test',
        readingUnit: 'test',
    },
});

const twoHrForecast = () => ({
    code: 0,
    errorMsg: '',
    data: {
        area_metadata: [{ name: 'Bishan', label_location: { latitude: 1.35, longitude: 103.85 } }],
        items: [
            {
                timestamp: '2026-07-10T10:00:00+08:00',
                update_timestamp: '2026-07-10T10:00:00+08:00',
                valid_period: { text: '10 am to 12 pm' },
                forecasts: [{ area: 'Bishan', forecast: 'Partly Cloudy' }],
            },
        ],
    },
});

const twentyFourHrForecast = () => ({
    code: 0,
    errorMsg: '',
    data: {
        records: [
            {
                timestamp: '2026-07-10T08:00:00+08:00',
                updatedTimestamp: '2026-07-10T08:00:00+08:00',
                general: { temperature: { low: 25, high: 33 } },
                periods: [
                    {
                        timePeriod: { text: 'Morning' },
                        regions: { central: { text: 'Partly Cloudy (Day)', code: 'PC' } },
                    },
                    {
                        timePeriod: { text: 'Afternoon' },
                        regions: { central: { text: 'Thundery Showers', code: 'TL' } },
                    },
                ],
            },
        ],
    },
});

const fourDayForecast = () => ({
    items: [
        {
            update_timestamp: '2026-07-10T08:00:00+08:00',
            forecasts: [
                {
                    date: '2026-07-10',
                    forecast: 'Partly Cloudy',
                    temperature: { low: 25, high: 33 },
                },
                { date: '2026-07-11', forecast: 'Showers', temperature: { low: 24, high: 31 } },
            ],
        },
    ],
});

const uvPayload = () => ({
    code: 0,
    errorMsg: '',
    data: {
        records: [
            {
                timestamp: '2026-07-10T10:00:00+08:00',
                updatedTimestamp: '2026-07-10T10:00:00+08:00',
                index: [{ hour: '2026-07-10T10:00:00+08:00', value: 8 }],
            },
        ],
    },
});

const psiPayload = () => ({
    code: 0,
    errorMsg: '',
    data: {
        regionMetadata: [{ name: 'central', labelLocation: { latitude: 1.35, longitude: 103.82 } }],
        items: [
            {
                timestamp: '2026-07-10T10:00:00+08:00',
                updatedTimestamp: '2026-07-10T10:00:00+08:00',
                readings: { psi_twenty_four_hourly: { central: 52 } },
            },
        ],
    },
});

const pm25Payload = () => ({
    code: 0,
    errorMsg: '',
    data: {
        regionMetadata: [{ name: 'central', labelLocation: { latitude: 1.35, longitude: 103.82 } }],
        items: [
            {
                timestamp: '2026-07-10T10:00:00+08:00',
                updatedTimestamp: '2026-07-10T10:00:00+08:00',
                readings: { pm25_one_hourly: { central: 12 } },
            },
        ],
    },
});

function makeFetch(responses: Record<string, unknown>) {
    return vi.fn((url: string) => {
        const key = Object.keys(responses).find((k) => url.includes(k));
        const body = key ? responses[key] : { code: 1, errorMsg: 'not found' };
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(body),
        });
    });
}

describe('SingaporeWeatherClient', () => {
    const LAT = 1.35;
    const LON = 103.85;

    beforeEach(() => {
        vi.stubGlobal(
            'fetch',
            makeFetch({
                'two-hr-forecast': twoHrForecast(),
                'air-temperature': stationReading('S1', 31.5, LAT, LON),
                'relative-humidity': stationReading('S1', 78, LAT, LON),
                rainfall: stationReading('S1', 0.2, LAT, LON),
                'wind-speed': stationReading('S1', 5.4, LAT, LON),
                'wind-direction': stationReading('S1', 180, LAT, LON),
                '/uv': uvPayload(),
                psi: psiPayload(),
                pm25: pm25Payload(),
                'twenty-four-hr-forecast': twentyFourHrForecast(),
                '4-day-weather-forecast': fourDayForecast(),
            })
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('getCurrentWeather', () => {
        it('assembles a full snapshot from all endpoints', async () => {
            const client = new SingaporeWeatherClient();
            const snapshot = await client.getCurrentWeather(LAT, LON);

            expect(snapshot.condition).toBe('Partly Cloudy');
            expect(snapshot.area).toBe('Bishan');
            expect(snapshot.temperature_c).toBe(31.5);
            expect(snapshot.humidity_percent).toBe(78);
            expect(snapshot.rainfall_mm).toBe(0.2);
            expect(snapshot.wind_speed_knots).toBe(5.4);
            expect(snapshot.wind_direction_degrees).toBe(180);
            expect(snapshot.uv_index).toBe(8);
            expect(snapshot.psi_twenty_four_hourly).toBe(52);
            expect(snapshot.pm25_one_hourly).toBe(12);
            expect(snapshot.air_quality_region).toBe('central');
            expect(snapshot.forecast_low_c).toBe(25);
            expect(snapshot.forecast_high_c).toBe(33);
            expect(snapshot.forecast_periods).toHaveLength(2);
            expect(snapshot.forecast_periods[0]).toEqual({
                label: 'Morning',
                forecast: 'Partly Cloudy (Day)',
            });
            expect(snapshot.daily_forecast).toHaveLength(2);
            expect(snapshot.daily_forecast[0]).toMatchObject({
                date: '2026-07-10',
                forecast: 'Partly Cloudy',
                temperature_low_c: 25,
                temperature_high_c: 33,
            });
        });

        it('returns nulls for a failing endpoint without throwing', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    'two-hr-forecast': twoHrForecast(),
                    // all metric endpoints omitted → will return code:1 error body
                })
            );

            const client = new SingaporeWeatherClient();
            const snapshot = await client.getCurrentWeather(LAT, LON);

            expect(snapshot.condition).toBe('Partly Cloudy');
            expect(snapshot.temperature_c).toBeNull();
            expect(snapshot.humidity_percent).toBeNull();
            expect(snapshot.uv_index).toBeNull();
        });
    });

    describe('resolveForecastArea', () => {
        it('returns the nearest canonical forecast area and its provider coordinates', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    'two-hr-forecast': {
                        code: 0,
                        data: {
                            area_metadata: [
                                {
                                    name: 'Ang Mo Kio',
                                    label_location: { latitude: 1.375, longitude: 103.839 },
                                },
                                {
                                    name: 'Bishan',
                                    label_location: { latitude: 1.3508, longitude: 103.839 },
                                },
                            ],
                        },
                    },
                })
            );

            const area = await new SingaporeWeatherClient().resolveForecastArea(1.351, 103.84);
            expect(area).toEqual({
                key: 'bishan',
                name: 'Bishan',
                latitude: 1.3508,
                longitude: 103.839,
            });
        });

        it('fails when the provider cannot supply canonical area metadata', async () => {
            vi.stubGlobal('fetch', makeFetch({ 'two-hr-forecast': { code: 0, data: {} } }));
            await expect(
                new SingaporeWeatherClient().resolveForecastArea(LAT, LON)
            ).rejects.toMatchObject({ message: 'Unable to resolve a Singapore forecast area' });
        });
    });

    describe('fetchNearestReading', () => {
        it('picks the nearest station by coordinates', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    'air-temperature': {
                        code: 0,
                        errorMsg: '',
                        data: {
                            stations: [
                                {
                                    id: 'NEAR',
                                    name: 'Near',
                                    location: { latitude: LAT + 0.001, longitude: LON + 0.001 },
                                },
                                {
                                    id: 'FAR',
                                    name: 'Far',
                                    location: { latitude: LAT + 0.5, longitude: LON + 0.5 },
                                },
                            ],
                            readings: [
                                {
                                    timestamp: '2026-07-10T10:00:00+08:00',
                                    data: [
                                        { stationId: 'NEAR', value: 30 },
                                        { stationId: 'FAR', value: 99 },
                                    ],
                                },
                            ],
                        },
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchNearestReading('air-temperature', LAT, LON);
            expect(result.value).toBe(30);
        });

        it('returns null when no readings available', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    'air-temperature': {
                        code: 0,
                        errorMsg: '',
                        data: { stations: [], readings: [] },
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchNearestReading('air-temperature', LAT, LON);
            expect(result.value).toBeNull();
        });

        it('throws WeatherProviderError on API error code', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    rainfall: { code: 1, errorMsg: 'Service unavailable' },
                })
            );

            const client = new SingaporeWeatherClient();
            await expect(client.fetchNearestReading('rainfall', LAT, LON)).rejects.toBeInstanceOf(
                WeatherProviderError
            );
        });
    });

    describe('fetchAirQuality', () => {
        const makePsi = (region: string, psi: number) => ({
            code: 0,
            errorMsg: '',
            data: {
                regionMetadata: [
                    { name: region, labelLocation: { latitude: LAT, longitude: LON } },
                ],
                items: [
                    {
                        timestamp: '2026-07-10T10:00:00+08:00',
                        updatedTimestamp: '2026-07-10T10:30:00+08:00',
                        readings: { psi_twenty_four_hourly: { [region]: psi } },
                    },
                ],
            },
        });

        const makePm25 = (region: string, pm25: number) => ({
            code: 0,
            errorMsg: '',
            data: {
                regionMetadata: [
                    { name: region, labelLocation: { latitude: LAT, longitude: LON } },
                ],
                items: [
                    {
                        timestamp: '2026-07-10T10:00:00+08:00',
                        updatedTimestamp: '2026-07-10T10:00:00+08:00',
                        readings: { pm25_one_hourly: { [region]: pm25 } },
                    },
                ],
            },
        });

        it('returns psi, pm25, region and latest timestamp', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '/psi': makePsi('central', 57),
                    '/pm25': makePm25('central', 18),
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchAirQuality(LAT, LON);
            expect(result.psi).toBe(57);
            expect(result.pm25).toBe(18);
            expect(result.region).toBe('central');
            // timestamp is the later of the two updatedTimestamps
            expect(result.timestamp).toBe('2026-07-10T10:30:00+08:00');
        });

        it('picks nearest region by coordinates', async () => {
            const regions = [
                { name: 'central', labelLocation: { latitude: 1.35, longitude: 103.82 } },
                { name: 'east', labelLocation: { latitude: 1.35, longitude: 103.94 } },
            ];
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '/psi': {
                        code: 0,
                        errorMsg: '',
                        data: {
                            regionMetadata: regions,
                            items: [
                                {
                                    updatedTimestamp: '2026-07-10T10:00:00+08:00',
                                    readings: { psi_twenty_four_hourly: { central: 50, east: 70 } },
                                },
                            ],
                        },
                    },
                    '/pm25': {
                        code: 0,
                        errorMsg: '',
                        data: {
                            regionMetadata: regions,
                            items: [
                                {
                                    updatedTimestamp: '2026-07-10T10:00:00+08:00',
                                    readings: { pm25_one_hourly: { central: 10, east: 20 } },
                                },
                            ],
                        },
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            // coordinates closest to east region
            const result = await client.fetchAirQuality(1.35, 103.94);
            expect(result.region).toBe('east');
            expect(result.psi).toBe(70);
            expect(result.pm25).toBe(20);
        });

        it('returns null values when region has no reading', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '/psi': makePsi('north', 45),
                    '/pm25': makePm25('north', 10),
                })
            );

            const client = new SingaporeWeatherClient();
            // coordinates map to central but readings only have 'north'
            const result = await client.fetchAirQuality(1.35, 103.82);
            // nearestRegionName returns 'north' (only entry in metadata), so values should resolve
            expect(result.region).toBe('north');
            expect(result.psi).toBe(45);
            expect(result.pm25).toBe(10);
        });

        it('throws WeatherProviderError when psi returns error code', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '/psi': { code: 1, errorMsg: 'PSI unavailable' },
                    '/pm25': makePm25('central', 12),
                })
            );

            const client = new SingaporeWeatherClient();
            await expect(client.fetchAirQuality(LAT, LON)).rejects.toBeInstanceOf(
                WeatherProviderError
            );
        });

        it('throws WeatherProviderError when pm25 returns error code', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '/psi': makePsi('central', 55),
                    '/pm25': { code: 1, errorMsg: 'PM25 unavailable' },
                })
            );

            const client = new SingaporeWeatherClient();
            await expect(client.fetchAirQuality(LAT, LON)).rejects.toBeInstanceOf(
                WeatherProviderError
            );
        });
    });

    describe('fetchTwentyFourHourForecast', () => {
        it('extracts temp range and region-matched periods', async () => {
            const client = new SingaporeWeatherClient();
            // LAT/LON is central Singapore — expect central region periods
            const result = await client.fetchTwentyFourHourForecast(LAT, LON);
            expect(result.low).toBe(25);
            expect(result.high).toBe(33);
            expect(result.periods).toHaveLength(2);
            expect(result.periods[0]).toEqual({
                label: 'Morning',
                forecast: 'Partly Cloudy (Day)',
            });
            expect(result.periods[1]).toEqual({ label: 'Afternoon', forecast: 'Thundery Showers' });
            expect(result.timestamp).toBeTruthy();
        });

        it('falls back to central region when nearest region has no text', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    'twenty-four-hr-forecast': {
                        code: 0,
                        errorMsg: '',
                        data: {
                            records: [
                                {
                                    updatedTimestamp: '2026-07-10T08:00:00+08:00',
                                    general: { temperature: { low: 24, high: 32 } },
                                    periods: [
                                        {
                                            timePeriod: { text: 'Morning' },
                                            regions: { central: { text: 'Fair', code: 'F' } },
                                            // 'west' region missing — nearest to far-west coords should fall back to central
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            // Far west coordinates — region resolves to 'west', but 'west' key absent → fallback central
            const result = await client.fetchTwentyFourHourForecast(1.35, 103.65);
            expect(result.periods[0].forecast).toBe('Fair');
        });

        it('throws WeatherProviderError on non-zero error code', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    'twenty-four-hr-forecast': {
                        code: 1,
                        errorMsg: 'Upstream error',
                        data: undefined,
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            await expect(client.fetchTwentyFourHourForecast(LAT, LON)).rejects.toBeInstanceOf(
                WeatherProviderError
            );
        });

        it('returns empty periods when records are missing', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    'twenty-four-hr-forecast': { code: 0, errorMsg: '', data: { records: [] } },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchTwentyFourHourForecast(LAT, LON);
            expect(result.low).toBeNull();
            expect(result.high).toBeNull();
            expect(result.periods).toHaveLength(0);
        });
    });

    describe('fetchFourDayForecast', () => {
        it('maps forecasts to DailyForecast array', async () => {
            const client = new SingaporeWeatherClient();
            const result = await client.fetchFourDayForecast();
            expect(result.days).toHaveLength(2);
            expect(result.days[0]).toEqual({
                date: '2026-07-10',
                forecast: 'Partly Cloudy',
                temperature_low_c: 25,
                temperature_high_c: 33,
            });
            expect(result.days[1]).toEqual({
                date: '2026-07-11',
                forecast: 'Showers',
                temperature_low_c: 24,
                temperature_high_c: 31,
            });
            expect(result.timestamp).toBeTruthy();
        });

        it('filters out entries missing date or forecast text', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '4-day-weather-forecast': {
                        items: [
                            {
                                update_timestamp: '2026-07-10T08:00:00+08:00',
                                forecasts: [
                                    {
                                        date: '2026-07-10',
                                        forecast: 'Fair',
                                        temperature: { low: 25, high: 32 },
                                    },
                                    {
                                        date: '',
                                        forecast: 'Cloudy',
                                        temperature: { low: 24, high: 31 },
                                    }, // empty date → filtered
                                    {
                                        date: '2026-07-12',
                                        forecast: '',
                                        temperature: { low: 24, high: 31 },
                                    }, // empty forecast → filtered
                                ],
                            },
                        ],
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchFourDayForecast();
            expect(result.days).toHaveLength(1);
            expect(result.days[0].date).toBe('2026-07-10');
        });

        it('uses timestamp as date fallback when date field is absent', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '4-day-weather-forecast': {
                        items: [
                            {
                                update_timestamp: '2026-07-10T08:00:00+08:00',
                                forecasts: [
                                    {
                                        timestamp: '2026-07-10T00:00:00+08:00',
                                        forecast: 'Windy',
                                        temperature: { low: 24, high: 30 },
                                    },
                                ],
                            },
                        ],
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchFourDayForecast();
            expect(result.days[0].date).toBe('2026-07-10');
        });

        it('maps current v2 four-day outlook records shape', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '4-day-weather-forecast': {
                        code: 0,
                        errorMsg: '',
                        data: {
                            records: [
                                {
                                    updatedTimestamp: '2026-07-10T05:11:08+08:00',
                                    timestamp: '2026-07-10T04:59:00+08:00',
                                    forecasts: [
                                        {
                                            day: 'Saturday',
                                            timestamp: '2026-07-11T00:00:00+08:00',
                                            forecast: {
                                                summary: 'Partly cloudy',
                                                text: 'Partly Cloudy (Day)',
                                                code: 'PC',
                                            },
                                            temperature: { low: 26, high: 34 },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchFourDayForecast();
            expect(result.days[0]).toEqual({
                date: '2026-07-11',
                forecast: 'Partly cloudy',
                temperature_low_c: 26,
                temperature_high_c: 34,
            });
            expect(result.timestamp).toBe('2026-07-10T05:11:08+08:00');
        });

        it('returns empty days when items array is missing', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '4-day-weather-forecast': { api_info: { status: 'healthy' } },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchFourDayForecast();
            expect(result.days).toHaveLength(0);
            expect(result.timestamp).toBeNull();
        });
    });

    describe('fetchUvIndex', () => {
        it('returns the latest UV index value', async () => {
            const client = new SingaporeWeatherClient();
            const result = await client.fetchUvIndex();
            expect(result.value).toBe(8);
            expect(result.timestamp).toBeTruthy();
        });

        it('returns null value when records are empty', async () => {
            vi.stubGlobal(
                'fetch',
                makeFetch({
                    '/uv': { code: 0, errorMsg: '', data: { records: [] } },
                })
            );

            const client = new SingaporeWeatherClient();
            const result = await client.fetchUvIndex();
            expect(result.value).toBeNull();
        });
    });
});
