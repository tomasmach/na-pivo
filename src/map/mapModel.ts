import { decodeGeohash8, geohash8 } from '@/data/geohash';
import type { FriendPubActivity } from '@/data/friendsClient';
import type { Pub } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import type { TallySession } from '@/stores/tallyStore';

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

export interface MapCluster<T> {
  id: string;
  lat: number;
  lng: number;
  items: T[];
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
 * Deterministic screen-grid clustering. It keeps render cost bounded without a
 * native dependency and naturally dissolves clusters as the map zooms in.
 */
export function clusterCoordinates<T extends { lat: number; lng: number }>(
  items: T[],
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  columns: number = 7,
  rows: number = 12,
): MapCluster<T>[] {
  if (items.length === 0) return [];
  const latStep = Math.max(region.latitudeDelta / rows, 0.00005);
  const lngStep = Math.max(region.longitudeDelta / columns, 0.00005);
  const clusters: MapCluster<T>[] = [];

  // A greedy nearest-cell pass avoids the visual seam of a strict floor grid,
  // where two adjacent pubs can land in different buckets only because they sit
  // on opposite sides of an invisible cell boundary.
  for (const item of items) {
    const match = clusters.find(
      (cluster) =>
        Math.abs(cluster.lat - item.lat) <= latStep * 0.72 &&
        Math.abs(cluster.lng - item.lng) <= lngStep * 0.72,
    );
    if (!match) {
      clusters.push({
        id: String(clusters.length),
        lat: item.lat,
        lng: item.lng,
        items: [item],
      });
      continue;
    }
    match.items.push(item);
    match.lat = match.items.reduce((sum, value) => sum + value.lat, 0) / match.items.length;
    match.lng = match.items.reduce((sum, value) => sum + value.lng, 0) / match.items.length;
  }

  return clusters;
}
