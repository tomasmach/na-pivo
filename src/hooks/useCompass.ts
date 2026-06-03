/**
 * Public facade hook — the only surface the screens consume for compass behavior.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { fetchPubsNear, findNearestPub, findRandomPubInRadius, isLoaded } from '@/data/pubs';
import type { Pub } from '@/data/pubs';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useDevicePosition } from '@/compass/useDevicePosition';
import { useDeviceHeading } from '@/compass/useDeviceHeading';
import { useTargetBearing } from '@/compass/useTargetBearing';
import { useArrivalDetector } from '@/compass/useArrivalDetector';
import { ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import { formatDistanceCs, haversineMeters } from '@/compass/distance';
import { compassArrowRotation } from '@/compass/rotation';
import type { PermissionState } from '@/compass/permissions';
import type { Mode } from '@/stores/settingsStore';

/** Minimum distance (meters) to move before recomputing the target pub. */
const RECOMPUTE_DISTANCE_M = 50;

type TargetPosition = {
  lat: number;
  lng: number;
  accuracyMeters: number;
};

function hasMovedEnoughForRetarget(current: TargetPosition, previous: TargetPosition): boolean {
  const movedMeters = haversineMeters(previous, current);
  const accuracyAwareThreshold = Math.max(
    RECOMPUTE_DISTANCE_M,
    current.accuracyMeters,
    previous.accuracyMeters,
  );

  return movedMeters >= accuracyAwareThreshold;
}

export interface UseCompassResult {
  arrowRotation: SharedValue<number | null>;
  distanceMeters: number | null;
  distanceFormatted: string | null;
  pub: Pub | null;
  revealed: boolean;
  reveal: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  reroll: () => void;
  retrySearch: () => void;
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

  // — Permission state —
  const [permissionState, setPermissionState] = useState<PermissionState>('undetermined');

  // — Position / heading —
  const { position } = useDevicePosition(permissionState === 'granted');
  const { smoothedHeading, accuracyDeg, hasMagnetometer } = useDeviceHeading();

  // — Pub data loading state —
  const [pubsLoaded, setPubsLoaded] = useState(() => isLoaded());
  const [searchRetryNonce, setSearchRetryNonce] = useState(0);
  const forceNextSearchRef = useRef(false);

  // Fetch pubs from Mapy.cz whenever the user's position changes. The data
  // layer short-circuits if the user hasn't moved more than ~2 km from the
  // previous fetch center (or if a fetch is already in-flight), so this is
  // safe to call on every GPS update. We intentionally do not abort the
  // network request on cleanup — GPS jitter would otherwise cancel in-flight
  // fetches every few seconds and prevent any data from ever loading.
  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    const force = forceNextSearchRef.current;
    forceNextSearchRef.current = false;

    fetchPubsNear(position.lat, position.lng, undefined, { force })
      .then(() => {
        if (!cancelled) setPubsLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useCompass] fetchPubsNear failed:', err);
        setPubsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng, searchRetryNonce]);

  // — Permission check on mount —
  useEffect(() => {
    ensureLocationPermission().then(setPermissionState).catch(() => {
      setPermissionState('denied');
    });
  }, []);

  // — Target pub state —
  const [currentPub, setCurrentPub] = useState<Pub | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [, bumpTargetSelectionRevision] = useState(0);

  // Track last position used to select a target, to avoid re-selecting on every tiny GPS twitch.
  const lastTargetPosRef = useRef<TargetPosition | null>(null);
  // Track last inputs that determined the current target.
  const lastModeRef = useRef<Mode | null>(null);
  const lastMaxKmRef = useRef<number | null | undefined>(undefined);
  const lastSeedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!position || !pubsLoaded) return;

    const { lat, lng, accuracyMeters } = position;
    const maxKm = maxDistanceKm ?? undefined;
    const lastPos = lastTargetPosRef.current;

    // Check if we should recompute
    const modeChanged = mode !== lastModeRef.current;
    const maxKmChanged = maxDistanceKm !== lastMaxKmRef.current;
    const seedChanged = surpriseSeed !== lastSeedRef.current;

    const currentPos = { lat, lng, accuracyMeters };
    const positionMoved = lastPos === null || hasMovedEnoughForRetarget(currentPos, lastPos);

    if (modeChanged || maxKmChanged || seedChanged || positionMoved) {
      lastTargetPosRef.current = currentPos;
      lastModeRef.current = mode;
      lastMaxKmRef.current = maxDistanceKm;
      lastSeedRef.current = surpriseSeed;

      const pub =
        mode === 'nearest'
          ? findNearestPub({ lat, lng, maxKm })
          : findRandomPubInRadius({ lat, lng, maxKm, seed: surpriseSeed });

      setCurrentPub(pub);
      // Only reset revealed when actually changing to a different pub
      setRevealed((prev) => {
        if (pub?.id !== currentPub?.id) return false;
        return prev;
      });
      bumpTargetSelectionRevision((revision) => revision + 1);
    }
  }, [position, pubsLoaded, mode, maxDistanceKm, surpriseSeed]);

  // — Bearing / distance —
  const { bearing, distanceMeters } = useTargetBearing(
    position ? { lat: position.lat, lng: position.lng } : null,
    currentPub,
  );
  const bearingValue = useSharedValue<number | null>(null);

  useEffect(() => {
    bearingValue.value = bearing;
  }, [bearing, bearingValue]);

  // — Arrival detection —
  const { arrived, dismiss: dismissArrival } = useArrivalDetector({
    distanceMeters,
    gpsAccuracyMeters: position?.accuracyMeters ?? null,
    targetPubId: currentPub?.id ?? null,
    hapticEnabled,
    soundEnabled,
  });

  // — Arrow rotation —
  // DEV-ONLY: hardcoded angle for App Store screenshots in the iOS Simulator,
  // which has no magnetometer. Set to null to use the real device heading.
  const SCREENSHOT_ARROW_DEG: number | null = __DEV__ ? 30 : null;

  const arrowRotation = useDerivedValue<number | null>(() => {
    if (SCREENSHOT_ARROW_DEG !== null) {
      return SCREENSHOT_ARROW_DEG;
    }

    const currentBearing = bearingValue.value;
    const currentHeading = smoothedHeading.value;

    if (currentBearing === null || currentHeading === null) {
      return null;
    }

    return compassArrowRotation(currentBearing, currentHeading);
  });

  // — Distance formatted —
  const distanceFormatted = distanceMeters !== null ? formatDistanceCs(distanceMeters) : null;

  // — isLoading —
  // The full-screen loading state must appear ONLY during a genuine cold start:
  // before pub data has loaded, before the first GPS fix, or before the very
  // first target has been selected (also the state retrySearch resets us to).
  // It must NOT react to mode / maxDistance / seed changes: those recompute the
  // target synchronously and locally inside the selection effect, so gating on
  // ref-vs-prop staleness would unmount the whole compass for a single frame and
  // make the screen visibly jump and re-load on every toggle.
  const hasSelectedTarget = lastTargetPosRef.current !== null;
  const isLoading = !pubsLoaded || position === null || !hasSelectedTarget;

  // — Actions —
  const reveal = useCallback(() => {
    if (!currentPub) return;

    setRevealed(true);
    setRevealedPub(currentPub);
  }, [currentPub, setRevealedPub]);

  const reroll = useCallback(() => {
    bumpSurpriseSeed();
  }, [bumpSurpriseSeed]);

  const retrySearch = useCallback(() => {
    forceNextSearchRef.current = true;
    lastTargetPosRef.current = null;
    lastModeRef.current = null;
    lastMaxKmRef.current = undefined;
    lastSeedRef.current = null;
    setCurrentPub(null);
    setRevealed(false);
    setPubsLoaded(false);
    setSearchRetryNonce((nonce) => nonce + 1);
  }, []);

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
    retrySearch,
    arrived,
    dismissArrival,
    headingAccuracy: accuracyDeg,
    hasMagnetometer,
    permissionState,
    requestPermission,
    isLoading,
  };
}
