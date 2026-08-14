/**
 * Lean nearby-pub detector for the beer counter tab.
 *
 * Deliberately NOT built on useCompass — the counter only needs "which pub am I
 * sitting in?", not bearing / heading / arrival / reroll. It:
 *   • gates location permission (mirrors the compass permission flow),
 *   • watches GPS only while the tab is focused (useFocusEffect → enabled flag),
 *   • fetches nearby pubs and exposes the nearest ~10 as picker candidates,
 *   • auto-picks the nearest pub when it is within AUTO_PICK_METERS,
 *   • PINS the chosen pub once a session is under way, so GPS jitter never makes
 *     the active pub flap; the user can still switch via selectPub().
 *
 * Provider-facing pub ids can change across fetches, so the durable key is the
 * geohash-8 cell (`pubKey`) — the same key the tally store and backend use.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';

import { useDevicePosition } from '@/compass/useDevicePosition';
import { checkLocationPermission, ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import type { PermissionState } from '@/compass/permissions';
import { fetchPubsNear, findNearbyPubs, type Pub } from '@/data/pubs';
import { decodeGeohash8, geohash8 } from '@/data/geohash';
import { useTallyStore } from '@/stores/tallyStore';
import { isContextPubKey } from '@/drinks/drinkTypes';

/** Auto-detect the pub when the nearest is within this many metres. GPS indoors
 *  is often coarse, so the threshold is generous (a small pub block). */
const AUTO_PICK_METERS = 120;
/** How many candidates to surface in the manual picker. */
const CANDIDATE_LIMIT = 10;
/** Search radius for the counter — local; a couple of km is plenty. */
const SEARCH_RADIUS_KM = 3;

export interface NearbyCandidate {
  pubKey: string;
  pub: Pub;
  distanceMeters: number;
}

/**
 * Build a lightweight stand-in Pub for an active session whose real pub is NOT
 * among the current nearby candidates (GPS drifted, or the tab was opened away
 * from the pub). The geohash-8 cell centre re-encodes to the same `pubKey`
 * (round-trip identity of geohash8/decodeGeohash8), so anything that re-derives
 * the cell from lat/lng downstream — including the tally counter — keeps
 * counting at the right physical place. We only have the session's key + name,
 * so the stand-in is intentionally sparse (no address / hours / rating).
 */
function sessionStandInPub(pubKey: string, name: string): Pub {
  const { lat, lng } = decodeGeohash8(pubKey);
  return { id: `tally:${pubKey}`, name, lat, lng };
}

export interface UseNearbyPubResult {
  candidates: NearbyCandidate[];
  selected: Pub | null;
  /** Pin a specific candidate as the active pub (manual override). */
  selectPub: (pub: Pub) => void;
  permissionState: PermissionState;
  requestPermission: () => Promise<void>;
  /** True during the initial detect (have permission, no fix/candidates yet). */
  loading: boolean;
  /** Force a fresh search (used by the "no pub nearby" retry). */
  retry: () => void;
}

export function useNearbyPub(): UseNearbyPubResult {
  const [permissionState, setPermissionState] = useState<PermissionState>('undetermined');
  const [focused, setFocused] = useState(false);
  const [candidates, setCandidates] = useState<NearbyCandidate[]>([]);
  const [selected, setSelected] = useState<Pub | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  // Outside ("ctx:*") sessions are not pubs: their key is no geohash, so the
  // stand-in/pinning logic below must never see them — CounterScreen owns the
  // outside mode entirely.
  const activeSessionPubKey = useTallyStore((state) =>
    state.current && state.current.drinks.length > 0 && !isContextPubKey(state.current.pubKey)
      ? state.current.pubKey
      : null,
  );
  const forceNextFetchRef = useRef(false);

  // Once the user has a pinned pub (auto or manual) we stop letting GPS reselect
  // it — the active pub is sticky for the whole sitting.
  const pinnedRef = useRef(false);

  // — Permission on mount / return from system settings —
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
      if (state === 'active') refreshPermission();
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // — Focus gate: only watch GPS while this tab is on screen —
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const { position } = useDevicePosition(focused && permissionState === 'granted');

  // Walking telemetry is fed from the raw watcher stream inside
  // useDevicePosition; published positions are deduped and would under-sample.

  const positionLat = position?.lat;
  const positionLng = position?.lng;

  // — Fetch + rank nearby pubs on each position update —
  // All state writes happen inside the async callback (not synchronously in the
  // effect body), including the one-shot auto-pick: when the nearest pub is close
  // enough and nothing is pinned yet, select it here. This keeps the "sticky pub"
  // behaviour without a second setState-in-effect.
  useEffect(() => {
    if (positionLat == null || positionLng == null) return;
    let cancelled = false;
    const forceFetch = forceNextFetchRef.current;
    forceNextFetchRef.current = false;

    fetchPubsNear(positionLat, positionLng, undefined, { force: forceFetch, radiusKm: SEARCH_RADIUS_KM })
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        const found = findNearbyPubs({
          lat: positionLat,
          lng: positionLng,
          limit: CANDIDATE_LIMIT,
          maxKm: SEARCH_RADIUS_KM,
        });
        // Two venues can share a geohash-8 cell; the cell is the durable pub
        // identity (tally + backend + React keys), so keep only the nearest.
        const seenCells = new Set<string>();
        const ranked: NearbyCandidate[] = [];
        for (const f of found) {
          const pubKey = geohash8(f.pub.lat, f.pub.lng);
          if (seenCells.has(pubKey)) continue;
          seenCells.add(pubKey);
          ranked.push({ pubKey, pub: f.pub, distanceMeters: f.distanceMeters });
        }
        setHasFix(true);
        setCandidates(ranked);

        // Auto-detect before the first beer, but only pin once an active evening
        // exists. Otherwise walking from pub A to pub B before counting would
        // keep the stale first pick.
        const nearest = ranked[0];
        if (!pinnedRef.current) {
          if (activeSessionPubKey) {
            const sessionCandidate = ranked.find((candidate) => candidate.pubKey === activeSessionPubKey);
            if (sessionCandidate) {
              // Session pub is nearby — pin the real, fully-detailed Pub.
              pinnedRef.current = true;
              setSelected(sessionCandidate.pub);
            } else {
              // The evening is under way but its pub isn't among the current
              // candidates. Reflect the session anyway instead of leaving a
              // stale neighbour selected: keep the selection when it already IS
              // the session pub, otherwise surface a stand-in derived from the
              // session key + name. Left unpinned so we upgrade to the real Pub
              // the moment it reappears in candidates.
              const sessionName = useTallyStore.getState().current?.pubName ?? '';
              setSelected((prev) =>
                prev && geohash8(prev.lat, prev.lng) === activeSessionPubKey
                  ? prev
                  : sessionStandInPub(activeSessionPubKey, sessionName),
              );
            }
          } else if (nearest && nearest.distanceMeters <= AUTO_PICK_METERS) {
            setSelected(nearest.pub);
          } else {
            setSelected(null);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionPubKey, positionLat, positionLng, retryNonce]);

  const selectPub = useCallback((pub: Pub) => {
    pinnedRef.current = true;
    setSelected(pub);
  }, []);

  const requestPermission = useCallback(async () => {
    const state = await ensureLocationPermission();
    setPermissionState(state);
    if (state === 'denied') {
      await openSystemSettings();
    }
  }, []);

  const retry = useCallback(() => {
    // Un-pin and re-run the search; lets the user re-detect after moving pubs.
    pinnedRef.current = false;
    forceNextFetchRef.current = true;
    setSelected(null);
    setHasFix(false);
    setCandidates([]);
    setRetryNonce((n) => n + 1);
  }, []);

  // Loading: we have permission but no GPS fix / candidate list yet.
  const loading = permissionState === 'granted' && !hasFix;

  return useMemo(
    () => ({
      candidates,
      selected,
      selectPub,
      permissionState,
      requestPermission,
      loading,
      retry,
    }),
    [candidates, selected, selectPub, permissionState, requestPermission, loading, retry],
  );
}
