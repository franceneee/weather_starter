import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
    listLocations,
    createLocation,
    deleteLocation,
    refreshLocation,
    logInteraction,
} from '../api';
import type { CreateLocationPayload, Location, ProviderProps, StoreValue } from '../types';

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: ProviderProps) {
    const [locations, setLocations] = useState<Location[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshingId, setRefreshingId] = useState<number | null>(null);
    const [error, setError] = useState<unknown>(null);

    const load = useCallback(async (): Promise<Location[]> => {
        try {
            const data = await listLocations();
            setLocations(data.locations);
            setError(null);
            return data.locations;
        } catch (err) {
            setError(err);
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount syncs API → React state
        load().then((next) => {
            if (next.length > 0) setSelectedId((current) => current ?? next[0].id);
        });
    }, [load]);

    const effectiveSelectedId = (() => {
        if (locations.length === 0) return null;
        return locations.some((l) => l.id === selectedId) ? selectedId : locations[0].id;
    })();

    const create = useCallback(
        async (payload: CreateLocationPayload) => {
            setIsCreating(true);
            setError(null);
            logInteraction('location_create_submitted', { stage: 'server' });
            try {
                const created = await createLocation(payload);
                setSelectedId(created.id);
                await load();
                setIsAdding(false);
                logInteraction('location_created', {
                    locationId: created.id,
                    resolvedArea: created.canonical_area_name,
                    outcome:
                        created.weather.source === 'not-refreshed'
                            ? 'saved_weather_unavailable'
                            : 'saved',
                });
                return created;
            } catch (err) {
                setError(err);
                logInteraction('location_create_failed', {
                    stage: 'server',
                    outcome: 'failed',
                });
                throw err;
            } finally {
                setIsCreating(false);
            }
        },
        [load]
    );

    const refresh = useCallback(
        async (id: number) => {
            setRefreshingId(id);
            setError(null);
            logInteraction('location_refresh_clicked', { locationId: id });
            try {
                await refreshLocation(id);
                await load();
                logInteraction('location_refreshed', { locationId: id });
            } catch (err) {
                setError(err);
                logInteraction('location_refresh_failed', {
                    locationId: id,
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
            } finally {
                setRefreshingId(null);
            }
        },
        [load]
    );

    const remove = useCallback(async (id: number) => {
        setError(null);
        logInteraction('location_delete_clicked', { locationId: id });
        try {
            await deleteLocation(id);
            setLocations((prev) => prev.filter((l) => l.id !== id));
            setSelectedId((current) => (current === id ? null : current));
            logInteraction('location_deleted', { locationId: id });
        } catch (err) {
            setError(err);
            logInteraction('location_delete_failed', {
                locationId: id,
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }, []);

    const value: StoreValue = {
        locations,
        selectedId: effectiveSelectedId,
        isAdding,
        isCreating,
        isLoading,
        refreshingId,
        error,
        select: setSelectedId,
        setAdding: (nextIsAdding) => {
            setIsAdding(nextIsAdding);
            if (nextIsAdding) logInteraction('location_form_opened');
        },
        create,
        refresh,
        delete: remove,
    };

    return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
    const ctx = useContext(StoreContext);
    if (!ctx) throw new Error('useStore must be used inside StoreProvider');
    return ctx;
}

export function useSelectedLocation(): Location | null {
    const { locations, selectedId } = useStore();
    return locations.find((l) => l.id === selectedId) ?? null;
}
