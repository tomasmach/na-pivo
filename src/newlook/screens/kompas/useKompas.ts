import { useCallback, useEffect, useMemo, useState } from 'react';

import { haversineMeters } from '@/compass/distance';
import { useArrivalDetector } from '@/compass/useArrivalDetector';
import { geohash8 } from '@/data/geohash';
import { fetchPubBeersLastWeek, type PubBeersByKey } from '@/data/pubBeersClient';
import { findNearbyPubs, findNearestPub, type Pub } from '@/data/pubs';
import { activePubSearchFilterCount, pubMatchesPriceFilter } from '@/data/pubSearchFilters';
import { UNLIMITED_SEARCH_RADIUS_KM, useCompass } from '@/hooks/useCompass';
import { pubOpeningVerdict } from '@/map/mapModel';
import { useBeerMap } from '@/map/useBeerMap';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToursStore } from '@/stores/toursStore';
import { runGlance } from '@/tours/glance';
import { formatPrice } from '@/utils/currency';
import { isPriceFresh } from '@/utils/priceAge';

import { useKompasState } from './state';

export type KompasTarget = {
  kind: 'pub' | 'friend' | 'tour';
  key: string;
  name: string;
  lat: number;
  lng: number;
  /** The catalogue pub behind the target, when there is one. */
  pub: Pub | null;
  distance: number | null;
  /** 1-based number of the next tour stop. */
  stopNumber?: number;
  stopId?: string;
};

export type CompassState = 'normal' | 'loading' | 'location' | 'error' | 'empty' | 'noresults';

const DIAL_RANGE_KM = 0.3;

/** Everything the Kompas tab shows, from the same hooks the old compass and map use. */
export function useKompas() {
  const filters = useKompasState((s) => s.filters);
  const mapView = useKompasState((s) => s.mapView);
  const onlyDrunk = useKompasState((s) => s.onlyDrunk);
  const pinMode = useKompasState((s) => s.pinMode);
  const picked = useKompasState((s) => s.picked);
  const hideClosed = useSettingsStore((s) => s.hideClosedPubs);
  const surprise = useSettingsStore((s) => s.mode === 'surprise');
  const maxDistanceKm = useSettingsStore((s) => s.maxDistanceKm);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const reportedPubIds = usePubStore((s) => s.reportedPubIds);
  const reportedCacheKeys = usePubStore((s) => s.reportedCacheKeys);

  const compass = useCompass(
    filters.beerBrand?.key ?? null,
    filters.amenityKeys,
    filters.priceMinCzk,
    filters.priceMaxCzk,
    true,
    filters.includeOtherPlaces === true,
  );
  const map = useBeerMap(filters, mapView === 'parta');
  const position = compass.currentPosition ?? map.position;

  const [beersLastWeek, setBeersLastWeek] = useState<PubBeersByKey | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPubBeersLastWeek(controller.signal).then((beers) => {
      if (!controller.signal.aborted) setBeersLastWeek(beers);
    });
    return () => controller.abort();
  }, []);

  const activeRun = useToursStore((s) => s.activeRun);
  useEffect(() => {
    void useToursStore.getState().hydrate();
  }, []);
  const tour = runGlance(activeRun);

  const focused = compass.focusedPub;
  const target = useMemo<KompasTarget | null>(() => {
    const at = (lat: number, lng: number) => (position ? haversineMeters(position, { lat, lng }) : null);
    const next = tour?.next;
    if (next && activeRun) {
      return {
        kind: 'tour',
        key: next.cacheKey || geohash8(next.lat, next.lon),
        name: next.name,
        lat: next.lat,
        lng: next.lon,
        pub: null,
        distance: at(next.lat, next.lon),
        stopNumber: activeRun.snapshot.stops.findIndex((stop) => stop.id === next.id) + 1,
        stopId: next.id,
      };
    }
    if (picked) {
      return { kind: 'pub', key: geohash8(picked.lat, picked.lng), name: picked.name, lat: picked.lat, lng: picked.lng, pub: picked, distance: at(picked.lat, picked.lng) };
    }
    if (focused) {
      return { kind: 'friend', key: focused.cacheKey, name: focused.name, lat: focused.lat, lng: focused.lng, pub: null, distance: at(focused.lat, focused.lng) };
    }
    const pub = compass.pub;
    if (!pub) return null;
    return { kind: 'pub', key: geohash8(pub.lat, pub.lng), name: pub.name, lat: pub.lat, lng: pub.lng, pub, distance: compass.distanceMeters ?? at(pub.lat, pub.lng) };
  }, [activeRun, compass.distanceMeters, compass.pub, focused, picked, position, tour?.next]);

  // The compass hook watches arrival only at its own pick; a picked pub or a
  // tour stop needs its own watch so walking in still says "Na zdraví".
  const ownWatch = target && (target.kind === 'tour' || picked) ? target : null;
  const own = useArrivalDetector({
    distanceMeters: ownWatch?.distance ?? null,
    gpsAccuracyMeters: position?.accuracyMeters ?? null,
    targetPubId: ownWatch?.key ?? null,
    hapticEnabled,
    soundEnabled,
  });
  const compassArrived = compass.arrived && !ownWatch && !focused;
  const arrived = own.arrived || compassArrived;
  const { dismissArrival } = compass;
  const ownDismiss = own.dismiss;
  const dismiss = useCallback(() => {
    ownDismiss();
    dismissArrival();
  }, [dismissArrival, ownDismiss]);
  // An arrival at a pub that is not on screen is not an arrival.
  useEffect(() => {
    if (compass.arrived && !compassArrived) dismissArrival();
  }, [compass.arrived, compassArrived, dismissArrival]);

  const excluded = useCallback(
    (pub: Pub) =>
      pub.venueKind === 'not_pub' ||
      (hideClosed && pubOpeningVerdict(pub) === false) ||
      !pubMatchesPriceFilter(pub, filters.priceMinCzk, filters.priceMaxCzk),
    [filters.priceMaxCzk, filters.priceMinCzk, hideClosed],
  );

  const nearest = useMemo(() => {
    if (!position || compass.isLoading) return null;
    return findNearestPub({
      lat: position.lat,
      lng: position.lng,
      maxKm: maxDistanceKm ?? UNLIMITED_SEARCH_RADIUS_KM,
      excludeIds: reportedPubIds,
      excludeCacheKeys: reportedCacheKeys,
      filterPub: (pub) => !excluded(pub),
      includeOtherPlaces: filters.includeOtherPlaces === true,
    });
    // compass.pub changes whenever the in-memory catalogue under it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compass.isLoading, compass.pub, excluded, filters.includeOtherPlaces, maxDistanceKm, position, reportedCacheKeys, reportedPubIds]);

  const others = useMemo(() => {
    if (!position) return [];
    return findNearbyPubs({ lat: position.lat, lng: position.lng, limit: 9, maxKm: DIAL_RANGE_KM })
      .filter(({ pub }) => geohash8(pub.lat, pub.lng) !== target?.key && !excluded(pub))
      .map(({ pub, distanceMeters }) => ({ id: pub.id || geohash8(pub.lat, pub.lng), coord: { latitude: pub.lat, longitude: pub.lng }, distance: distanceMeters }));
    // compass.pub changes whenever the in-memory catalogue under it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compass.pub, excluded, position, target?.key]);

  const mapPubs = useMemo(
    () =>
      map.pubs.filter((pub) => {
        if (hideClosed && pubOpeningVerdict(pub) === false) return false;
        return !onlyDrunk || (beersLastWeek?.get(geohash8(pub.lat, pub.lng)) ?? 0) > 0;
      }),
    [beersLastWeek, hideClosed, map.pubs, onlyDrunk],
  );

  const pins = useMemo(() => {
    const list = mapPubs.map((pub) => ({ key: geohash8(pub.lat, pub.lng), lat: pub.lat, lng: pub.lng, label: pinLabel(pub, pinMode, beersLastWeek) }));
    if (picked && !list.some((p) => p.key === geohash8(picked.lat, picked.lng))) {
      list.push({ key: geohash8(picked.lat, picked.lng), lat: picked.lat, lng: picked.lng, label: pinLabel(picked, pinMode, beersLastWeek) });
    }
    return list;
  }, [beersLastWeek, mapPubs, picked, pinMode]);

  const filterCount = activePubSearchFilterCount(filters) + (hideClosed ? 1 : 0) + (onlyDrunk ? 1 : 0);

  const state: CompassState =
    target && target.kind !== 'pub'
      ? 'normal'
      : compass.permissionState !== 'granted' && !position
        ? 'location'
        : compass.searchFailed && !target
          ? 'error'
          : compass.isLoading && !target
            ? 'loading'
            : target
              ? 'normal'
              : filterCount > 0
                ? 'noresults'
                : 'empty';

  const nextTarget = useCallback(() => {
    if (useKompasState.getState().picked || useFocusedPubStore.getState().pub) {
      useKompasState.getState().pick(null);
      useFocusedPubStore.getState().clear();
      return;
    }
    if (surprise) compass.reroll();
    else compass.skip();
  }, [compass, surprise]);

  return {
    compass,
    map,
    position,
    target,
    nearest,
    others,
    pins,
    mapPubs,
    beersLastWeek,
    filterCount,
    hideClosed,
    state,
    arrived,
    dismissArrival: dismiss,
    nextTarget,
    tourRun: activeRun,
  };
}

export type Kompas = ReturnType<typeof useKompas>;

export function pinLabel(pub: Pub, mode: 'price' | 'count', beers: PubBeersByKey | null): string | null {
  if (mode === 'count') {
    const n = beers?.get(geohash8(pub.lat, pub.lng));
    return n ? String(n) : null;
  }
  return pub.price && isPriceFresh(pub.price.observedAt) ? formatPrice(pub.price.czk, useSettingsStore.getState().priceCurrency) : null;
}
