/**
 * Subscribes to device GPS position. Pauses on background, resumes on foreground.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { recordWalkingSample } from '@/data/walkingTelemetry';
import { updateCurrencyFromCoordinates } from '@/location/locationCurrency';

export interface DevicePosition {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

export interface UseDevicePositionResult {
  position: DevicePosition | null;
  retry: () => Promise<void>;
}

/** A recent OS-cached fix is accurate enough to choose an initial nearby pub.
 * The live high-accuracy watcher keeps running and replaces it as soon as a
 * fresh sample arrives. A tight age cap prevents a fix from a previous journey
 * from briefly pointing the compass at the wrong city. */
const LAST_KNOWN_POSITION_MAX_AGE_MS = 5 * 60 * 1000;
const LAST_KNOWN_POSITION_REQUIRED_ACCURACY_M = 100;

/** GPS jitter below these thresholds is invisible to every consumer (distance
 * labels round to meters, retargeting has its own gate), but each published
 * object re-runs the pub-list derivation pipeline. Dedup at the source. */
const MIN_PUBLISH_MOVEMENT_M = 3;
const MIN_PUBLISH_ACCURACY_DELTA_M = 5;

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * The last fix this PROCESS saw, shared by every consumer of the hook.
 *
 * Position used to be private state per hook instance, so a screen that mounted
 * mid-session started from `null` and waited for a fresh GPS sample: the pub
 * picker opened over the Hospody tab with no distances and a "no location" empty
 * state, and the party hub drew a black rectangle where its map belongs — both
 * while the phone knew perfectly well where it was.
 *
 * In memory only. Never persisted, never logged, dropped with the process.
 */
let processPosition: DevicePosition | null = null;

/** Where the phone last was, for a caller that cannot wait for its own fix. */
export function lastKnownDevicePosition(): DevicePosition | null {
  return processPosition;
}

/** Test seam: the module cache must not leak between test cases. */
export function clearLastKnownDevicePosition(): void {
  processPosition = null;
}

function approxDistanceMeters(a: DevicePosition, b: DevicePosition): number {
  const dLat = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
  const dLng =
    (b.lng - a.lng) *
    METERS_PER_DEGREE_LAT *
    Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function useDevicePosition(enabled: boolean): UseDevicePositionResult {
  const [position, setPosition] = useState<DevicePosition | null>(() => processPosition);
  const [startRequestNonce, setStartRequestNonce] = useState(0);
  const lastPublishedRef = useRef<DevicePosition | null>(processPosition);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const startingRef = useRef(false);
  const retryQueuedRef = useRef(false);
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

      const next: DevicePosition = {
        lat: latitude,
        lng: longitude,
        accuracyMeters: accuracy ?? 999,
      };
      // Walking telemetry consumes the RAW sample stream (pre-dedup) so the
      // recorded distances keep the exact cadence and values they had when
      // every sample was published to React state.
      recordWalkingSample(next);
      const last = lastPublishedRef.current;
      if (
        last &&
        approxDistanceMeters(last, next) < MIN_PUBLISH_MOVEMENT_M &&
        Math.abs(last.accuracyMeters - next.accuracyMeters) <
          MIN_PUBLISH_ACCURACY_DELTA_M
      ) {
        hasPositionRef.current = true;
        return;
      }

      hasPositionRef.current = true;
      lastPublishedRef.current = next;
      processPosition = next;
      setPosition(next);
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
          // High (~10 m) is enough for "which pub am I at" and the compass
          // needle; BestForNavigation kept the GPS chip at turn-by-turn duty
          // cycle for a whole evening at the table.
          accuracy: Location.Accuracy.High,
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
      const shouldRunQueuedRetry =
        retryQueuedRef.current &&
        !subscriptionRef.current &&
        isMountedRef.current &&
        enabledRef.current &&
        AppState.currentState === 'active';
      retryQueuedRef.current = false;
      if (shouldRunQueuedRetry) {
        // Re-enter through the effect after this attempt has fully settled.
        // One nonce coalesces any number of taps and cannot loop by itself.
        setStartRequestNonce((nonce) => nonce + 1);
      }
    }
  }, [publishPosition, seedFromLastKnownPosition]);

  const stopWatching = useCallback((): void => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  }, []);

  const retry = useCallback(async (): Promise<void> => {
    if (
      !isMountedRef.current ||
      !enabledRef.current ||
      AppState.currentState !== 'active'
    ) {
      return;
    }
    if (startingRef.current) {
      retryQueuedRef.current = true;
      return;
    }
    stopWatching();
    await startWatching();
  }, [startWatching, stopWatching]);

  useEffect(() => {
    enabledRef.current = enabled;

    if (enabled && AppState.currentState === 'active') {
      // Run after the effect body so any cached/native callback updates state as
      // an external-system response, never as a cascading synchronous effect.
      void Promise.resolve().then(startWatching);
    } else {
      stopWatching();
    }
  }, [enabled, startRequestNonce, startWatching, stopWatching]);

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

  return { position, retry };
}
