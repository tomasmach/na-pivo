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

export function useDevicePosition(): UseDevicePositionResult {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const isMountedRef = useRef(true);

  const startWatching = async (): Promise<void> => {
    if (subscriptionRef.current) return; // already watching

    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 10,
          timeInterval: 5000,
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
      if (!isMountedRef.current) {
        sub.remove();
        return;
      }
      subscriptionRef.current = sub;
    } catch {
      // ignore — no permission or GPS unavailable
    }
  };

  const stopWatching = (): void => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  };

  useEffect(() => {
    isMountedRef.current = true;
    startWatching();

    const handleAppState = (nextState: AppStateStatus): void => {
      if (nextState === 'active') {
        startWatching();
      } else {
        stopWatching();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);

    return () => {
      isMountedRef.current = false;
      stopWatching();
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { position };
}
