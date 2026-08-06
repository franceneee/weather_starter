import { useState } from 'react';
import type { FormEvent } from 'react';
import { useStore } from '../state/store';
import { ApiRequestError, logInteraction } from '../api';
import { LocationIcon, PlusIcon } from './icons';

type LocationPhase = 'idle' | 'detecting' | 'adding';

const GEOLOCATION_OPTIONS: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 10_000,
    maximumAge: 5 * 60_000,
};

function canUseGeolocation(): string | null {
    if (!('geolocation' in navigator)) {
        return 'Location detection is not supported by this browser. Enter coordinates manually.';
    }
    const host = window.location.hostname;
    const loopback = host === 'localhost' || host === '::1' || host.startsWith('127.');
    if (!window.isSecureContext && !loopback) {
        return 'Location detection requires HTTPS. Enter coordinates manually.';
    }
    return null;
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
    if (error.code === error.PERMISSION_DENIED) {
        return 'Location permission was denied. Allow access in your browser or enter coordinates manually.';
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
        return 'Your position is unavailable. Try again or enter coordinates manually.';
    }
    if (error.code === error.TIMEOUT) {
        return 'Location detection timed out. Try again or enter coordinates manually.';
    }
    return 'Could not detect your location. Enter coordinates manually.';
}

function serverErrorMessage(error: unknown): string {
    if (error instanceof ApiRequestError && error.status === 422) return error.message;
    if (error instanceof ApiRequestError && error.status === 503) {
        return 'The forecast-area service is temporarily unavailable. Please try again.';
    }
    return error instanceof Error ? error.message : 'Could not add location. Please try again.';
}

export function AddLocationForm() {
    const { isAdding, isCreating, setAdding, create } = useStore();
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [locationPhase, setLocationPhase] = useState<LocationPhase>('idle');
    const [locationMessage, setLocationMessage] = useState<string | null>(null);

    const busy = isCreating || submitting || locationPhase !== 'idle';

    const cancel = () => {
        setLatitude('');
        setLongitude('');
        setSubmitError(null);
        setAdding(false);
    };

    const useMyLocation = () => {
        const eligibilityError = canUseGeolocation();
        setLocationMessage(null);
        if (eligibilityError) {
            setLocationMessage(eligibilityError);
            logInteraction('location_detection_finished', {
                stage: 'eligibility',
                outcome: 'unavailable',
            });
            return;
        }

        setLocationPhase('detecting');
        logInteraction('location_detection_started', { stage: 'device' });
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLocationPhase('adding');
                logInteraction('location_detection_finished', {
                    stage: 'device',
                    outcome: 'succeeded',
                });
                void create({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                })
                    .then((location) => {
                        setLocationMessage(
                            location.weather.source === 'not-refreshed'
                                ? `${location.canonical_area_name} was added, but weather is temporarily unavailable.`
                                : null
                        );
                    })
                    .catch((error: unknown) => setLocationMessage(serverErrorMessage(error)))
                    .finally(() => setLocationPhase('idle'));
            },
            (error) => {
                setLocationPhase('idle');
                setLocationMessage(geolocationErrorMessage(error));
                logInteraction('location_detection_finished', {
                    stage: 'device',
                    outcome: `error_${error.code}`,
                });
            },
            GEOLOCATION_OPTIONS
        );
    };

    const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        setSubmitError(null);
        try {
            await create({ latitude: Number(latitude), longitude: Number(longitude) });
            setLatitude('');
            setLongitude('');
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Could not add location');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="grid gap-2.5">
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    disabled={busy}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.07] px-3 py-2.5 text-sm font-medium text-white/85 backdrop-blur-xl hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <PlusIcon />
                    <span>Add Location</span>
                </button>
                <button
                    type="button"
                    onClick={useMyLocation}
                    disabled={busy}
                    aria-busy={locationPhase !== 'idle'}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.07] px-3 py-2.5 text-sm font-medium text-white/85 backdrop-blur-xl hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <LocationIcon className="h-4 w-4" />
                    <span>
                        {locationPhase === 'detecting'
                            ? 'Detecting location…'
                            : locationPhase === 'adding'
                              ? 'Adding location…'
                              : 'Use my location'}
                    </span>
                </button>
            </div>
            <div aria-live="polite" aria-atomic="true">
                {locationPhase !== 'idle' ? (
                    <span className="sr-only">
                        {locationPhase === 'detecting' ? 'Detecting location…' : 'Adding location…'}
                    </span>
                ) : null}
                {locationMessage ? (
                    <p className="rounded-md border border-amber-200/30 bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-50">
                        {locationMessage}
                    </p>
                ) : null}
            </div>
            {isAdding ? (
                <form
                    onSubmit={onSubmit}
                    className="grid gap-2.5 rounded-2xl border border-white/15 bg-white/[0.1] p-3 backdrop-blur-xl"
                >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                        New coordinate
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="grid min-w-0 gap-1">
                            <span className="text-[11px] text-white/60">Latitude</span>
                            <input
                                type="number"
                                step="any"
                                value={latitude}
                                onChange={(e) => setLatitude(e.target.value)}
                                placeholder="1.3508"
                                required
                                className="w-full min-w-0 rounded-md border border-white/15 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-white/40"
                            />
                        </label>
                        <label className="grid min-w-0 gap-1">
                            <span className="text-[11px] text-white/60">Longitude</span>
                            <input
                                type="number"
                                step="any"
                                value={longitude}
                                onChange={(e) => setLongitude(e.target.value)}
                                placeholder="103.8390"
                                required
                                className="w-full min-w-0 rounded-md border border-white/15 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-white/40"
                            />
                        </label>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={cancel}
                            disabled={busy}
                            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-white/70 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={busy}
                            className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {submitting ? 'Adding…' : 'Add'}
                        </button>
                    </div>
                    {submitError && (
                        <p className="rounded-md border border-red-300/30 bg-red-500/15 px-2.5 py-1.5 text-xs text-red-100">
                            {submitError}
                        </p>
                    )}
                </form>
            ) : null}
        </div>
    );
}
