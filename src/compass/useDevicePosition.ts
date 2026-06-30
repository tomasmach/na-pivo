/**
 * Subscribes to device GPS position. Pauses on background, resumes on foreground.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';

export interface DevicePosition {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

export interface UseDevicePositionResult {
  position: DevicePosition | null;
}

export function useDevicePosition(enabled: boolean): UseDevicePositionResult {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const startingRef = useRef(false);
  const isMountedRef = useRef(true);
  const enabledRef = useRef(enabled);

  const startWatching = async (): Promise<void> => {
    if (!enabledRef.current) return;
    if (subscriptionRef.current) return; // already watching
    if (startingRef.current) return;

    try {
      startingRef.current = true;
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 0,
          timeInterval: 1000,
        },
        (location) => {
          if (!isMountedRef.current) return;
          setPosition({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            accuracyMeters: location.coords.accuracy ?? 999,
          });
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
  };

  const stopWatching = (): void => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  };

  useEffect(() => {
    enabledRef.current = enabled;

    if (enabled && AppState.currentState === 'active') {
      startWatching();
    } else {
      stopWatching();
    }
  }, [enabled]);

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
  }, []);

  return { position };
}
