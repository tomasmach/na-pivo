/**
 * Public facade hook — the only surface the screens consume for compass behavior.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { fetchPubsNear, findNearestPub, findRandomPubInRadius, isLoaded } from '@/data/pubs';
import type { HoursStatus, Pub } from '@/data/pubs';
import { fetchPubHours } from '@/data/hoursClient';
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
const UNLIMITED_SEARCH_RADIUS_KM = 100;

type TargetPosition = {
  lat: number;
  lng: number;
  accuracyMeters: number;
};

/** Per-pub opening-hours enrichment held in local state, keyed by pub id. */
type PubHoursState = {
  status: HoursStatus;
  openingHours?: string | null;
  isOpenNow?: boolean | null;
  nextChange?: string | null;
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
  skip: () => void;
  retrySearch: () => void;
  arrived: boolean;
  dismissArrival: () => void;
  headingAccuracy: number | null;
  hasMagnetometer: boolean;
  permissionState: PermissionState;
  requestPermission: () => Promise<void>;
  isLoading: boolean;
  searchFailed: boolean;
}

export function useCompass(): UseCompassResult {
  // — Settings from store —
  const mode = useSettingsStore((s) => s.mode);
  const setMode = useSettingsStore((s) => s.setMode);
  const maxDistanceKm = useSettingsStore((s) => s.maxDistanceKm);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const hideClosedPubs = useSettingsStore((s) => s.hideClosedPubs);
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
  const [pubDataRevision, bumpPubDataRevision] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
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
    const radiusKm = maxDistanceKm ?? UNLIMITED_SEARCH_RADIUS_KM;
    forceNextSearchRef.current = false;

    fetchPubsNear(position.lat, position.lng, undefined, { force, radiusKm })
      .then(() => {
        if (!cancelled) {
          setSearchFailed(false);
          setPubsLoaded(true);
          bumpPubDataRevision((revision) => revision + 1);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useCompass] fetchPubsNear failed:', err);
        setSearchFailed(true);
        setPubsLoaded(true);
        bumpPubDataRevision((revision) => revision + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng, maxDistanceKm, searchRetryNonce]);

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

  // — Excluded pubs (skip + auto-skip-closed) —
  // Two id sets that grow while the user stands in one place:
  //   • skippedIds    — pubs the user explicitly skipped via skip().
  //   • autoClosedIds — pubs auto-skipped because their RESOLVED hours said
  //                     isOpenNow === false while hideClosedPubs is on.
  // They are combined into excludeIds for findNearestPub/findRandomPubInRadius so
  // the selection walks to the next eligible pub. Both sets are held in refs so
  // reading them inside effects never adds a dependency (which would retrigger on
  // every mutation); a separate `excludeRevision` state counter is bumped on each
  // change to drive re-selection. Both reset on context change (see below) so they
  // never accumulate across moves/mode/maxKm changes — only while standing still.
  const skippedIdsRef = useRef<Set<string>>(new Set());
  const autoClosedIdsRef = useRef<Set<string>>(new Set());
  const [excludeRevision, setExcludeRevision] = useState(0);

  // Track last position used to select a target, to avoid re-selecting on every tiny GPS twitch.
  const lastTargetPosRef = useRef<TargetPosition | null>(null);
  // Track last inputs that determined the current target.
  const lastModeRef = useRef<Mode | null>(null);
  const lastMaxKmRef = useRef<number | null | undefined>(undefined);
  const lastSeedRef = useRef<number | null>(null);
  // Track the excludeRevision the current target was selected against, so the
  // selection effect recomputes when (and only when) the exclusion set changes.
  const lastExcludeRevisionRef = useRef<number>(0);

  /** Clear both exclusion sets and bump the revision so selection re-runs from a
   *  clean slate. Called whenever the selection context changes (moved enough /
   *  mode / maxKm changed) and on retrySearch — the sets must only accumulate
   *  while the user is standing in one place. Returns true if anything was cleared. */
  const resetExclusions = useCallback((): boolean => {
    const hadAny = skippedIdsRef.current.size > 0 || autoClosedIdsRef.current.size > 0;
    if (skippedIdsRef.current.size > 0) skippedIdsRef.current = new Set();
    if (autoClosedIdsRef.current.size > 0) autoClosedIdsRef.current = new Set();
    return hadAny;
  }, []);

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

    // The exclusion set changed (a skip() or an auto-skip-closed) → walk to the
    // next eligible pub even though position/mode/maxKm/seed are unchanged.
    const excludeChanged = excludeRevision !== lastExcludeRevisionRef.current;

    // A genuine context change (the user moved enough, or switched mode/maxKm)
    // means the accumulated skip/auto-closed exclusions are stale: they only
    // apply while standing in one place. Clear them BEFORE building excludeIds so
    // the next selection starts from a clean slate. seed/excludeRevision changes
    // are NOT context changes — they intentionally keep accumulating.
    const contextChanged = modeChanged || maxKmChanged || positionMoved;
    if (contextChanged) {
      resetExclusions();
    }

    if (modeChanged || maxKmChanged || seedChanged || positionMoved || excludeChanged) {
      lastTargetPosRef.current = currentPos;
      lastModeRef.current = mode;
      lastMaxKmRef.current = maxDistanceKm;
      lastSeedRef.current = surpriseSeed;
      lastExcludeRevisionRef.current = excludeRevision;

      const excludeIds = [
        ...skippedIdsRef.current,
        ...autoClosedIdsRef.current,
      ];

      const pub =
        mode === 'nearest'
          ? findNearestPub({ lat, lng, maxKm, excludeIds })
          : findRandomPubInRadius({ lat, lng, maxKm, seed: surpriseSeed, excludeIds });

      setCurrentPub(pub);
      // Only reset revealed when actually changing to a different pub
      setRevealed((prev) => {
        if (pub?.id !== currentPub?.id) return false;
        return prev;
      });
      bumpTargetSelectionRevision((revision) => revision + 1);
    }
  }, [
    position,
    pubsLoaded,
    pubDataRevision,
    mode,
    maxDistanceKm,
    surpriseSeed,
    excludeRevision,
    resetExclusions,
  ]);

  // — Opening hours enrichment (NON-BLOCKING) —
  // When the targeted pub changes (by id), look up its opening hours from the
  // app's own backend. This is a pure enrichment layered on top of selection:
  // it never feeds back into target selection, distance, arrival, or isLoading,
  // so a slow / failed / dormant backend cannot disturb the compass. Results are
  // stored in a separate map keyed by pub id; failures leave the entry undefined.
  const currentPubId = currentPub?.id ?? null;
  const [hoursById, setHoursById] = useState<Map<string, PubHoursState>>(() => new Map());

  // Mirror the hours map into a ref so the fetch effect can read the latest
  // contents (to skip already-resolved ids) without listing it as a dependency,
  // which would otherwise retrigger the effect every time hours resolve.
  const hoursByIdRef = useRef(hoursById);
  hoursByIdRef.current = hoursById;

  useEffect(() => {
    if (!currentPubId || !currentPub) return;

    // Already resolved (or resolving) for this exact pub id → don't refetch.
    if (hoursByIdRef.current.has(currentPubId)) return;

    const controller = new AbortController();
    const pubForLookup = currentPub;

    // Mark this id as in-flight so consumers can show a neutral 'loading' state
    // and so we don't kick off a duplicate request on the next render.
    setHoursById((prev) => {
      const next = new Map(prev);
      next.set(currentPubId, { status: 'loading' });
      return next;
    });

    fetchPubHours([pubForLookup], controller.signal)
      .then((resultMap) => {
        if (controller.signal.aborted) return;
        const result = resultMap.get(currentPubId);
        // Empty/partial map (dormant backend, failure, or this id missing) →
        // drop the 'loading' placeholder so hours simply don't appear.
        setHoursById((prev) => {
          const next = new Map(prev);
          // Cache only RESOLVED results. 'pending' (backend lazy-fill still in
          // progress) and 'error' are transient — drop them so a later
          // reselection of this pub retries, instead of caching a dead value for
          // the lifetime of the hook and never showing the hours the backend
          // fills in moments later.
          if (result && result.status !== 'pending' && result.status !== 'error') {
            next.set(currentPubId, {
              status: result.status,
              openingHours: result.openingHours,
              isOpenNow: result.isOpenNow,
              nextChange: result.nextChange,
            });
          } else {
            next.delete(currentPubId);
          }
          return next;
        });
      })
      .catch(() => {
        // fetchPubHours never throws, but guard anyway: clear the placeholder so
        // a failure leaves hours undefined rather than stuck on 'loading'.
        if (controller.signal.aborted) return;
        setHoursById((prev) => {
          const next = new Map(prev);
          next.delete(currentPubId);
          return next;
        });
      });

    return () => {
      controller.abort();
      // Clear the in-flight 'loading' placeholder for this id. The aborted
      // .then/.catch above early-return without touching the map, so without
      // this the stale 'loading' entry would make the cache guard above
      // (`hoursByIdRef.current.has(currentPubId)`) skip a later refetch if the
      // selection returns to this same pub (GPS jitter, walking back, a reroll
      // landing on a previously-seen pub) — leaving it stuck on 'loading'
      // forever. Only delete while still 'loading'; never clobber a resolved
      // entry (the abort can race a just-completed resolution).
      setHoursById((prev) => {
        if (prev.get(currentPubId)?.status !== 'loading') return prev;
        const next = new Map(prev);
        next.delete(currentPubId);
        return next;
      });
    };
    // Intentionally keyed only on the pub id: the same pub object identity can
    // change across renders without the target actually changing, and re-running
    // on every identity churn would cancel/restart the request in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPubId]);

  // Merge the resolved hours onto the targeted pub so consumers can read
  // pub.isOpenNow / pub.hoursStatus. A new object is only created when the pub
  // or its hours actually change, keeping referential stability for memoized
  // consumers and avoiding render churn.
  const hoursForCurrent = currentPubId ? hoursById.get(currentPubId) : undefined;
  const enrichedPub = useMemo<Pub | null>(() => {
    if (!currentPub) return null;
    if (!hoursForCurrent) return currentPub;
    return {
      ...currentPub,
      openingHours: hoursForCurrent.openingHours,
      isOpenNow: hoursForCurrent.isOpenNow,
      nextChange: hoursForCurrent.nextChange,
      hoursStatus: hoursForCurrent.status,
    };
  }, [currentPub, hoursForCurrent]);

  // — Auto-skip known-closed pubs (NON-BLOCKING) —
  // When hideClosedPubs is on and the CURRENT pub's hours have RESOLVED to a
  // definite isOpenNow === false, add its id to autoClosedIds and bump
  // excludeRevision; the selection effect then reselects the next nearest pub,
  // excluding it. This reuses the existing per-pub hours fetch, so the walk
  // proceeds one pub at a time and terminates as soon as an open / unknown pub is
  // reached (or findNearestPub returns null → empty state).
  //
  // Loop safety:
  //   • Act ONLY on RESOLVED hours: status must be 'ok' AND isOpenNow === false.
  //     Never on loading / pending / error / unknown, and never on open/unknown.
  //   • autoClosedIds only ever GROWS and each id is added at most once (guarded
  //     by the `.has` check), so a given closed pub triggers exactly one bump.
  //   • Keyed on currentPubId + hideClosedPubs + the resolved status/isOpenNow,
  //     so it re-evaluates precisely when those change, not on render churn.
  const hoursStatusForCurrent = hoursForCurrent?.status;
  const isOpenNowForCurrent = hoursForCurrent?.isOpenNow;
  useEffect(() => {
    if (!hideClosedPubs || !currentPubId) return;
    if (hoursStatusForCurrent !== 'ok') return;
    if (isOpenNowForCurrent !== false) return;
    if (autoClosedIdsRef.current.has(currentPubId)) return;

    autoClosedIdsRef.current = new Set(autoClosedIdsRef.current).add(currentPubId);
    setExcludeRevision((revision) => revision + 1);
  }, [currentPubId, hideClosedPubs, hoursStatusForCurrent, isOpenNowForCurrent]);

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

  // Skip the current pub: add its id to skippedIds and bump excludeRevision so
  // the selection effect reselects the next nearest eligible pub (excluding both
  // skipped and auto-closed ids). No-op when there is no current pub. skippedIds
  // only grows while standing in one place; it resets on any context change.
  const skip = useCallback(() => {
    const id = currentPub?.id;
    if (!id) return;
    if (skippedIdsRef.current.has(id)) return;
    skippedIdsRef.current = new Set(skippedIdsRef.current).add(id);
    setExcludeRevision((revision) => revision + 1);
  }, [currentPub]);

  const retrySearch = useCallback(() => {
    forceNextSearchRef.current = true;
    lastTargetPosRef.current = null;
    lastModeRef.current = null;
    lastMaxKmRef.current = undefined;
    lastSeedRef.current = null;
    // Clear accumulated skip / auto-closed exclusions so the retry starts fresh.
    // The selection effect will re-run via the state resets below; align the
    // tracked revision so it does not also fire an extra excludeChanged pass.
    resetExclusions();
    lastExcludeRevisionRef.current = excludeRevision;
    setCurrentPub(null);
    setRevealed(false);
    setSearchFailed(false);
    setPubsLoaded(false);
    setSearchRetryNonce((nonce) => nonce + 1);
  }, [excludeRevision, resetExclusions]);

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
    pub: enrichedPub,
    revealed,
    reveal,
    mode,
    setMode,
    reroll,
    skip,
    retrySearch,
    arrived,
    dismissArrival,
    headingAccuracy: accuracyDeg,
    hasMagnetometer,
    permissionState,
    requestPermission,
    isLoading,
    searchFailed,
  };
}
