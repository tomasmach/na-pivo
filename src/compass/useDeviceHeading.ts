/**
 * Subscribes to device heading. Smooths via wrap-aware EMA. Pauses on background.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { createAngleEMA, DEFAULT_HEADING_ALPHA } from './smoothing';

export interface UseDeviceHeadingResult {
  smoothedHeading: SharedValue<number | null>;
  accuracyDeg: number | null;
  hasMagnetometer: boolean;
}

const NO_HEADING_THRESHOLD = 5;

export function useDeviceHeading(): UseDeviceHeadingResult {
  const smoothedHeading = useSharedValue<number | null>(null);
  const [accuracyDeg, setAccuracyDeg] = useState<number | null>(null);
  const [hasMagnetometer, setHasMagnetometer] = useState(true);

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const emaRef = useRef(createAngleEMA(DEFAULT_HEADING_ALPHA));
  const isMountedRef = useRef(true);
  const noHeadingCountRef = useRef(0);
  const accuracyDegRef = useRef<number | null>(null);
  const hasMagnetometerRef = useRef(true);

  const startWatching = async (): Promise<void> => {
    if (subscriptionRef.current) return;

    emaRef.current.reset();
    noHeadingCountRef.current = 0;
    smoothedHeading.value = null;

    try {
      const sub = await Location.watchHeadingAsync((heading) => {
        if (!isMountedRef.current) return;

        const { trueHeading, magHeading, accuracy } = heading;

        // Track no-heading callbacks
        if (trueHeading === -1 && magHeading === -1) {
          noHeadingCountRef.current += 1;
          if (noHeadingCountRef.current >= NO_HEADING_THRESHOLD && hasMagnetometerRef.current) {
            hasMagnetometerRef.current = false;
            setHasMagnetometer(false);
          }
          return;
        }

        // Reset no-heading counter when we get a valid reading
        noHeadingCountRef.current = 0;
        if (!hasMagnetometerRef.current) {
          hasMagnetometerRef.current = true;
          setHasMagnetometer(true);
        }

        // Prefer magnetic heading for immediate compass response. trueHeading
        // can be slower or unavailable depending on CoreLocation calibration.
        const raw = magHeading >= 0 ? magHeading : trueHeading;
        const smoothed = emaRef.current(raw);

        smoothedHeading.value = smoothed;

        const roundedAccuracy = Math.round(accuracy);
        if (accuracyDegRef.current !== roundedAccuracy) {
          accuracyDegRef.current = roundedAccuracy;
          setAccuracyDeg(roundedAccuracy);
        }
      });

      if (!isMountedRef.current) {
        sub.remove();
        return;
      }
      subscriptionRef.current = sub;
    } catch {
      // ignore — device may not support heading
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

  return { smoothedHeading, accuracyDeg, hasMagnetometer };
}
