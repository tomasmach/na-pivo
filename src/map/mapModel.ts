import { decodeGeohash8, geohash8 } from '@/data/geohash';
import { haversineMeters } from '@/compass/distance';
import type { FriendPubActivity } from '@/data/friendsClient';
import type { Pub } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import type { TallySession } from '@/stores/tallyStore';
import { isContextPubKey } from '@/drinks/drinkTypes';

export interface VisitedPubSummary {
  cacheKey: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  visitCount: number;
  lastVisitedAt: string;
}

export interface VisitedCitySummary {
  key: string;
  name: string;
  lat: number;
  lng: number;
  visitCount: number;
  pubCount: number;
  lastVisitedAt: string;
}

export interface LivePubSummary {
  cacheKey: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  activities: FriendPubActivity[];
}

export interface MapPubPoint {
  key: string;
  pub: Pub;
  lat: number;
  lng: number;
  visit: VisitedPubSummary | null;
}

export interface MapPubPointSet {
  points: MapPubPoint[];
}

export interface MapCluster<T> {
  id: string;
  lat: number;
  lng: number;
  items: T[];
}

/** Half-diagonal of a map viewport in kilometres. Viewport fetchers use this
 *  as the honest area that must be covered around the camera centre. */
export function mapViewportCoverageKm(region: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}): number {
  const latKm = region.latitudeDelta * 111;
  const lngKm =
    region.longitudeDelta * 111 * Math.cos((region.latitude * Math.PI) / 180);
  return Math.hypot(latKm / 2, lngKm / 2);
}

/** Fetch a little beyond the visible edge so a short follow-up pan does not
 *  expose an empty strip before the next request settles. */
export function mapViewportRadiusKm(region: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}): number {
  return Math.min(100, Math.max(1, mapViewportCoverageKm(region) * 1.25));
}

export function mapViewportCacheCovers(
  cache: { centerLat: number; centerLng: number; coveredKm: number },
  region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  },
): boolean {
  const movedKm =
    haversineMeters(
      { lat: cache.centerLat, lng: cache.centerLng },
      { lat: region.latitude, lng: region.longitude },
    ) / 1000;
  return movedKm + mapViewportCoverageKm(region) <= cache.coveredKm;
}

/** Merge viewport pages without making pubs at the previous edge disappear.
 *  The cap bounds marker work during a long browsing session. */
export function mergeMapPubs(previous: Pub[], incoming: Pub[]): Pub[] {
  const pubs = new Map(previous.map((pub) => [pub.id, pub]));
  for (const pub of incoming) {
    pubs.delete(pub.id);
    pubs.set(pub.id, pub);
  }
  return [...pubs.values()]
    .filter((pub) => pub.venueKind !== 'not_pub')
    .slice(-600);
}

function normalizedCity(city: string | null | undefined): string {
  return (city ?? '').trim().replace(/\s+/g, ' ');
}

function timestampMax(a: string, b: string): string {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

function pubByKey(pubs: Pub[]): Map<string, Pub> {
  const map = new Map<string, Pub>();
  for (const pub of pubs) map.set(geohash8(pub.lat, pub.lng), pub);
  return map;
}

export function pubOpeningVerdict(pub: Pub): boolean | null {
  return pub.hoursStatus === 'ok' && typeof pub.isOpenNow === 'boolean' ? pub.isOpenNow : null;
}

/**
 * Build the one pub dataset shared by map pins and the result list. A missing
 * opening-hours verdict stays visible: "hide closed" only removes pubs that are
 * explicitly known to be closed.
 */
export function buildMapPubPoints(
  pubs: Pub[],
  visitedPubs: VisitedPubSummary[],
  visitedOnly: boolean,
  hideClosed: boolean,
  includeMissingVisited = true,
): MapPubPointSet {
  const visitedByKey = new Map(visitedPubs.map((visit) => [visit.cacheKey, visit]));
  const byKey = new Map<string, MapPubPoint>();

  for (const pub of pubs) {
    const key = geohash8(pub.lat, pub.lng);
    const visit = visitedByKey.get(key) ?? null;
    if (visitedOnly && !visit) continue;
    byKey.set(key, { key, pub, lat: pub.lat, lng: pub.lng, visit });
  }

  for (const visit of visitedPubs) {
    if (!includeMissingVisited) continue;
    if (byKey.has(visit.cacheKey)) continue;
    byKey.set(visit.cacheKey, {
      key: visit.cacheKey,
      pub: {
        id: `visit:${visit.cacheKey}`,
        name: visit.name,
        lat: visit.lat,
        lng: visit.lng,
        ...(visit.city ? { city: visit.city } : {}),
      },
      lat: visit.lat,
      lng: visit.lng,
      visit,
    });
  }

  const candidates = [...byKey.values()];
  const points = hideClosed
    ? candidates.filter((point) => pubOpeningVerdict(point.pub) !== false)
    : candidates;

  return { points };
}

function latestSessionDrinkAt(session: TallySession): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const drink of session.drinks) {
    const ms = Date.parse(drink.at);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = drink.at;
    }
  }
  return latest;
}

/** Merge server history with unsynced/local evenings and aggregate by pub cell. */
export function buildVisitedPubs(
  serverVisits: WireVisit[],
  localSessions: TallySession[],
  pubs: Pub[],
): VisitedPubSummary[] {
  const catalog = pubByKey(pubs);
  const visitsByClientId = new Map<string, WireVisit>();
  for (const visit of serverVisits) visitsByClientId.set(visit.client_id, visit);

  for (const session of localSessions) {
    // Outside evenings ("ctx:*") are not pub visits — decoding their synthetic
    // key would fabricate a map pin in the middle of nowhere.
    if (isContextPubKey(session.pubKey)) continue;
    const coords = decodeGeohash8(session.pubKey);
    const match = catalog.get(session.pubKey);
    const endedAt = latestSessionDrinkAt(session);
    const localVisit: WireVisit = {
      client_id: session.clientId,
      cache_key: session.pubKey,
      name: session.pubName,
      lat: coords.lat,
      lng: coords.lng,
      city: session.pubCity || match?.city || null,
      external_id: session.pubExternalId ?? null,
      started_at: session.startedAt,
      ended_at: endedAt,
      updated_at: endedAt ?? session.startedAt,
    };
    const remote = visitsByClientId.get(session.clientId);
    if (!remote) {
      visitsByClientId.set(session.clientId, localVisit);
      continue;
    }
    if (Date.parse(localVisit.updated_at) > Date.parse(remote.updated_at)) {
      visitsByClientId.set(session.clientId, {
        ...localVisit,
        city: localVisit.city || remote.city,
        external_id: localVisit.external_id || remote.external_id,
      });
    } else if ((!remote.city && localVisit.city) || (!remote.external_id && localVisit.external_id)) {
      visitsByClientId.set(session.clientId, {
        ...remote,
        city: remote.city || localVisit.city,
        external_id: remote.external_id || localVisit.external_id,
      });
    }
  }

  const grouped = new Map<string, VisitedPubSummary>();
  for (const visit of visitsByClientId.values()) {
    const key = visit.cache_key || geohash8(visit.lat, visit.lng);
    const match = catalog.get(key);
    const city = normalizedCity(visit.city || match?.city);
    const lastVisitedAt = visit.ended_at || visit.started_at || visit.updated_at;
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, {
        cacheKey: key,
        name: visit.name || match?.name || 'Hospoda',
        lat: visit.lat,
        lng: visit.lng,
        city,
        visitCount: 1,
        lastVisitedAt,
      });
      continue;
    }
    previous.visitCount += 1;
    previous.lastVisitedAt = timestampMax(previous.lastVisitedAt, lastVisitedAt);
    if (!previous.city && city) previous.city = city;
    if (!previous.name && visit.name) previous.name = visit.name;
  }

  return [...grouped.values()].sort(
    (a, b) => Date.parse(b.lastVisitedAt) - Date.parse(a.lastVisitedAt),
  );
}

export function buildVisitedCities(visited: VisitedPubSummary[]): VisitedCitySummary[] {
  const cities = new Map<string, VisitedCitySummary & { latSum: number; lngSum: number }>();
  for (const pub of visited) {
    if (!pub.city) continue;
    const key = pub.city.toLocaleLowerCase('cs-CZ');
    const previous = cities.get(key);
    if (!previous) {
      cities.set(key, {
        key,
        name: pub.city,
        lat: pub.lat,
        lng: pub.lng,
        latSum: pub.lat,
        lngSum: pub.lng,
        visitCount: pub.visitCount,
        pubCount: 1,
        lastVisitedAt: pub.lastVisitedAt,
      });
      continue;
    }
    previous.visitCount += pub.visitCount;
    previous.pubCount += 1;
    previous.latSum += pub.lat;
    previous.lngSum += pub.lng;
    previous.lat = previous.latSum / previous.pubCount;
    previous.lng = previous.lngSum / previous.pubCount;
    previous.lastVisitedAt = timestampMax(previous.lastVisitedAt, pub.lastVisitedAt);
  }
  return [...cities.values()]
    .map(({ latSum: _latSum, lngSum: _lngSum, ...city }) => city)
    .sort((a, b) => Date.parse(b.lastVisitedAt) - Date.parse(a.lastVisitedAt));
}

/** Only explicit, unexpired live broadcasts become friend pins. */
export function buildLivePubs(
  activities: FriendPubActivity[],
  nowMs: number = Date.now(),
): LivePubSummary[] {
  const grouped = new Map<string, LivePubSummary>();
  for (const activity of activities) {
    const key = activity.cacheKey.trim();
    if (
      !key ||
      activity.kind !== 'live' ||
      !activity.active ||
      !Number.isFinite(Date.parse(activity.expiresAt)) ||
      Date.parse(activity.expiresAt) <= nowMs
    ) {
      continue;
    }
    const previous = grouped.get(key);
    if (previous) {
      previous.activities.push(activity);
      continue;
    }
    const { lat, lng } = decodeGeohash8(key);
    grouped.set(key, {
      cacheKey: key,
      name: activity.name || 'Hospoda',
      city: normalizedCity(activity.city),
      lat,
      lng,
      activities: [activity],
    });
  }
  return [...grouped.values()];
}

/**
 * Deterministic world-anchored grid clustering. Cell sizes follow the zoom,
 * while cell boundaries stay fixed when the map is panned. This prevents pins
 * from jumping between clusters just because the viewport center moved.
 */
export function clusterCoordinates<T extends { lat: number; lng: number }>(
  items: T[],
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  // Coarse grid on purpose: fewer, larger clusters read better than a screen
  // full of small overlapping bubbles.
  columns: number = 5,
  rows: number = 8,
): MapCluster<T>[] {
  if (items.length === 0) return [];
  // Native maps report tiny delta fluctuations while panning even when the
  // user did not zoom. Snapping the cell size to powers of two keeps those
  // harmless changes from moving pubs across otherwise world-anchored cells.
  const quantizeStep = (raw: number) => {
    const safe = Math.max(raw, 0.00005);
    return 2 ** Math.round(Math.log2(safe));
  };
  const latStep = quantizeStep(region.latitudeDelta / rows);
  const lngStep = quantizeStep(region.longitudeDelta / columns);
  const buckets = new Map<string, MapCluster<T>>();

  for (const item of items) {
    const latCell = Math.floor((item.lat + 90) / latStep);
    const lngCell = Math.floor((item.lng + 180) / lngStep);
    const id = `${latCell}:${lngCell}`;
    const bucket = buckets.get(id);
    if (!bucket) {
      buckets.set(id, {
        id,
        lat: item.lat,
        lng: item.lng,
        items: [item],
      });
      continue;
    }
    const nextCount = bucket.items.length + 1;
    bucket.lat = (bucket.lat * bucket.items.length + item.lat) / nextCount;
    bucket.lng = (bucket.lng * bucket.items.length + item.lng) / nextCount;
    bucket.items.push(item);
  }

  return [...buckets.values()];
}
