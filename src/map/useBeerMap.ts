import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Region } from 'react-native-maps';

import { useDevicePosition } from '@/compass/useDevicePosition';
import {
  checkLocationPermission,
  ensureLocationPermission,
  openSystemSettings,
  type PermissionState,
} from '@/compass/permissions';
import { fetchFriendsLive, type FriendPubActivity } from '@/data/friendsClient';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import {
  fetchPubsNear,
  getAllLoadedPubs,
  hydratePubsSnapshot,
  type Pub,
} from '@/data/pubs';
import { fetchVisits, type WireVisit } from '@/data/visitsClient';
import {
  loadVisitsSnapshot,
  saveVisitsSnapshot,
  subscribeVisitsBoundary,
  visitsSnapshotGeneration,
} from '@/data/visitsSnapshot';
import { usePubStore } from '@/stores/pubStore';
import { useAccountStore } from '@/stores/accountStore';
import { allSessionsNewestFirst, useTallyStore } from '@/stores/tallyStore';
import {
  buildLivePubs,
  buildVisitedCities,
  buildVisitedPubs,
  type LivePubSummary,
  type VisitedCitySummary,
  type VisitedPubSummary,
} from './mapModel';

const VIEWPORT_DEBOUNCE_MS = 650;
const LIVE_REFRESH_MS = 35_000;

function viewportRadiusKm(region: Region): number {
  const latKm = region.latitudeDelta * 111;
  const lngKm = region.longitudeDelta * 111 * Math.cos((region.latitude * Math.PI) / 180);
  return Math.min(100, Math.max(1, Math.hypot(latKm / 2, lngKm / 2) * 1.25));
}

function mergePubs(previous: Pub[], incoming: Pub[]): Pub[] {
  const map = new Map(previous.map((pub) => [pub.id, pub]));
  for (const pub of incoming) {
    map.delete(pub.id);
    map.set(pub.id, pub);
  }
  return [...map.values()]
    .filter((pub) => pub.venueKind !== 'not_pub')
    .slice(-600);
}

export interface BeerMapData {
  pubs: Pub[];
  visitedPubs: VisitedPubSummary[];
  visitedCities: VisitedCitySummary[];
  livePubs: LivePubSummary[];
  position: { lat: number; lng: number; accuracyMeters: number } | null;
  permissionState: PermissionState;
  loadingPubs: boolean;
  stale: boolean;
  requestPermission: () => Promise<void>;
  loadRegion: (region: Region) => void;
  refresh: () => void;
}

export function useBeerMap(): BeerMapData {
  const [focused, setFocused] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState>('undetermined');
  const [pubs, setPubs] = useState<Pub[]>(() => getAllLoadedPubs());
  const [serverVisits, setServerVisits] = useState<WireVisit[]>([]);
  const [friendActivities, setFriendActivities] = useState<FriendPubActivity[]>([]);
  const [loadingPubs, setLoadingPubs] = useState(false);
  const [stale, setStale] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [requestedRegion, setRequestedRegion] = useState<Region | null>(null);
  const requestSerial = useRef(0);
  const privateReadsSuspended = useRef(false);
  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const catalogRevision = usePubStore((state) => state.catalogRevision);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const { position } = useDevicePosition(focused && permissionState === 'granted');

  useEffect(() => {
    let mounted = true;
    const refreshPermission = () => {
      void checkLocationPermission().then((state) => {
        if (mounted) setPermissionState(state);
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

  useEffect(() => {
    let cancelled = false;
    void hydratePubsSnapshot().then(() => {
      if (!cancelled) setPubs((previous) => mergePubs(previous, getAllLoadedPubs()));
    });
    return () => {
      cancelled = true;
    };
  }, [catalogRevision]);

  useEffect(
    () =>
      subscribeVisitsBoundary(() => {
        privateReadsSuspended.current = true;
        setServerVisits([]);
        setFriendActivities([]);
      }),
    [],
  );

  useEffect(() => {
    if (!focused) return;
    privateReadsSuspended.current = false;
    let cancelled = false;
    const generation = visitsSnapshotGeneration();
    void (async () => {
      const [visitSnapshot, friendSnapshot] = await Promise.all([
        loadVisitsSnapshot(),
        loadFriendsDashboardSnapshot(),
      ]);
      if (
        cancelled ||
        privateReadsSuspended.current ||
        generation !== visitsSnapshotGeneration()
      ) return;
      setServerVisits(visitSnapshot);
      if (friendSnapshot) setFriendActivities(friendSnapshot.dashboard.activeFriends);

      const [visits, live] = await Promise.all([fetchVisits(), fetchFriendsLive()]);
      if (
        cancelled ||
        privateReadsSuspended.current ||
        generation !== visitsSnapshotGeneration()
      ) return;
      setStale(visits === null || live === null);
      if (visits) {
        setServerVisits(visits);
        void saveVisitsSnapshot(visits, generation);
      }
      if (live) setFriendActivities(live.activeFriends);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, focused, refreshNonce]);

  const hasLive = useMemo(
    () => buildLivePubs(friendActivities, nowMs).length > 0,
    [friendActivities, nowMs],
  );

  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
      if (privateReadsSuspended.current) return;
      const generation = visitsSnapshotGeneration();
      void fetchFriendsLive().then((live) => {
        if (
          live &&
          !privateReadsSuspended.current &&
          generation === visitsSnapshotGeneration()
        ) {
          setFriendActivities(live.activeFriends);
        }
      });
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [focused, hasLive]);

  useEffect(() => {
    if (!focused || !requestedRegion) return;
    const radiusKm = viewportRadiusKm(requestedRegion);
    // The current nearby endpoint is not a country-scale catalogue. Waiting for
    // a city/region zoom avoids a costly, misleading 100 km search on the Czech
    // overview while cached pubs and visited-city markers remain visible.
    if (radiusKm >= 80) return;
    const serial = ++requestSerial.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoadingPubs(true);
      void fetchPubsNear(requestedRegion.latitude, requestedRegion.longitude, controller.signal, {
        radiusKm,
      })
        .then(() => {
          if (serial !== requestSerial.current) return;
          setPubs((previous) => mergePubs(previous, getAllLoadedPubs()));
        })
        .catch(() => {
          if (serial === requestSerial.current) setStale(true);
        })
        .finally(() => {
          if (serial === requestSerial.current) setLoadingPubs(false);
        });
    }, VIEWPORT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      requestSerial.current += 1;
    };
  }, [focused, requestedRegion, refreshNonce]);

  const sessions = useMemo(
    () => allSessionsNewestFirst(current, history),
    [current, history],
  );
  const visitedPubs = useMemo(
    () => buildVisitedPubs(serverVisits, sessions, pubs),
    [serverVisits, sessions, pubs],
  );
  const visitedCities = useMemo(() => buildVisitedCities(visitedPubs), [visitedPubs]);
  const livePubs = useMemo(
    () => buildLivePubs(friendActivities, nowMs),
    [friendActivities, nowMs],
  );

  const requestPermission = useCallback(async () => {
    const next = await ensureLocationPermission();
    setPermissionState(next);
    if (next === 'denied') await openSystemSettings();
  }, []);

  const loadRegion = useCallback((region: Region) => setRequestedRegion(region), []);
  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  return {
    pubs,
    visitedPubs,
    visitedCities,
    livePubs,
    position,
    permissionState,
    loadingPubs,
    stale,
    requestPermission,
    loadRegion,
    refresh,
  };
}
