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
 * The pub id from Mapy is unstable across fetches, so the durable key is the
 * geohash-8 cell (`pubKey`) — the same key the tally store and backend use.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useDevicePosition } from '@/compass/useDevicePosition';
import { ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import type { PermissionState } from '@/compass/permissions';
import { fetchPubsNear, findNearbyPubs, type Pub } from '@/data/pubs';
import { geohash8 } from '@/data/geohash';

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

  // Once the user has a pinned pub (auto or manual) we stop letting GPS reselect
  // it — the active pub is sticky for the whole sitting.
  const pinnedRef = useRef(false);

  // — Permission on mount —
  useEffect(() => {
    ensureLocationPermission()
      .then(setPermissionState)
      .catch(() => setPermissionState('denied'));
  }, []);

  // — Focus gate: only watch GPS while this tab is on screen —
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const { position } = useDevicePosition(focused && permissionState === 'granted');

  // — Fetch + rank nearby pubs on each position update —
  // All state writes happen inside the async callback (not synchronously in the
  // effect body), including the one-shot auto-pick: when the nearest pub is close
  // enough and nothing is pinned yet, select it here. This keeps the "sticky pub"
  // behaviour without a second setState-in-effect.
  useEffect(() => {
    if (!position) return;
    let cancelled = false;

    fetchPubsNear(position.lat, position.lng, undefined, { radiusKm: SEARCH_RADIUS_KM })
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        const found = findNearbyPubs({
          lat: position.lat,
          lng: position.lng,
          limit: CANDIDATE_LIMIT,
          maxKm: SEARCH_RADIUS_KM,
        });
        const ranked: NearbyCandidate[] = found.map((f) => ({
          pubKey: geohash8(f.pub.lat, f.pub.lng),
          pub: f.pub,
          distanceMeters: f.distanceMeters,
        }));
        setHasFix(true);
        setCandidates(ranked);

        // One-shot auto-detect: pin the nearest pub if within range and the user
        // hasn't already pinned/picked one this sitting.
        const nearest = ranked[0];
        if (!pinnedRef.current && nearest && nearest.distanceMeters <= AUTO_PICK_METERS) {
          pinnedRef.current = true;
          setSelected(nearest.pub);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng, retryNonce]);

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
