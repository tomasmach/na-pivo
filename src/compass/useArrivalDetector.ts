/**
 * Detects arrival at a pub and triggers haptic + sound feedback once per pub visit.
 */

import { useEffect, useRef, useState } from 'react';
import { createAudioPlayer } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { fireSuccessHaptic } from '@/utils/haptics';

export interface UseArrivalDetectorOptions {
  distanceMeters: number | null;
  gpsAccuracyMeters: number | null;
  targetPubId: string | null;
  hapticEnabled: boolean;
  soundEnabled: boolean;
  thresholdMeters?: number;
}

export interface UseArrivalDetectorResult {
  arrived: boolean;
  dismiss: () => void;
}

const DEFAULT_THRESHOLD_METERS = 30;

export function useArrivalDetector({
  distanceMeters,
  gpsAccuracyMeters,
  targetPubId,
  hapticEnabled,
  soundEnabled,
  thresholdMeters = DEFAULT_THRESHOLD_METERS,
}: UseArrivalDetectorOptions): UseArrivalDetectorResult {
  const [arrived, setArrived] = useState(false);

  // Tracks the pubId that has already fired, to prevent re-firing.
  const firedRef = useRef<string | null>(null);
  // Avoid firing on cold start when the user/app already begins inside the
  // arrival radius. Arrival is armed only after observing the target outside
  // the threshold, then fires on the outside -> inside transition.
  const armedRef = useRef(false);

  // Lazily created audio player — cached for the component's lifetime.
  const audioPlayerRef = useRef<AudioPlayer | null>(null);

  // Reset fired state when target pub changes so a new pub can trigger arrival.
  const prevPubIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (targetPubId !== prevPubIdRef.current) {
      prevPubIdRef.current = targetPubId;
      firedRef.current = null;
      armedRef.current = false;
      setArrived(false);
    }
  }, [targetPubId]);

  // Clean up audio player on unmount.
  useEffect(() => {
    return () => {
      audioPlayerRef.current?.remove();
      audioPlayerRef.current = null;
    };
  }, []);

  // Arrival detection.
  useEffect(() => {
    if (
      distanceMeters === null ||
      gpsAccuracyMeters === null ||
      gpsAccuracyMeters >= 30 ||
      targetPubId === null ||
      firedRef.current === targetPubId
    ) {
      return;
    }

    if (distanceMeters >= thresholdMeters) {
      armedRef.current = true;
      return;
    }

    if (!armedRef.current) {
      return;
    }

    // Fire arrival.
    firedRef.current = targetPubId;
    setArrived(true);

    if (hapticEnabled) {
      fireSuccessHaptic();
    }

    if (soundEnabled) {
      // Lazily create the player and cache it.
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = createAudioPlayer(require('../../assets/sounds/cink.mp3'));
      }
      audioPlayerRef.current.play();
    }
  }, [distanceMeters, gpsAccuracyMeters, targetPubId, hapticEnabled, soundEnabled, thresholdMeters]);

  const dismiss = (): void => {
    // Reset visual state but keep firedRef so the same pub doesn't re-fire.
    setArrived(false);
  };

  return { arrived, dismiss };
}
