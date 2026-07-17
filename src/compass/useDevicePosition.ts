/**
 * Subscribes to device GPS position. Pauses on background, resumes on foreground.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { updateCurrencyFromCoordinates } from '@/location/locationCurrency';

export interface DevicePosition {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

export interface UseDevicePositionResult {
  position: DevicePosition | null;
}

/** A recent OS-cached fix is accurate enough to choose an initial nearby pub.
 * The live BestForNavigation watcher keeps running and replaces it as soon as a
 * fresh sample arrives. A tight age cap prevents a fix from a previous journey
 * from briefly pointing the compass at the wrong city. */
const LAST_KNOWN_POSITION_MAX_AGE_MS = 5 * 60 * 1000;
const LAST_KNOWN_POSITION_REQUIRED_ACCURACY_M = 100;

export function useDevicePosition(enabled: boolean): UseDevicePositionResult {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const startingRef = useRef(false);
  const seedingRef = useRef(false);
  const hasPositionRef = useRef(false);
  const isMountedRef = useRef(true);
  const enabledRef = useRef(enabled);

  const publishPosition = useCallback(
    (location: Location.LocationObject, source: 'cached' | 'live'): void => {
      if (!isMountedRef.current || !enabledRef.current) return;
      // A delayed last-known lookup must never replace a live sample that arrived
      // while the native promise was resolving.
      if (source === 'cached' && hasPositionRef.current) return;

      const { latitude, longitude, accuracy } = location.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      hasPositionRef.current = true;
      setPosition({
        lat: latitude,
        lng: longitude,
        accuracyMeters: accuracy ?? 999,
      });
    },
    [],
  );

  const seedFromLastKnownPosition = useCallback(async (): Promise<void> => {
    if (hasPositionRef.current || seedingRef.current) return;
    try {
      seedingRef.current = true;
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_POSITION_MAX_AGE_MS,
        requiredAccuracy: LAST_KNOWN_POSITION_REQUIRED_ACCURACY_M,
      });
      if (
        cached &&
        AppState.currentState === 'active' &&
        isMountedRef.current &&
        enabledRef.current
      ) {
        publishPosition(cached, 'cached');
      }
    } catch {
      // Best-effort startup shortcut; the live watcher remains authoritative.
    } finally {
      seedingRef.current = false;
    }
  }, [publishPosition]);

  const startWatching = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
    if (subscriptionRef.current) return; // already watching
    if (startingRef.current) return;

    try {
      startingRef.current = true;
      // Do not await this: native watcher registration and the cheap cached read
      // should race so neither adds latency to the other.
      void seedFromLastKnownPosition();
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 0,
          timeInterval: 1000,
        },
        (location) => {
          if (!isMountedRef.current || !enabledRef.current) return;
          void updateCurrencyFromCoordinates(
            location.coords.latitude,
            location.coords.longitude,
          );
          publishPosition(location, 'live');
        },
      );
      if (
        !isMountedRef.current ||
        !enabledRef.current ||
        subscriptionRef.current ||
        AppState.currentState !== 'active'
      ) {
        sub.remove();
        return;
      }
      subscriptionRef.current = sub;
    } catch {
      // ignore — no permission or GPS unavailable
    } finally {
      startingRef.current = false;
    }
  }, [publishPosition, seedFromLastKnownPosition]);

  const stopWatching = useCallback((): void => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;

    if (enabled && AppState.currentState === 'active') {
      // Run after the effect body so any cached/native callback updates state as
      // an external-system response, never as a cascading synchronous effect.
      void Promise.resolve().then(startWatching);
    } else {
      stopWatching();
    }
  }, [enabled, startWatching, stopWatching]);

  useEffect(() => {
    isMountedRef.current = true;

    const handleAppState = (nextState: AppStateStatus): void => {
      if (!enabledRef.current) {
        stopWatching();
        return;
      }

      if (nextState === 'active') {
        startWatching();
      } else {
        stopWatching();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);

    return () => {
      isMountedRef.current = false;
      enabledRef.current = false;
      stopWatching();
      subscription.remove();
    };
  }, [startWatching, stopWatching]);

  return { position };
}
