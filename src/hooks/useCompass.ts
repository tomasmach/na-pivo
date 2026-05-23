/**
 * Public facade hook — the only surface the screens consume for compass behavior.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { findNearestPub, findRandomPubInRadius, isLoaded, loadPubs } from '@/data/pubs';
import type { Pub } from '@/data/pubs';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useDevicePosition } from '@/compass/useDevicePosition';
import { useDeviceHeading } from '@/compass/useDeviceHeading';
import { useTargetBearing } from '@/compass/useTargetBearing';
import { useArrivalDetector } from '@/compass/useArrivalDetector';
import { ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import { formatDistanceCs } from '@/compass/distance';
import type { PermissionState } from '@/compass/permissions';
import type { Mode } from '@/stores/settingsStore';

/** Minimum distance (meters) to move before recomputing the target pub. */
const RECOMPUTE_DISTANCE_M = 50;

/** Squared euclidean proxy for fast distance check (degrees). ~50m ≈ 0.0005°. */
const RECOMPUTE_THRESHOLD_DEG = 0.0005;

export interface UseCompassResult {
  arrowRotation: number | null;
  distanceMeters: number | null;
  distanceFormatted: string | null;
  pub: Pub | null;
  revealed: boolean;
  reveal: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  reroll: () => void;
  arrived: boolean;
  dismissArrival: () => void;
  headingAccuracy: number | null;
  hasMagnetometer: boolean;
  permissionState: PermissionState;
  requestPermission: () => Promise<void>;
  isLoading: boolean;
}

export function useCompass(): UseCompassResult {
  // — Settings from store —
  const mode = useSettingsStore((s) => s.mode);
  const setMode = useSettingsStore((s) => s.setMode);
  const maxDistanceKm = useSettingsStore((s) => s.maxDistanceKm);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const surpriseSeed = useSettingsStore((s) => s.surpriseSeed);
  const bumpSurpriseSeed = useSettingsStore((s) => s.bumpSurpriseSeed);

  // — Pub store —
  const setRevealedPub = usePubStore((s) => s.setRevealedPub);

  // — Position / heading —
  const { position } = useDevicePosition();
  const { smoothedHeading, accuracyDeg, hasMagnetometer } = useDeviceHeading();

  // — Permission state —
  const [permissionState, setPermissionState] = useState<PermissionState>('undetermined');

  // — Pub data loading state —
  const [pubsLoaded, setPubsLoaded] = useState(() => isLoaded());

  useEffect(() => {
    if (!isLoaded()) {
      loadPubs()
        .then(() => setPubsLoaded(true))
        .catch(() => setPubsLoaded(true)); // even on error, stop showing spinner
    }
  }, []);

  // — Permission check on mount —
  useEffect(() => {
    ensureLocationPermission().then(setPermissionState).catch(() => {
      setPermissionState('denied');
    });
  }, []);

  // — Target pub state —
  const [currentPub, setCurrentPub] = useState<Pub | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Track last position used to select a target, to avoid re-selecting on every tiny GPS twitch.
  const lastTargetPosRef = useRef<{ lat: number; lng: number } | null>(null);
  // Track last inputs that determined the current target.
  const lastModeRef = useRef<Mode | null>(null);
  const lastMaxKmRef = useRef<number | null | undefined>(undefined);
  const lastSeedRef = useRef<number | null>(null);

  // — Target selection logic —
  const selectTarget = useCallback(() => {
    if (!position || !pubsLoaded) return;

    const { lat, lng } = position;
    const pub =
      mode === 'nearest'
        ? findNearestPub({ lat, lng, maxKm: maxDistanceKm ?? undefined })
        : findRandomPubInRadius({ lat, lng, maxKm: maxDistanceKm ?? 2, seed: surpriseSeed });

    setCurrentPub(pub);
    setRevealed(false);
  }, [position, pubsLoaded, mode, maxDistanceKm, surpriseSeed]);

  useEffect(() => {
    if (!position || !pubsLoaded) return;

    const { lat, lng } = position;
    const lastPos = lastTargetPosRef.current;

    // Check if we should recompute
    const modeChanged = mode !== lastModeRef.current;
    const maxKmChanged = maxDistanceKm !== lastMaxKmRef.current;
    const seedChanged = surpriseSeed !== lastSeedRef.current;

    let distanceMoved = Infinity;
    if (lastPos) {
      const dLat = lat - lastPos.lat;
      const dLng = lng - lastPos.lng;
      distanceMoved = Math.sqrt(dLat * dLat + dLng * dLng);
    }

    const positionMoved = distanceMoved >= RECOMPUTE_THRESHOLD_DEG;

    if (modeChanged || maxKmChanged || seedChanged || positionMoved) {
      lastTargetPosRef.current = { lat, lng };
      lastModeRef.current = mode;
      lastMaxKmRef.current = maxDistanceKm;
      lastSeedRef.current = surpriseSeed;

      const pub =
        mode === 'nearest'
          ? findNearestPub({ lat, lng, maxKm: maxDistanceKm ?? undefined })
          : findRandomPubInRadius({ lat, lng, maxKm: maxDistanceKm ?? 2, seed: surpriseSeed });

      setCurrentPub(pub);
      // Only reset revealed when actually changing to a different pub
      setRevealed((prev) => {
        if (pub?.id !== currentPub?.id) return false;
        return prev;
      });
    }
  }, [position, pubsLoaded, mode, maxDistanceKm, surpriseSeed]);

  // — Bearing / distance —
  const { bearing, distanceMeters } = useTargetBearing(
    position ? { lat: position.lat, lng: position.lng } : null,
    currentPub,
  );

  // — Arrival detection —
  const { arrived, dismiss: dismissArrival } = useArrivalDetector({
    distanceMeters,
    gpsAccuracyMeters: position?.accuracyMeters ?? null,
    targetPubId: currentPub?.id ?? null,
    hapticEnabled,
    soundEnabled,
  });

  // — Arrow rotation —
  const arrowRotation =
    bearing !== null && smoothedHeading !== null
      ? ((bearing - smoothedHeading + 360) % 360)
      : null;

  // — Distance formatted —
  const distanceFormatted = distanceMeters !== null ? formatDistanceCs(distanceMeters) : null;

  // — isLoading —
  const isLoading = !pubsLoaded || position === null;

  // — Actions —
  const reveal = useCallback(() => {
    setRevealed(true);
    if (currentPub) {
      setRevealedPub(currentPub);
    }
  }, [currentPub, setRevealedPub]);

  const reroll = useCallback(() => {
    bumpSurpriseSeed();
  }, [bumpSurpriseSeed]);

  const requestPermission = useCallback(async () => {
    const state = await ensureLocationPermission();
    setPermissionState(state);
    if (state === 'denied') {
      await openSystemSettings();
    }
  }, []);

  return {
    arrowRotation,
    distanceMeters,
    distanceFormatted,
    pub: currentPub,
    revealed,
    reveal,
    mode,
    setMode,
    reroll,
    arrived,
    dismissArrival,
    headingAccuracy: accuracyDeg,
    hasMagnetometer,
    permissionState,
    requestPermission,
    isLoading,
  };
}
