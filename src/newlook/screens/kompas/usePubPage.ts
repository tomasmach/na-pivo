import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';

import { checkLocationPermission } from '@/compass/permissions';
import { pubInfoFromPub, usePubInfoFacts } from '@/components/amenities/pubInfoContext';
import { computeOpenState } from '@/data/communityHours';
import { decodeGeohash8, geohash8 } from '@/data/geohash';
import { fetchPubHours } from '@/data/hoursClient';
import { fetchPubAmenities, type WireAmenityAggregate, type WireAmenityCompleteness } from '@/data/pubAmenitiesClient';
import { buildAmenityRows, selectPubInfoCompleteness } from '@/data/pubAmenitiesView';
import { fetchPubBeersLastWeek } from '@/data/pubBeersClient';
import { fetchUpcomingPubEvents, type PubEvent } from '@/data/pubEventsClient';
import { pubIdentityKey } from '@/data/pubIdentity';
import { getAllLoadedPubs, type Pub } from '@/data/pubs';
import { currentTaps, inPubTime, isEventOfPub, isSamePubRecord, visibleEvents, withCatalogDetails } from '@/pubPage/pubPageModel';
import { usePubVisitSummary } from '@/pubPage/usePubVisitSummary';
import { isBeerListOverrideCurrent, useCommunityStore } from '@/stores/communityStore';
import { selectPubVotes, usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubPageStore } from '@/stores/pubPageStore';

import { hoursNow } from './format';

const CELL = /^[0123456789bcdefghjkmnpqrstuvwxyz]{8}$/;
const POSITION_MAX_AGE_MS = 5 * 60 * 1000;
const HOURS_RETRY_MS = 4000;
const HOURS_RETRY_LIMIT = 4;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function coordinate(value: string, limit: number): number {
  const parsed = value.trim() ? Number(value) : NaN;
  return Math.abs(parsed) <= limit ? parsed : NaN;
}

/**
 * The pub a new-look route was opened for: the opener's hand-off, the loaded
 * catalogue, or the bare name and cell from a link. `id` is the geohash-8 cell.
 */
export function useParamPub(): { key: string; pub: Pub | null } {
  const params = useLocalSearchParams<{ id?: string; ref?: string; name?: string; lat?: string; lng?: string }>();
  const key = first(params.id).toLowerCase();
  const ref = first(params.ref);
  const name = first(params.name);
  const remembered = usePubPageStore((s) => (ref ? s.pubs[ref] : undefined));
  const pub = useMemo(() => {
    if (!CELL.test(key) && !remembered) return null;
    const loaded = getAllLoadedPubs().find(
      (p) =>
        (remembered?.id && p.id === remembered.id) ||
        (geohash8(p.lat, p.lng) === key &&
          // A bare cell link names no pub, so the pub in that cell is the one.
          (!(remembered?.name ?? name) || isSamePubRecord({ name: p.name, externalId: p.id }, { id: remembered?.id ?? '', name: remembered?.name ?? name }))),
    );
    if (remembered) return withCatalogDetails(remembered, loaded);
    if (loaded) return loaded;
    let lat = coordinate(first(params.lat), 90);
    let lng = coordinate(first(params.lng), 180);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) ({ lat, lng } = decodeGeohash8(key));
    return name ? { id: '', name, lat, lng } : null;
  }, [key, name, params.lat, params.lng, remembered]);
  return { key: CELL.test(key) ? key : pub ? geohash8(pub.lat, pub.lng) : '', pub };
}

/** The last position the OS already has; opening a pub never asks for a new fix. */
export function useRecentPosition(): { lat: number; lng: number } | null {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        if ((await checkLocationPermission()) !== 'granted') return;
        const fix = await Location.getLastKnownPositionAsync({ maxAge: POSITION_MAX_AGE_MS, requiredAccuracy: 100 });
        if (active && fix) setPosition({ lat: fix.coords.latitude, lng: fix.coords.longitude });
      } catch {
        // The page reads fine without a distance.
      }
    };
    void read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return position;
}

/** Hours, taps, events, last week's beers, mapping progress and own visits of one pub. */
export function usePubDetails(initial: Pub | null, key: string) {
  const [pub, setPub] = useState<Pub | null>(initial);
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [events, setEvents] = useState<PubEvent[]>([]);
  const [beersLastWeek, setBeersLastWeek] = useState<number | null>(null);
  const [aggregates, setAggregates] = useState<WireAmenityAggregate[] | undefined>(undefined);
  const [completeness, setCompleteness] = useState<WireAmenityCompleteness | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [openedFor, setOpenedFor] = useState(initial);
  if (openedFor !== initial) {
    setOpenedFor(initial);
    setPub(initial);
  }

  const pubId = pub?.id ?? '';
  useEffect(() => {
    if (!initial) return;
    const controller = new AbortController();
    const opened = initial;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // A cache miss answers "pending" while the server fills the pub in, so it asks a few more times.
    const load = () => {
      attempts += 1;
      void fetchPubHours([opened], controller.signal).then((response) => {
        if (controller.signal.aborted) return;
        setHoursLoaded(true);
        const d = response.get(opened.id);
        if (!d) return;
        if (d.status === 'pending' && attempts < HOURS_RETRY_LIMIT) timer = setTimeout(load, HOURS_RETRY_MS);
        setPub((current) =>
          current
            ? {
                ...current,
                openingHours: d.openingHours,
                isOpenNow: d.isOpenNow,
                nextChange: d.nextChange,
                hoursStatus: d.status,
                communityHours: d.communityHours ?? current.communityHours,
                beers: d.beers,
                historicalBeers: d.historicalBeers,
                beerMenuRotates: d.beerMenuRotates,
                beersUpdatedAt: d.beersUpdatedAt,
                hoursUpdatedAt: d.hoursUpdatedAt,
                rating: d.rating ?? current.rating,
                ratingCount: d.ratingCount ?? current.ratingCount,
                ratingLabel: d.ratingLabel ?? current.ratingLabel,
              }
            : current,
        );
      });
    };
    load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // Refresh once per opened pub, not after filling it in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubId, key]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void fetchUpcomingPubEvents(key, controller.signal).then((result) => {
      if (!controller.signal.aborted && result) setEvents(result);
    });
    void fetchPubBeersLastWeek(controller.signal).then((beers) => {
      if (!controller.signal.aborted) setBeersLastWeek(beers?.get(key) ?? null);
    });
    return () => controller.abort();
  }, [key]);

  const name = pub?.name ?? '';
  const identityKey = useMemo(() => pubIdentityKey(key, name), [key, name]);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void fetchPubAmenities([key], controller.signal, name).then((pubs) => {
      if (controller.signal.aborted || !pubs) return;
      const found = pubs.find((p) => p.cache_key === key) ?? pubs[0];
      setAggregates(found?.amenities ?? []);
      setCompleteness(found?.completeness ?? null);
    });
    return () => controller.abort();
  }, [key, name]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const myVotes = usePubAmenitiesStore(selectPubVotes(identityKey));
  const info = useMemo(() => (pub ? pubInfoFromPub(pub) : undefined), [pub]);
  const facts = usePubInfoFacts(info);
  const override = useCommunityStore((s) => (key ? s.overrides[key] : undefined));
  const visit = usePubVisitSummary(pub, key);

  const mappedPercent = useMemo(() => {
    if (!facts) return 0;
    const rows = buildAmenityRows({ aggregates, myVotes });
    const snap = completeness ? { mappedCount: completeness.mapped_count, totalKinds: completeness.total_kinds, pct: completeness.pct } : null;
    return Math.round(selectPubInfoCompleteness(rows, facts, snap).pct * 100);
  }, [aggregates, completeness, facts, myVotes]);

  const taps = useMemo(
    () => (pub ? currentTaps(override, isBeerListOverrideCurrent(override, pub.beersUpdatedAt), pub.beers) : []),
    [override, pub],
  );
  // The page asks the server once, so hours filled in here show from the local edit until the next visit.
  const hours = useMemo(() => {
    const local = override?.hours;
    const serverAt = pub?.hoursUpdatedAt ? Date.parse(pub.hoursUpdatedAt) : 0;
    if (local && !(override.updatedAt <= serverAt)) {
      const open = computeOpenState(local, now);
      return hoursNow({ hoursStatus: 'ok', isOpenNow: open.isOpenNow, nextChange: open.nextChange });
    }
    return hoursNow(pub ?? {});
  }, [now, override, pub]);
  const shownEvents = useMemo(
    () => visibleEvents(pub ? events.filter((event) => isEventOfPub(event, pub)) : events, now).map(inPubTime),
    [events, now, pub],
  );

  return { pub, hoursLoaded, hours, taps, events: shownEvents, beersLastWeek, mappedPercent, visit, aggregates, identityKey, now };
}
