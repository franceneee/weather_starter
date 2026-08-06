import type { Router } from 'express';
import { Router as createRouter } from 'express';
import {
    createLocation,
    deleteLocation,
    getLocation,
    getLocationByCanonicalAreaKey,
    listLocations,
    updateWeather,
} from '../db.js';
import {
    AreaResolutionError,
    SingaporeWeatherClient,
    WeatherProviderError,
    type ForecastArea,
    type WeatherSnapshot,
} from '../weather.js';
import { logger } from '../logger.js';

export interface WeatherClient {
    getCurrentWeather(latitude: number, longitude: number): Promise<WeatherSnapshot>;
}

export interface AreaResolver {
    resolveForecastArea(latitude: number, longitude: number): Promise<ForecastArea>;
}

interface LocationsRouterOptions {
    weatherClient?: WeatherClient;
    areaResolver?: AreaResolver;
}

export function createLocationsRouter(options: LocationsRouterOptions = {}): Router {
    const router: Router = createRouter();
    const provider = new SingaporeWeatherClient({ apiKey: process.env.WEATHER_API_KEY });
    const weatherClient = options.weatherClient ?? provider;
    const areaResolver = options.areaResolver ?? provider;

    router.get('/locations', async (_request, response, next) => {
        try {
            response.json({ locations: await listLocations() });
        } catch (error) {
            next(error);
        }
    });

    router.post('/locations', async (request, response, next) => {
        try {
            const latitude = Number(request.body?.latitude);
            const longitude = Number(request.body?.longitude);

            if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
                response.status(422).json({ detail: 'latitude and longitude are required' });
                return;
            }
            if (!(1.1 <= latitude && latitude <= 1.5 && 103.6 <= longitude && longitude <= 104.1)) {
                response.status(422).json({
                    detail: 'Coordinates must be within Singapore (lat 1.1-1.5, lon 103.6-104.1)',
                });
                return;
            }

            let area: ForecastArea;
            try {
                area = await areaResolver.resolveForecastArea(latitude, longitude);
            } catch (error) {
                logger.warn(
                    { err: error instanceof AreaResolutionError ? error : undefined },
                    'forecast area resolution failed'
                );
                response.status(503).json({
                    detail: 'Forecast-area service is unavailable. Please try again.',
                    retryable: true,
                });
                return;
            }

            const existing = await getLocationByCanonicalAreaKey(area.key);
            const location = existing ?? (await createLocation(area));

            try {
                const snapshot = await weatherClient.getCurrentWeather(
                    location.latitude,
                    location.longitude
                );
                const updated = await updateWeather(location.id, snapshot);
                response.status(existing ? 200 : 201).json(updated ?? location);
            } catch (error) {
                logger.warn(
                    {
                        err: error instanceof WeatherProviderError ? error : undefined,
                        locationId: location.id,
                    },
                    'weather refresh failed after location create'
                );
                response.status(existing ? 200 : 201).json(location);
            }
        } catch (error) {
            next(error);
        }
    });

    router.get('/locations/:locationId', async (request, response, next) => {
        try {
            const location = await getLocation(Number(request.params.locationId));
            if (!location) {
                response.status(404).json({ detail: 'Location not found' });
                return;
            }
            response.json(location);
        } catch (error) {
            next(error);
        }
    });

    router.delete('/locations/:locationId', async (request, response, next) => {
        try {
            const deleted = await deleteLocation(Number(request.params.locationId));
            if (!deleted) {
                response.status(404).json({ detail: 'Location not found' });
                return;
            }
            response.status(204).send();
        } catch (error) {
            next(error);
        }
    });

    router.post('/locations/:locationId/refresh', async (request, response, next) => {
        try {
            const locationId = Number(request.params.locationId);
            const location = await getLocation(locationId);
            if (!location) {
                response.status(404).json({ detail: 'Location not found' });
                return;
            }

            const snapshot = await weatherClient.getCurrentWeather(
                location.latitude,
                location.longitude
            );
            const updated = await updateWeather(locationId, snapshot);
            response.json(updated);
        } catch (error) {
            if (error instanceof WeatherProviderError) {
                response.status(502).json({ detail: error.message });
                return;
            }
            next(error);
        }
    });

    return router;
}
