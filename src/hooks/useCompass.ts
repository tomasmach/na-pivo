/**
 * Public facade hook — the only surface the screens consume for compass behavior.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import {
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  clearPubsSnapshot,
  fetchPubsNear,
  findNearestPub,
  findRandomPubInRadius,
  isLoaded,
  renameLocalPub,
} from '@/data/pubs';
import type { HoursStatus, Pub, VenueKind } from '@/data/pubs';
import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import { enqueuePubReport } from '@/data/pubReportQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
import { buildPubNameCorrectionEntry } from '@/data/pubNameCorrectionsClient';
import { enqueuePubNameCorrection } from '@/data/pubNameCorrectionsQueue';
import { geohash8 } from '@/data/geohash';
import type { CommunityBeer, WeeklyHours } from '@/data/communityClient';
import { computeOpenState } from '@/data/communityHours';
import { recordWalkingSample } from '@/data/walkingTelemetry';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useCommunityStore } from '@/stores/communityStore';
import { useFocusedPubStore, type FocusedPub } from '@/stores/focusedPubStore';
import { useDevicePosition } from '@/compass/useDevicePosition';
import { useDeviceHeading } from '@/compass/useDeviceHeading';
import { useTargetBearing } from '@/compass/useTargetBearing';
import { useArrivalDetector } from '@/compass/useArrivalDetector';
import { checkLocationPermission, ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import { formatDistanceCs, haversineMeters } from '@/compass/distance';
import { compassArrowRotation } from '@/compass/rotation';
import type { PermissionState } from '@/compass/permissions';
import type { Mode } from '@/stores/settingsStore';

/** Minimum distance (meters) to move before recomputing the target pub. */
const RECOMPUTE_DISTANCE_M = 50;
const UNLIMITED_SEARCH_RADIUS_KM = 100;
const HOURS_LOADING_FALLBACK_MS = 5_000;
const PENDING_HOURS_RETRY_DELAYS_MS = [10_000, 30_000, 90_000, 300_000] as const;

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
  /** Origin of the resolved hours, e.g. "community" | "firmy". */
  source?: string | null;
  /** Structured weekly hours when the source is community (for prefill). */
  communityHours?: WeeklyHours | null;
  /** Beers on tap from the backend, when present. */
  beers?: CommunityBeer[];
  /** Public star rating from the enrichment source, on a 0-5 scale. */
  rating?: number | null;
  /** Number of user ratings behind `rating`, when known. */
  ratingCount?: number | null;
  /** Human rating label from the source, when known. */
  ratingLabel?: string | null;
  /** Whether the backend source explicitly marks this pub as having a garden. */
  hasGarden?: boolean | null;
  /** Backend pub-vs-not verdict; 'not_pub' triggers auto-exclusion. */
  venueKind?: VenueKind;
};

/** Build a cached hours entry from a resolved fetch result. `status` is passed
 *  in because callers decide the visible status differently (the initial fetch
 *  keeps a prior 'unknown' visible across a pending re-resolve; the retry uses
 *  the result's own status). All other fields copy straight through. */
function hoursStateFromResult(result: PubHoursResult, status: HoursStatus): PubHoursState {
  return {
    status,
    openingHours: result.openingHours,
    isOpenNow: result.isOpenNow,
    nextChange: result.nextChange,
    source: result.source,
    communityHours: result.communityHours,
    beers: result.beers,
    rating: result.rating,
    ratingCount: result.ratingCount,
    ratingLabel: result.ratingLabel,
    hasGarden: result.hasGarden,
    venueKind: result.venueKind,
  };
}

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
  reportCurrentPub: (reason: PubReportReason) => Promise<boolean>;
  renameCurrentPub: (suggestedName: string) => Promise<boolean>;
  retrySearch: () => void;
  arrived: boolean;
  dismissArrival: () => void;
  headingAccuracy: number | null;
  hasMagnetometer: boolean;
  permissionState: PermissionState;
  requestPermission: () => Promise<void>;
  isLoading: boolean;
  searchFailed: boolean;
  currentPosition: { lat: number; lng: number; accuracyMeters: number } | null;
  /** A friend's coarse pub the needle is pointing at ("Ukaž na kompasu", §F2). */
  focusedPub: FocusedPub | null;
  /** Drop the friend focus and return to the normal nearest/surprise target. */
  clearFocusedPub: () => void;
}

export function useCompass(
  beerBrandKey: string | null = null,
  amenityKeys: readonly string[] = [],
  sensorsEnabled: boolean = true,
): UseCompassResult {
  // — Settings from store —
  const mode = useSettingsStore((s) => s.mode);
  const setMode = useSettingsStore((s) => s.setMode);
  const maxDistanceKm = useSettingsStore((s) => s.maxDistanceKm);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const hideClosedPubs = useSettingsStore((s) => s.hideClosedPubs);
  const preferRatedPubs = useSettingsStore((s) => s.preferRatedPubs);
  const preferGardenPubs = useSettingsStore((s) => s.preferGardenPubs);
  const surpriseSeed = useSettingsStore((s) => s.surpriseSeed);
  const bumpSurpriseSeed = useSettingsStore((s) => s.bumpSurpriseSeed);

  // — Pub store —
  const setRevealedPub = usePubStore((s) => s.setRevealedPub);
  const reportedPubIds = usePubStore((s) => s.reportedPubIds);
  const reportedCacheKeys = usePubStore((s) => s.reportedCacheKeys);
  const addReportedPub = usePubStore((s) => s.addReportedPub);
  const catalogRevision = usePubStore((s) => s.catalogRevision);
  const bumpCatalogRevision = usePubStore((s) => s.bumpCatalogRevision);

  // — Permission state —
  const [permissionState, setPermissionState] = useState<PermissionState>('undetermined');

  // — Tab focus gate —
  // The compass lives in a persistent <Tabs> navigator, so its screen stays
  // MOUNTED even while the user is on the Počítadlo (counter) tab. Without
  // gating, the GPS watcher (1s interval) and the magnetometer would keep
  // running invisibly for an off-screen tab — duplicating the counter's own
  // GPS watcher and draining the battery. Track focus and pause both sensors on
  // blur, mirroring useNearbyPub.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // — Position / heading —
  const { position } = useDevicePosition(
    focused && sensorsEnabled && permissionState === 'granted',
  );
  const { smoothedHeading, accuracyDeg, hasMagnetometer } = useDeviceHeading(
    focused && sensorsEnabled,
  );
  const positionLat = position?.lat;
  const positionLng = position?.lng;

  useEffect(() => {
    if (position) recordWalkingSample(position);
  }, [position]);

  // — Pub data loading state —
  const [pubsLoaded, setPubsLoaded] = useState(() => isLoaded());
  const [pubDataRevision, bumpPubDataRevision] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchRetryNonce, setSearchRetryNonce] = useState(0);
  const forceNextSearchRef = useRef(false);

  // Track the maxDistanceKm the last fetch effect ran with, so we can tell a
  // radius-only re-run (debounce it) apart from a GPS/mount/retry re-run (fire
  // immediately). The distance slider commits on every step while dragging, so
  // raising the radius fires several maxDistanceKm changes — and each full fetch
  // is a network lookup. Debouncing here, the layer that actually sees the
  // churn, coalesces a drag into a single fetch.
  const lastFetchedMaxKmRef = useRef<number | null | undefined>(undefined);
  const lastFetchedBeerBrandKeyRef = useRef<string>("");
  const lastFetchedAmenityKeyRef = useRef<string>("");
  const filterRequestInFlightKeyRef = useRef<string | null>(null);
  const latestFilterKeyRef = useRef("|");
  const mountedRef = useRef(true);
  const radiusDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const RADIUS_DEBOUNCE_MS = 700;
  const activeBeerBrandKey = (beerBrandKey ?? "").trim();
  const activeAmenityKey = Array.from(new Set(amenityKeys)).sort().join(',');
  const activeFilterKey = `${activeBeerBrandKey}|${activeAmenityKey}`;
  const [fetchedFilterKey, setFetchedFilterKey] = useState('|');
  const [selectedFilterKey, setSelectedFilterKey] = useState('|');
  const filterLookupPending = activeFilterKey !== selectedFilterKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch pubs through the backend/Mapy lookup whenever the user's position changes. The data
  // layer short-circuits if the user hasn't moved more than ~2 km from the
  // previous fetch center (or if a fetch is already in-flight), so this is
  // safe to call on every GPS update. We intentionally do not abort the
  // network request on cleanup — GPS jitter would otherwise cancel in-flight
  // fetches every few seconds and prevent any data from ever loading.
  useEffect(() => {
    latestFilterKeyRef.current = activeFilterKey;
    if (positionLat == null || positionLng == null) return;
    if (filterRequestInFlightKeyRef.current === activeFilterKey) return;
    let cancelled = false;
    let preserveFilterRequest = false;

    const runFetch = () => {
      if (cancelled) return;
      const brandFilterChanged = activeBeerBrandKey !== lastFetchedBeerBrandKeyRef.current;
      const amenityFilterChanged = activeAmenityKey !== lastFetchedAmenityKeyRef.current;
      const force = forceNextSearchRef.current || brandFilterChanged || amenityFilterChanged;
      if (brandFilterChanged || amenityFilterChanged) {
        preserveFilterRequest = true;
        filterRequestInFlightKeyRef.current = activeFilterKey;
      }
      const radiusKm = maxDistanceKm ?? UNLIMITED_SEARCH_RADIUS_KM;
      forceNextSearchRef.current = false;
      lastFetchedMaxKmRef.current = maxDistanceKm;
      lastFetchedBeerBrandKeyRef.current = activeBeerBrandKey;
      lastFetchedAmenityKeyRef.current = activeAmenityKey;

      fetchPubsNear(positionLat, positionLng, undefined, {
        force,
        radiusKm,
        beerBrandKey: activeBeerBrandKey || null,
        amenityKeys: activeAmenityKey ? activeAmenityKey.split(',') : [],
      })
        .then(() => {
          if (
            !cancelled &&
            mountedRef.current &&
            latestFilterKeyRef.current === activeFilterKey
          ) {
            if (filterRequestInFlightKeyRef.current === activeFilterKey) {
              filterRequestInFlightKeyRef.current = null;
            }
            setFetchedFilterKey(activeFilterKey);
            setSearchFailed(false);
            setPubsLoaded(true);
            bumpPubDataRevision((revision) => revision + 1);
          }
        })
        .catch((err) => {
          if (
            cancelled ||
            !mountedRef.current ||
            latestFilterKeyRef.current !== activeFilterKey
          ) return;
          if (filterRequestInFlightKeyRef.current === activeFilterKey) {
            filterRequestInFlightKeyRef.current = null;
          }
          setFetchedFilterKey(activeFilterKey);
          console.warn('[useCompass] fetchPubsNear failed:', err);
          setSearchFailed(true);
          setPubsLoaded(true);
          bumpPubDataRevision((revision) => revision + 1);
        });
    };

    // Debounce ONLY the radius-change path: when maxDistanceKm is the sole thing
    // that changed (the slider drag), coalesce rapid successive changes into one
    // fetch. The first run on mount (ref still `undefined`), GPS-driven calls,
    // and forced retries are never delayed.
    const radiusOnlyChange =
      lastFetchedMaxKmRef.current !== undefined &&
      maxDistanceKm !== lastFetchedMaxKmRef.current &&
      activeBeerBrandKey === lastFetchedBeerBrandKeyRef.current &&
      activeAmenityKey === lastFetchedAmenityKeyRef.current &&
      !forceNextSearchRef.current;

    if (radiusOnlyChange) {
      if (radiusDebounceRef.current) clearTimeout(radiusDebounceRef.current);
      radiusDebounceRef.current = setTimeout(runFetch, RADIUS_DEBOUNCE_MS);
    } else {
      runFetch();
    }

    return () => {
      // A hard-filter request must survive same-filter GPS rerenders. The next
      // effect sees its in-flight key and does not enqueue a duplicate; a real
      // filter change is rejected by latestFilterKeyRef in the callback.
      if (!preserveFilterRequest) cancelled = true;
      if (radiusDebounceRef.current) {
        clearTimeout(radiusDebounceRef.current);
        radiusDebounceRef.current = undefined;
      }
    };
  }, [
    positionLat,
    positionLng,
    maxDistanceKm,
    activeBeerBrandKey,
    activeAmenityKey,
    activeFilterKey,
    searchRetryNonce,
  ]);

  // — Permission check on mount / return from system settings —
  useEffect(() => {
    let mounted = true;

    const refreshPermission = () => {
      checkLocationPermission()
        .then((state) => {
          if (mounted) setPermissionState(state);
        })
        .catch(() => {
          if (mounted) setPermissionState('denied');
        });
    };

    refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      // iOS does not remount the tab after Linking.openSettings(). Re-read the
      // permission when the user comes back so enabling location takes effect
      // immediately instead of leaving the permission screen stuck.
      if (state === 'active') refreshPermission();
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // — Target pub state —
  const [currentPub, setCurrentPub] = useState<Pub | null>(null);
  const currentPubId = currentPub?.id ?? null;
  const [revealed, setRevealed] = useState(false);
  const [, bumpTargetSelectionRevision] = useState(0);
  // State mirror of `lastTargetPosRef !== null` so render code (isLoading)
  // never reads the ref during render. Set by the selection effect, cleared by
  // retrySearch — always in lockstep with the ref.
  const [hasSelectedTarget, setHasSelectedTarget] = useState(false);

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
  //   • notPubIdsRef   — pubs the backend classified as venueKind === 'not_pub'.
  //     Hidden UNCONDITIONALLY (independent of hideClosedPubs) — these are not
  //     pubs at all, so the compass must never lead to them. Treated exactly like
  //     auto-closed for selection: added to excludeIds, drives a re-selection.
  const notPubIdsRef = useRef<Set<string>>(new Set());
  const lowRatedIdsRef = useRef<Set<string>>(new Set());
  const noGardenIdsRef = useRef<Set<string>>(new Set());
  const [excludeRevision, setExcludeRevision] = useState(0);

  // Track last position used to select a target, to avoid re-selecting on every tiny GPS twitch.
  const lastTargetPosRef = useRef<TargetPosition | null>(null);
  // Track last inputs that determined the current target.
  const lastModeRef = useRef<Mode | null>(null);
  const lastMaxKmRef = useRef<number | null | undefined>(undefined);
  const lastSeedRef = useRef<number | null>(null);
  const lastReportedPubIdsRef = useRef<string[]>(reportedPubIds);
  const lastReportedCacheKeysRef = useRef<string[]>(reportedCacheKeys);
  const lastCatalogRevisionRef = useRef<number>(catalogRevision);
  const lastBeerBrandKeyRef = useRef<string>(activeBeerBrandKey);
  const lastAmenityKeyRef = useRef<string>(activeAmenityKey);
  const lastPubDataRevisionRef = useRef<number>(pubDataRevision);
  // Track the excludeRevision the current target was selected against, so the
  // selection effect recomputes when (and only when) the exclusion set changes.
  const lastExcludeRevisionRef = useRef<number>(0);

  /** Clear all exclusion sets so selection re-runs from a clean slate. Called
   *  whenever the selection context changes (moved enough / mode / maxKm changed)
   *  and on retrySearch — the sets must only accumulate while the user is standing
   *  in one place. */
  const resetExclusions = useCallback(() => {
    if (skippedIdsRef.current.size > 0) skippedIdsRef.current = new Set();
    if (autoClosedIdsRef.current.size > 0) autoClosedIdsRef.current = new Set();
    if (notPubIdsRef.current.size > 0) notPubIdsRef.current = new Set();
    if (lowRatedIdsRef.current.size > 0) lowRatedIdsRef.current = new Set();
    if (noGardenIdsRef.current.size > 0) noGardenIdsRef.current = new Set();
  }, []);

  /** Add `id` to an exclusion ref set (copy-on-write so effects keyed on the set
   *  identity notice) and bump excludeRevision to drive a re-selection. A no-op
   *  when already excluded, so each pub triggers exactly one bump. Shared by the
   *  auto-skip effects (closed / not-pub / low-rated / no-garden) and skip(). */
  const addExcluded = useCallback((ref: MutableRefObject<Set<string>>, id: string) => {
    if (ref.current.has(id)) return;
    ref.current = new Set(ref.current).add(id);
    setExcludeRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (!position || !pubsLoaded) return;
    if (activeFilterKey !== fetchedFilterKey) return;

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
    const reportedChanged =
      reportedPubIds !== lastReportedPubIdsRef.current ||
      reportedCacheKeys !== lastReportedCacheKeysRef.current;
    const catalogChanged = catalogRevision !== lastCatalogRevisionRef.current;
    const beerBrandChanged = activeBeerBrandKey !== lastBeerBrandKeyRef.current;
    const amenityFilterChanged = activeAmenityKey !== lastAmenityKeyRef.current;
    const pubDataChanged =
      (beerBrandChanged || amenityFilterChanged) &&
      pubDataRevision !== lastPubDataRevisionRef.current;

    // A genuine context change (the user moved enough, or switched mode/maxKm)
    // means the accumulated skip/auto-closed exclusions are stale: they only
    // apply while standing in one place. Clear them BEFORE building excludeIds so
    // the next selection starts from a clean slate. seed/excludeRevision changes
    // are NOT context changes — they intentionally keep accumulating.
    const contextChanged = modeChanged || maxKmChanged || positionMoved || pubDataChanged;
    if (contextChanged) {
      resetExclusions();
    }

    if (
      modeChanged ||
      maxKmChanged ||
      seedChanged ||
      positionMoved ||
      excludeChanged ||
      reportedChanged ||
      catalogChanged ||
      pubDataChanged
    ) {
      lastTargetPosRef.current = currentPos;
      setHasSelectedTarget(true);
      lastModeRef.current = mode;
      lastMaxKmRef.current = maxDistanceKm;
      lastSeedRef.current = surpriseSeed;
      lastReportedPubIdsRef.current = reportedPubIds;
      lastReportedCacheKeysRef.current = reportedCacheKeys;
      lastCatalogRevisionRef.current = catalogRevision;
      lastBeerBrandKeyRef.current = activeBeerBrandKey;
      lastAmenityKeyRef.current = activeAmenityKey;
      lastPubDataRevisionRef.current = pubDataRevision;
      lastExcludeRevisionRef.current = excludeRevision;

      const excludeIds = Array.from(new Set([
        ...reportedPubIds,
        ...skippedIdsRef.current,
        ...autoClosedIdsRef.current,
        ...notPubIdsRef.current,
        ...lowRatedIdsRef.current,
        ...noGardenIdsRef.current,
      ]));
      // Reported places are excluded by geohash-8 cell too — the coordinate-
      // derived Mapy.cz ids change between fetches, the cell does not.
      const excludeCacheKeys = reportedCacheKeys;

      const pub =
        mode === 'nearest'
          ? findNearestPub({ lat, lng, maxKm, excludeIds, excludeCacheKeys })
          : findRandomPubInRadius({
              lat,
              lng,
              maxKm,
              seed: surpriseSeed,
              excludeIds,
              excludeCacheKeys,
            });

      setCurrentPub(pub);
      setSelectedFilterKey(activeFilterKey);
      // Only reset revealed when actually changing to a different pub
      setRevealed((prev) => {
        if (pub?.id !== currentPubId) return false;
        return prev;
      });
      bumpTargetSelectionRevision((revision) => revision + 1);
    }
    lastPubDataRevisionRef.current = pubDataRevision;
  }, [
    position,
    pubsLoaded,
    pubDataRevision,
    catalogRevision,
    mode,
    maxDistanceKm,
    surpriseSeed,
    reportedPubIds,
    reportedCacheKeys,
    excludeRevision,
    activeBeerBrandKey,
    activeAmenityKey,
    activeFilterKey,
    fetchedFilterKey,
    currentPubId,
    resetExclusions,
  ]);

  // — Opening hours enrichment (NON-BLOCKING) —
  // When the targeted pub changes (by id), look up its opening hours from the
  // app's own backend. This is a pure enrichment layered on top of selection:
  // it never feeds back into target selection, distance, arrival, or isLoading,
  // so a slow / failed / dormant backend cannot disturb the compass. Results are
  // stored in a separate map keyed by pub id; failures leave the entry undefined.
  const [hoursById, setHoursById] = useState<Map<string, PubHoursState>>(() => new Map());
  // Bumped by the nextChange expiry timer below to force the fetch effect to
  // re-run and refresh a now-stale isOpenNow snapshot.
  const [hoursRefetchNonce, setHoursRefetchNonce] = useState(0);
  const pendingHoursRetryCountsRef = useRef<Map<string, number>>(new Map());
  const [pendingHoursRetryNonce, setPendingHoursRetryNonce] = useState(0);

  // Mirror the hours map into a ref so the fetch effect can read the latest
  // contents (to skip already-resolved ids) without listing it as a dependency,
  // which would otherwise retrigger the effect every time hours resolve. The
  // mirror runs in an effect (not during render) and is declared BEFORE the
  // fetch effect — effects run in declaration order, so the fetch effect always
  // reads a fresh mirror.
  const hoursByIdRef = useRef(hoursById);
  useEffect(() => {
    hoursByIdRef.current = hoursById;
  }, [hoursById]);

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
        if (result?.status === 'pending') {
          if (!pendingHoursRetryCountsRef.current.has(currentPubId)) {
            pendingHoursRetryCountsRef.current.set(currentPubId, 0);
          }
          setPendingHoursRetryNonce((nonce) => nonce + 1);
        } else {
          pendingHoursRetryCountsRef.current.delete(currentPubId);
        }
        // Empty/partial map (dormant backend, failure, or this id missing) →
        // drop the 'loading' placeholder so hours simply don't appear. Pending
        // stays visible and is retried below; it means the backend accepted the
        // lookup but deferred the proxy work to refresh_hours.
        setHoursById((prev) => {
          const next = new Map(prev);
          // Cache resolved results and the visible pending state. 'error' is
          // transient — drop it so a later reselection can retry instead of
          // caching a dead value for the lifetime of the hook.
          if (result && result.status !== 'error') {
            const previous = prev.get(currentPubId);
            const visibleStatus =
              result.status === 'pending' && previous?.status === 'unknown'
                ? 'unknown'
                : result.status;
            next.set(currentPubId, hoursStateFromResult(result, visibleStatus));
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
        pendingHoursRetryCountsRef.current.delete(currentPubId);
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
    // Keyed on the pub id (the same pub object identity can change across renders
    // without the target actually changing — re-running on identity churn would
    // cancel/restart the request in a loop) plus hoursRefetchNonce, which the
    // expiry timer bumps to force a refresh once a cached isOpenNow goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPubId, hoursRefetchNonce]);

  // Local optimistic community override for the current pub, keyed by its
  // geohash-8 cell so it follows the physical place across unstable Mapy.cz ids.
  const overrides = useCommunityStore((s) => s.overrides);
  const currentCell = useMemo(
    () => (currentPub ? geohash8(currentPub.lat, currentPub.lng) : null),
    [currentPub],
  );
  const overrideForCurrent = currentCell ? overrides[currentCell] : undefined;

  // Merge the resolved hours onto the targeted pub so consumers can read
  // pub.isOpenNow / pub.hoursStatus. A new object is only created when the pub,
  // its hours, or the local override actually change, keeping referential
  // stability for memoized consumers and avoiding render churn.
  //
  // Merge precedence:
  //   • Backend data whose source is "community" is the canonical, public truth
  //     → it WINS over the local optimistic override (the override has been
  //     accepted and round-tripped, so prefer the server copy).
  //   • Otherwise (firmy / unknown / no backend hours) the user's local override
  //     WINS, so their just-submitted edit shows immediately. For hours we
  //     compute isOpenNow / nextChange locally from the structured WeeklyHours so
  //     the OpenStatusChip stays correct before the backend round-trips.
  const hoursForCurrent = currentPubId ? hoursById.get(currentPubId) : undefined;
  const enrichedPub = useMemo<Pub | null>(() => {
    if (!currentPub) return null;

    const backendIsCommunity = hoursForCurrent?.source === 'community';

    // — Hours —
    let openingHours = hoursForCurrent?.openingHours ?? currentPub.openingHours;
    let isOpenNow = hoursForCurrent?.isOpenNow ?? null;
    let nextChange = hoursForCurrent?.nextChange ?? null;
    let hoursStatus = hoursForCurrent?.status;
    let hoursSource = hoursForCurrent?.source ?? undefined;
    let communityHours = hoursForCurrent?.communityHours ?? undefined;

    if (overrideForCurrent?.hours && !backendIsCommunity) {
      // Local override wins over firmy/unknown — compute the live state locally.
      const local = computeOpenState(overrideForCurrent.hours);
      communityHours = overrideForCurrent.hours;
      isOpenNow = local.isOpenNow;
      nextChange = local.nextChange;
      hoursStatus = 'ok';
      hoursSource = 'community';
      openingHours = null;
    }

    // — Beers —
    // Backend community beers win; otherwise the local override's beers show.
    let beers = hoursForCurrent?.beers;
    if (overrideForCurrent?.beers && !(backendIsCommunity && (hoursForCurrent?.beers?.length ?? 0) > 0)) {
      beers = overrideForCurrent.beers;
    }

    // Nothing to merge → return the bare pub for referential stability.
    if (!hoursForCurrent && !overrideForCurrent) return currentPub;

    return {
      ...currentPub,
      openingHours,
      isOpenNow,
      nextChange,
      hoursStatus,
      hoursSource,
      communityHours: communityHours ?? undefined,
      beers: beers && beers.length > 0 ? beers : undefined,
      rating: hoursForCurrent?.rating ?? currentPub.rating ?? null,
      ratingCount: hoursForCurrent?.ratingCount ?? currentPub.ratingCount ?? null,
      ratingLabel: hoursForCurrent?.ratingLabel ?? currentPub.ratingLabel ?? null,
      hasGarden: hoursForCurrent?.hasGarden ?? currentPub.hasGarden ?? null,
      venueKind: hoursForCurrent?.venueKind ?? currentPub.venueKind,
    };
  }, [currentPub, hoursForCurrent, overrideForCurrent]);

  // — Auto-skip known-closed pubs (NON-BLOCKING) —
  // When hideClosedPubs is on and a NOT-YET-REVEALED pub's hours have RESOLVED
  // to a definite isOpenNow === false, add its id to autoClosedIds and bump
  // excludeRevision; the selection effect then reselects the next nearest pub,
  // excluding it. Once the user has revealed a pub, keep that detail stable and
  // show the closed status instead of switching out from under them.
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

  // — Loading fallback —
  // Keep the spinner brief. If the initial cache-only lookup has not produced
  // usable data within 5 seconds, show the normal unknown-hours state while the
  // background pending poll continues. This avoids an indefinite spinner when
  // refresh_hours will not fill the row until a later worker pass.
  useEffect(() => {
    if (!currentPubId) return;
    if (hoursStatusForCurrent !== 'loading' && hoursStatusForCurrent !== 'pending') return;
    const hasVisibleDetails =
      Boolean(hoursForCurrent?.openingHours) ||
      typeof hoursForCurrent?.isOpenNow === 'boolean' ||
      typeof hoursForCurrent?.rating === 'number' ||
      (hoursForCurrent?.beers?.length ?? 0) > 0;
    if (hasVisibleDetails) {
      return;
    }

    const fallbackId = currentPubId;
    const timer = setTimeout(() => {
      setHoursById((prev) => {
        const row = prev.get(fallbackId);
        if (!row || (row.status !== 'loading' && row.status !== 'pending')) return prev;
        const next = new Map(prev);
        next.set(fallbackId, { ...row, status: 'unknown' });
        return next;
      });
    }, HOURS_LOADING_FALLBACK_MS);

    return () => clearTimeout(timer);
  }, [currentPubId, hoursStatusForCurrent, hoursForCurrent]);

  // — Retry pending enrichment (cache-only) —
  // A pending result means the backend queued refresh_hours instead of blocking
  // this request on Firmy.cz. Poll the backend gently while the same pub remains
  // selected; the client still sends sync_budget=0, so these retries do not
  // spend residential proxy traffic themselves.
  // Reading this ref during render is intentional and safe: every mutation of
  // pendingHoursRetryCountsRef is paired with a setPendingHoursRetryNonce bump
  // (or a setHoursById update), so this derived flag is recomputed on the same
  // render that changes the ref. (Same hook-lint friction the effect below opts
  // out of for exhaustive-deps.)
  // eslint-disable-next-line react-hooks/refs
  const shouldRetryPendingHours = currentPubId ? pendingHoursRetryCountsRef.current.has(currentPubId) : false;
  useEffect(() => {
    if (!currentPubId || !currentPub || !shouldRetryPendingHours) return;

    const retryId = currentPubId;
    const pubForLookup = currentPub;
    const attempt = pendingHoursRetryCountsRef.current.get(retryId) ?? 0;
    if (attempt >= PENDING_HOURS_RETRY_DELAYS_MS.length) {
      pendingHoursRetryCountsRef.current.delete(retryId);
      return;
    }

    const delay = PENDING_HOURS_RETRY_DELAYS_MS[attempt];
    pendingHoursRetryCountsRef.current.set(retryId, attempt + 1);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchPubHours([pubForLookup], controller.signal)
        .then((resultMap) => {
          if (controller.signal.aborted) return;

          const result = resultMap.get(retryId);
          if (result?.status === 'pending') {
            setPendingHoursRetryNonce((nonce) => nonce + 1);
            return;
          }

          pendingHoursRetryCountsRef.current.delete(retryId);
          if (!result || result.status === 'error') return;

          setHoursById((prev) => {
            const next = new Map(prev);
            next.set(retryId, hoursStateFromResult(result, result.status));
            return next;
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setPendingHoursRetryNonce((nonce) => nonce + 1);
          }
        });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPubId, shouldRetryPendingHours, pendingHoursRetryNonce]);

  useEffect(() => {
    if (!hideClosedPubs || !currentPubId) return;
    if (revealed) return;
    if (hoursStatusForCurrent !== 'ok') return;
    if (isOpenNowForCurrent !== false) return;

    addExcluded(autoClosedIdsRef, currentPubId);
  }, [currentPubId, hideClosedPubs, revealed, hoursStatusForCurrent, isOpenNowForCurrent, addExcluded]);

  // — Auto-hide non-pubs (venueKind === 'not_pub') (NON-BLOCKING) —
  // The backend classifies each place from Firmy.cz categories. A definite
  // 'not_pub' verdict means this is not a drinking spot at all (a sushi place, a
  // shop, ...), so before reveal the compass walks past it regardless of the
  // "hide closed" preference. If the user has already revealed the detail, keep
  // it stable instead of switching to a different pub after the async verdict
  // arrives. 'pub' / 'maybe' / 'unknown' (incl. older backends and a dormant
  // backend) change nothing.
  //
  // Loop safety mirrors the auto-closed effect: act only once per id (guarded by
  // `.has`), the set only grows (until a context change clears it), and the effect
  // is keyed on currentPubId + the resolved verdict, not on render churn.
  const venueKindForCurrent = hoursForCurrent?.venueKind;
  useEffect(() => {
    if (!currentPubId) return;
    if (revealed) return;
    if (venueKindForCurrent !== 'not_pub') return;

    addExcluded(notPubIdsRef, currentPubId);
  }, [currentPubId, revealed, venueKindForCurrent, addExcluded]);

  // — Lightweight discovery preferences (NON-BLOCKING) —
  // Skip only definite misses. Unknown rating/garden metadata remains eligible,
  // so old backends, pending enrichment and offline use do not empty the compass.
  const ratingForCurrent = hoursForCurrent?.rating;
  useEffect(() => {
    if (!preferRatedPubs || !currentPubId) return;
    if (revealed) return;
    if (typeof ratingForCurrent !== 'number' || !Number.isFinite(ratingForCurrent)) return;
    if (ratingForCurrent >= 4) return;

    addExcluded(lowRatedIdsRef, currentPubId);
  }, [currentPubId, preferRatedPubs, revealed, ratingForCurrent, addExcluded]);

  const hasGardenForCurrent = hoursForCurrent?.hasGarden;
  useEffect(() => {
    if (!preferGardenPubs || !currentPubId) return;
    if (revealed) return;
    if (hasGardenForCurrent !== false) return;

    addExcluded(noGardenIdsRef, currentPubId);
  }, [currentPubId, preferGardenPubs, revealed, hasGardenForCurrent, addExcluded]);

  // — Expire resolved hours at their nextChange boundary (NON-BLOCKING) —
  // isOpenNow / openUntil are a snapshot from when the lookup resolved. A user
  // lingering on the same pub across its open/close time (e.g. it opens at 11:00)
  // would otherwise keep seeing the stale boolean, because the fetch effect is
  // keyed on the pub id and never re-runs while standing still. When the current
  // pub has a RESOLVED 'ok' result with a FUTURE nextChange, schedule a one-shot
  // timer that drops the cached entry and bumps the refetch nonce, so the fetch
  // effect re-runs and pulls a freshly-computed isOpenNow.
  //
  // Only future transitions are scheduled: a fresh result from a correct backend
  // always has nextChange in the future, so an already-past value is treated as a
  // no-op (this also keeps fixed-date test fixtures from triggering a refetch).
  const nextChangeForCurrent = hoursForCurrent?.nextChange;
  useEffect(() => {
    if (hoursStatusForCurrent !== 'ok' || !currentPubId || !nextChangeForCurrent) return;
    // The boundary must be an absolute instant. The backend emits an explicit
    // Europe/Prague offset (or Z); require one, because a bare local time would
    // be parsed in the device's zone and fire at the wrong moment (the chip's
    // literal HH:MM slice is offset-agnostic, but this scheduling is not).
    if (!/([+-]\d{2}:?\d{2}|Z)$/.test(nextChangeForCurrent)) return;
    const at = Date.parse(nextChangeForCurrent);
    if (Number.isNaN(at)) return;
    if (at - Date.now() <= 0) return; // already past — refresh on next reselection

    const expireId = currentPubId;
    // setTimeout clamps any delay above 2^31-1 ms (~24.85 days) and fires almost
    // immediately. A far-future nextChange (e.g. a seasonal "Mar-Oct" closure)
    // would then tight-loop: fire → delete → refetch → same far-future value →
    // reschedule → overflow again. So re-arm in bounded chunks and only actually
    // expire+refetch once the REAL boundary is reached.
    const MAX_DELAY = 2_147_483_647;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const remaining = at - Date.now();
      if (remaining <= 0) {
        setHoursById((prev) => {
          if (!prev.has(expireId)) return prev;
          const next = new Map(prev);
          next.delete(expireId);
          return next;
        });
        setHoursRefetchNonce((nonce) => nonce + 1);
        return;
      }
      timer = setTimeout(tick, Math.min(remaining, MAX_DELAY));
    };
    tick();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [currentPubId, hoursStatusForCurrent, nextChangeForCurrent]);

  // — Friend "Ukaž na kompasu" focus (§F2) —
  // When a friend hands off their coarse pub, the needle points THERE instead of
  // the nearest/surprise selection. The normal selection keeps running
  // underneath, so clearing the focus snaps straight back to it.
  const focusedPub = useFocusedPubStore((s) => s.pub);
  const clearFocusedPub = useFocusedPubStore((s) => s.clear);

  // — Bearing / distance —
  const { bearing, distanceMeters } = useTargetBearing(
    position ? { lat: position.lat, lng: position.lng } : null,
    focusedPub
      ? { lat: focusedPub.lat, lng: focusedPub.lng }
      : filterLookupPending
        ? null
        : currentPub,
  );
  const bearingValue = useSharedValue<number | null>(null);

  useEffect(() => {
    bearingValue.value = bearing;
  }, [bearing, bearingValue]);

  // — Arrival detection —
  const { arrived, dismiss: dismissArrival } = useArrivalDetector({
    distanceMeters,
    gpsAccuracyMeters: position?.accuracyMeters ?? null,
    // Suppress arrival while pointing at a friend's coarse pub: a geohash cell is
    // not a real catalogue target, so it must never fire the arrival celebration.
    targetPubId: focusedPub || filterLookupPending ? null : currentPub?.id ?? null,
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
  // While focused on a friend's pub we only need a position fix to point the
  // needle — the local nearest/surprise selection may still be warming up.
  const isLoading = focusedPub
    ? position === null
    : filterLookupPending || !pubsLoaded || position === null || !hasSelectedTarget;

  // — Actions —
  const reveal = useCallback(() => {
    if (!currentPub || filterLookupPending) return;

    setRevealed(true);
    setRevealedPub(currentPub);
  }, [currentPub, filterLookupPending, setRevealedPub]);

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
    addExcluded(skippedIdsRef, id);
  }, [addExcluded, currentPub]);

  const reportCurrentPub = useCallback(async (reason: PubReportReason): Promise<boolean> => {
    const pub = currentPub;
    if (!pub) return false;

    // Hide locally by both signals: the Mapy.cz id (exact match) and the
    // geohash-8 cell (still matches when a later fetch re-ids the place).
    addReportedPub(pub.id, geohash8(pub.lat, pub.lng));
    setRevealed(false);
    setRevealedPub(null);
    setExcludeRevision((revision) => revision + 1);

    // Persisted queue with retry — a failed send is re-attempted on the next
    // launch/foreground instead of being dropped silently.
    return enqueuePubReport(pub, reason);
  }, [addReportedPub, currentPub, setRevealedPub]);

  const renameCurrentPub = useCallback(async (suggestedName: string): Promise<boolean> => {
    const pub = currentPub;
    const trimmedName = suggestedName.trim().slice(0, 200);
    if (!pub || !trimmedName || trimmedName === pub.name) return false;

    const renamedPub = { ...pub, name: trimmedName };
    setCurrentPub(renamedPub);
    setRevealedPub(renamedPub);
    renameLocalPub(pub.id, trimmedName);
    bumpCatalogRevision();
    void clearPubsSnapshot();

    const entry = buildPubNameCorrectionEntry(pub, trimmedName);
    return enqueuePubNameCorrection(entry);
  }, [bumpCatalogRevision, currentPub, setRevealedPub]);

  const retrySearch = useCallback(() => {
    forceNextSearchRef.current = true;
    lastTargetPosRef.current = null;
    setHasSelectedTarget(false);
    lastModeRef.current = null;
    lastMaxKmRef.current = undefined;
    lastSeedRef.current = null;
    lastCatalogRevisionRef.current = catalogRevision;
    lastBeerBrandKeyRef.current = activeBeerBrandKey;
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
  }, [activeBeerBrandKey, catalogRevision, excludeRevision, resetExclusions]);

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
    pub: filterLookupPending ? null : enrichedPub,
    revealed,
    reveal,
    mode,
    setMode,
    reroll,
    skip,
    reportCurrentPub,
    renameCurrentPub,
    retrySearch,
    arrived,
    dismissArrival,
    headingAccuracy: accuracyDeg,
    hasMagnetometer,
    permissionState,
    requestPermission,
    isLoading,
    searchFailed,
    currentPosition: position,
    focusedPub,
    clearFocusedPub,
  };
}
