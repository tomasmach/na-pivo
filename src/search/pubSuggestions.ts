import { haversineMeters } from '@/compass/distance';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import { buildMapPubPoints, buildVisitedPubs } from '@/map/mapModel';
import type { TallySession } from '@/stores/tallyStore';

export interface PubSuggestion {
  pub: Pub;
  distanceMeters?: number;
  visitCount?: number;
}

interface SuggestionInput {
  pubs: Pub[];
  localSessions: TallySession[];
  serverVisits: WireVisit[];
  position: { lat: number; lng: number } | null;
  reportedIds: string[];
  reportedKeys: string[];
}

const validKey = (key: string) => /^[0123456789bcdefghjkmnpqrstuvwxyz]{8}$/.test(key);
const validPosition = ({ lat, lng }: { lat: number; lng: number }) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const timestamp = (value: string) => Date.parse(value) || 0;

/** Four distinct pubs, counting evenings rather than individual drinks. */
export function buildPubSuggestions({
  pubs, localSessions, serverVisits, position, reportedIds, reportedKeys,
}: SuggestionInput): { nearby: PubSuggestion[]; frequent: PubSuggestion[] } {
  const blockedIds = new Set(reportedIds);
  const blockedKeys = new Set(reportedKeys);
  // Keep exclusions before removing catalog rows, so visit fallbacks cannot
  // resurrect a reported place under another provider id.
  for (const pub of pubs) {
    if (blockedIds.has(pub.id) || (validPosition(pub) && blockedKeys.has(geohash8(pub.lat, pub.lng)))
      || pub.venueKind === 'not_pub'
      || (pub.discoveryKind !== undefined && pub.discoveryKind !== 'pub')) {
      blockedIds.add(pub.id);
      if (validPosition(pub)) blockedKeys.add(geohash8(pub.lat, pub.lng));
    }
  }
  const blocked = (id: string | null | undefined, key: string) =>
    (id != null && blockedIds.has(id)) || blockedKeys.has(key);
  const catalog = pubs.filter((pub) => validPosition(pub)
    && !blocked(pub.id, geohash8(pub.lat, pub.lng)));
  const excludedClientIds = new Set([
    ...serverVisits.filter((visit) => blocked(visit.external_id, visit.cache_key)
      || (validPosition(visit) && blockedKeys.has(geohash8(visit.lat, visit.lng))))
      .map((visit) => visit.client_id),
    ...localSessions.filter((session) => blocked(session.pubExternalId, session.pubKey))
      .map((session) => session.clientId),
  ]);
  const visits = buildVisitedPubs(
    serverVisits.filter((visit) => !excludedClientIds.has(visit.client_id)
      && validPosition(visit) && (!visit.cache_key || validKey(visit.cache_key))),
    localSessions.filter((session) => !excludedClientIds.has(session.clientId)
      && validKey(session.pubKey) && session.drinks.length > 0
      && (session.placeContext === undefined || session.placeContext === 'pub')),
    catalog,
  );
  const { points } = buildMapPubPoints(catalog, visits, false, false);
  const currentPosition = position && validPosition(position) ? position : null;
  const candidates = points.map((point) => ({
    key: point.key,
    lastVisitedAt: point.visit?.lastVisitedAt ?? '',
    suggestion: {
      pub: point.pub,
      ...(point.visit ? { visitCount: point.visit.visitCount } : {}),
      ...(currentPosition ? { distanceMeters: haversineMeters(currentPosition, point) } : {}),
    } satisfies PubSuggestion,
  }));
  const closest = candidates.filter(({ suggestion }) => suggestion.distanceMeters !== undefined
    && suggestion.distanceMeters <= 10_000)
    .sort((a, b) => a.suggestion.distanceMeters! - b.suggestion.distanceMeters!);
  const mostVisited = candidates.filter(({ suggestion }) => (suggestion.visitCount ?? 0) > 0)
    .sort((a, b) => b.suggestion.visitCount! - a.suggestion.visitCount!
      || timestamp(b.lastVisitedAt) - timestamp(a.lastVisitedAt));
  const nearby: PubSuggestion[] = [];
  const frequent: PubSuggestion[] = [];
  const usedIds = new Set<string>();
  const usedKeys = new Set<string>();
  const take = (source: typeof candidates, target: PubSuggestion[], count: number) => {
    for (const candidate of source) {
      if (count <= 0) break;
      if (usedIds.has(candidate.suggestion.pub.id) || usedKeys.has(candidate.key)) continue;
      target.push(candidate.suggestion);
      usedIds.add(candidate.suggestion.pub.id);
      usedKeys.add(candidate.key);
      count -= 1;
    }
  };
  take(closest, nearby, 2);
  take(mostVisited, frequent, 2);
  take(closest, nearby, 4 - nearby.length - frequent.length);
  take(mostVisited, frequent, 4 - nearby.length - frequent.length);
  return { nearby, frequent };
}
