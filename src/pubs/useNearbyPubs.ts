import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { useDevicePosition, type DevicePosition } from '@/compass/useDevicePosition';
import {
  checkLocationPermission,
  ensureLocationPermission,
  openSystemSettings,
  type PermissionState,
} from '@/compass/permissions';
import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import { geohash8 } from '@/data/geohash';
import { computeOpenState } from '@/data/communityHours';
import {
  fetchPubsNear,
  findNearbyPubs,
  getAllLoadedPubs,
  hydratePubsSnapshot,
  type Pub,
} from '@/data/pubs';
import type { BeerBrandFilterValue } from '@/data/pubSearchFilters';
import { fetchVisits } from '@/data/visitsClient';
import {
  loadVisitsSnapshot,
  saveVisitsSnapshot,
  visitsSnapshotGeneration,
} from '@/data/visitsSnapshot';
import { buildVisitedPubs } from '@/map/mapModel';
import { allSessionsNewestFirst, useTallyStore } from '@/stores/tallyStore';
import {
  isBeerListOverrideCurrent,
  isBeerMenuTypeOverrideCurrent,
  useCommunityStore,
  type CommunityOverride,
} from '@/stores/communityStore';
import { toPubListItem, type PubListItem } from './pubPresentation';

const PUB_LIMIT = 30;
const SEARCH_RADIUS_KM = 10;

export interface NearbyPubFilters {
  beerBrand: BeerBrandFilterValue | null;
  amenityKeys: string[];
  openNow: boolean;
}

export const EMPTY_NEARBY_PUB_FILTERS: NearbyPubFilters = {
  beerBrand: null,
  amenityKeys: [],
  openNow: false,
};

function mergeHours(pub: Pub, result: PubHoursResult | undefined): Pub {
  if (!result) return pub;
  return {
    ...pub,
    openingHours: result.openingHours,
    isOpenNow: result.isOpenNow,
    nextChange: result.nextChange,
    hoursStatus: result.status,
    hoursSource: result.source ?? undefined,
    communityHours: result.communityHours ?? undefined,
    beers: result.beers.length > 0 ? result.beers : pub.beers,
    historicalBeers:
      result.historicalBeers.length > 0 ? result.historicalBeers : pub.historicalBeers,
    beersUpdatedAt: result.beersUpdatedAt,
    beerMenuRotates: result.beerMenuRotates,
    hoursUpdatedAt: result.hoursUpdatedAt,
    rating: result.rating ?? pub.rating,
    ratingCount: result.ratingCount ?? pub.ratingCount,
    ratingLabel: result.ratingLabel ?? pub.ratingLabel,
    hasGarden: result.hasGarden ?? pub.hasGarden,
    venueKind: result.venueKind,
  };
}

function mergeCommunity(pub: Pub, override: CommunityOverride | undefined): Pub {
  if (!override) return pub;
  let merged = pub;
  if (override.hours && pub.hoursSource !== 'community') {
    const state = computeOpenState(override.hours);
    merged = {
      ...merged,
      communityHours: override.hours,
      openingHours: null,
      isOpenNow: state.isOpenNow,
      nextChange: state.nextChange,
      hoursStatus: 'ok',
      hoursSource: 'community',
    };
  }
  const beerOverride = isBeerListOverrideCurrent(override, pub.beersUpdatedAt);
  const menuTypeOverride = isBeerMenuTypeOverrideCurrent(override, pub.beersUpdatedAt);
  if (beerOverride || menuTypeOverride) {
    merged = {
      ...merged,
      beers: beerOverride ? override.beers : merged.beers,
      historicalBeers: beerOverride ? override.historicalBeers : merged.historicalBeers,
      beerMenuRotates: menuTypeOverride
        ? override.beerMenuRotates
        : merged.beerMenuRotates,
    };
  }
  return merged;
}

export interface NearbyPubsState {
  pubs: PubListItem[];
  loadedPubs: Pub[];
  position: DevicePosition | null;
  permissionState: PermissionState;
  loading: boolean;
  failed: boolean;
  requestPermission: () => Promise<void>;
  retry: () => void;
}

export function useNearbyPubs(filters: NearbyPubFilters): NearbyPubsState {
  const [focused, setFocused] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState>('undetermined');
  const [ranked, setRanked] = useState<{ pub: Pub; distanceMeters: number }[]>([]);
  const [hours, setHours] = useState<Map<string, PubHoursResult>>(() => new Map());
  const [visits, setVisits] = useState<Awaited<ReturnType<typeof loadVisitsSnapshot>>>([]);
  const [hydrated, setHydrated] = useState(false);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const requestRef = useRef(0);
  const filterKeyRef = useRef('');
  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const communityOverrides = useCommunityStore((state) => state.overrides);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void checkLocationPermission()
        .then((state) => {
          if (mounted) setPermissionState(state);
        })
        .catch(() => {
          if (mounted) setPermissionState('denied');
        });
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const { position } = useDevicePosition(focused && permissionState === 'granted');

  useEffect(() => {
    let cancelled = false;
    void hydratePubsSnapshot().finally(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    const generation = visitsSnapshotGeneration();
    void (async () => {
      const cached = await loadVisitsSnapshot();
      if (!cancelled && generation === visitsSnapshotGeneration()) setVisits(cached);
      const fresh = await fetchVisits();
      if (cancelled || !fresh || generation !== visitsSnapshotGeneration()) return;
      setVisits(fresh);
      void saveVisitsSnapshot(fresh, generation);
    })();
    return () => {
      cancelled = true;
    };
  }, [focused, retryNonce]);

  const positionLat = position?.lat;
  const positionLng = position?.lng;
  const beerBrandKey = filters.beerBrand?.key ?? '';
  const amenityKey = [...filters.amenityKeys].sort().join(',');

  useEffect(() => {
    if (!focused || positionLat == null || positionLng == null) {
      return;
    }
    const request = ++requestRef.current;
    const controller = new AbortController();
    const filterKey = `${beerBrandKey}|${amenityKey}`;
    const filterChanged = filterKeyRef.current !== filterKey;
    filterKeyRef.current = filterKey;
    void Promise.resolve().then(() => {
      if (request === requestRef.current) {
        setNetworkLoading(true);
        setFailed(false);
        if (filterChanged) setRanked([]);
      }
    });

    const publish = () => {
      if (request !== requestRef.current) return;
      setRanked(
        findNearbyPubs({
          lat: positionLat,
          lng: positionLng,
          limit: PUB_LIMIT,
          maxKm: SEARCH_RADIUS_KM,
        }),
      );
    };

    if (!filterChanged) publish();
    void fetchPubsNear(positionLat, positionLng, controller.signal, {
      radiusKm: SEARCH_RADIUS_KM,
      beerBrandKey: beerBrandKey || null,
      amenityKeys: amenityKey ? amenityKey.split(',') : [],
    })
      .then(publish)
      .catch(() => {
        if (request === requestRef.current) setFailed(true);
      })
      .finally(() => {
        if (request === requestRef.current) setNetworkLoading(false);
      });
    return () => {
      controller.abort();
      if (request === requestRef.current) {
        requestRef.current += 1;
        setNetworkLoading(false);
      }
    };
  }, [amenityKey, beerBrandKey, focused, hydrated, positionLat, positionLng, retryNonce]);

  const rankedIds = ranked.map(({ pub }) => pub.id).join('|');
  useEffect(() => {
    if (!focused) return;
    if (ranked.length === 0) {
      void Promise.resolve().then(() => setHours(new Map()));
      return;
    }
    const controller = new AbortController();
    void fetchPubHours(
      ranked.map(({ pub }) => pub),
      controller.signal,
    ).then((result) => {
      if (!controller.signal.aborted) setHours(result);
    });
    return () => controller.abort();
    // Pub ids are the stable identity for this enrichment batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, rankedIds]);

  const sessions = useMemo(() => allSessionsNewestFirst(current, history), [current, history]);
  const enrichedRanked = useMemo(
    () => ranked.map(({ pub, distanceMeters }) => {
      const enriched = mergeHours(pub, hours.get(pub.id));
      return {
        pub: mergeCommunity(enriched, communityOverrides[geohash8(pub.lat, pub.lng)]),
        distanceMeters,
      };
    }),
    [communityOverrides, hours, ranked],
  );
  const loadedPubs = getAllLoadedPubs().map((pub) => {
    const enriched = mergeHours(pub, hours.get(pub.id));
    return mergeCommunity(enriched, communityOverrides[geohash8(pub.lat, pub.lng)]);
  });
  const visited = useMemo(
    () => buildVisitedPubs(visits, sessions, loadedPubs),
    [loadedPubs, sessions, visits],
  );
  const visitedByKey = useMemo(() => new Map(visited.map((item) => [item.cacheKey, item])), [visited]);

  const pubs = useMemo(
    () =>
      enrichedRanked
        .filter(({ pub }) => !filters.openNow || pub.isOpenNow === true)
        .map(({ pub, distanceMeters }) => {
          const visit = visitedByKey.get(geohash8(pub.lat, pub.lng)) ?? null;
          return toPubListItem(pub, distanceMeters, visit);
        }),
    [enrichedRanked, filters.openNow, visitedByKey],
  );

  const requestPermission = useCallback(async () => {
    const state = await ensureLocationPermission();
    setPermissionState(state);
    if (state === 'denied') await openSystemSettings();
  }, []);
  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);

  return {
    pubs,
    loadedPubs,
    position,
    permissionState,
    loading:
      permissionState === 'undetermined' ||
      (permissionState === 'granted' && position === null) ||
      networkLoading,
    failed,
    requestPermission,
    retry,
  };
}
