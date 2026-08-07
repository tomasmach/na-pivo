import { formatDistanceCs, haversineMeters } from '@/compass/distance';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import type { WireAmenityAggregate } from '@/data/pubAmenitiesClient';
import type { WireVisit } from '@/data/visitsClient';

export interface PubPosition {
  lat: number;
  lng: number;
}

export type PubOpenState = 'open' | 'closed' | 'unknown' | 'loading';

export interface PubVisitSummary {
  count: number;
  lastVisitedAt: string | null;
}

export interface PubPresentation {
  pub: Pub;
  id: string;
  name: string;
  address: string;
  distanceMeters: number | null;
  distanceLabel: string | null;
  distanceValue: string | null;
  distanceUnit: string | null;
  openState: PubOpenState;
  openLabel: string;
  featuredTap: { name: string; priceCzk: number | null } | null;
  beerLine: string | null;
  rating: number | null;
  ratingLabel: string | null;
  hasGarden: boolean;
  hasTankBeer: boolean;
  visitCount: number;
  lastVisitedAt: string | null;
}

export interface PubListFilters {
  beers: readonly string[];
  openOnly: boolean;
  tankOnly: boolean;
  gardenOnly: boolean;
}

export type PubSort = 'nearest' | 'rating' | 'random';

function localTimeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const tIndex = iso.indexOf('T');
  if (tIndex === -1) return null;
  const hhmm = iso.slice(tIndex + 1, tIndex + 6);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

export function presentOpenStatus(pub: Pub): {
  state: PubOpenState;
  label: string;
} {
  if (
    (pub.hoursStatus === 'loading' || pub.hoursStatus === 'pending') &&
    pub.isOpenNow == null
  ) {
    return { state: 'loading', label: 'Načítám otevíračku' };
  }

  const nextChange = localTimeFromIso(pub.nextChange);
  if (pub.isOpenNow === true) {
    return {
      state: 'open',
      label: nextChange ? `Otevřeno do ${nextChange}` : 'Otevřeno',
    };
  }
  if (pub.isOpenNow === false) {
    return {
      state: 'closed',
      label: nextChange ? `Zavřeno · otevře v ${nextChange}` : 'Zavřeno',
    };
  }
  return { state: 'unknown', label: 'Otevírací doba neznámá' };
}

function splitDistance(distance: string | null): { value: string | null; unit: string | null } {
  if (!distance) return { value: null, unit: null };
  const match = distance.match(/^(.+?)\s*(km|m)$/);
  return match ? { value: match[1].trim(), unit: match[2] } : { value: distance, unit: null };
}

function amenityIsYes(amenities: readonly WireAmenityAggregate[] | undefined, key: string): boolean {
  return amenities?.some(
    (amenity) => amenity.amenity_key === key && amenity.status === 'yes',
  ) === true;
}

export function summarizePubVisits(pub: Pub, visits: readonly WireVisit[]): PubVisitSummary {
  const cacheKey = geohash8(pub.lat, pub.lng);
  const matches = visits.filter(
    (visit) =>
      visit.cache_key === cacheKey ||
      (visit.external_id != null && visit.external_id === pub.id),
  );
  const lastVisitedAt = matches.reduce<string | null>((latest, visit) => {
    const candidate = visit.ended_at ?? visit.started_at;
    if (!candidate) return latest;
    if (!latest) return candidate;
    const candidateAt = Date.parse(candidate);
    const latestAt = Date.parse(latest);
    if (Number.isNaN(candidateAt)) return latest;
    if (Number.isNaN(latestAt) || candidateAt > latestAt) return candidate;
    return latest;
  }, null);
  return { count: matches.length, lastVisitedAt };
}

export function presentPub(
  pub: Pub,
  position: PubPosition | null,
  visits: readonly WireVisit[] = [],
  amenityOverride?: readonly WireAmenityAggregate[],
): PubPresentation {
  const distanceMeters = position ? haversineMeters(position, pub) : null;
  const distanceLabel = distanceMeters == null ? null : formatDistanceCs(distanceMeters);
  const distance = splitDistance(distanceLabel);
  const open = presentOpenStatus(pub);
  const firstBeer = pub.beers?.find((beer) => beer.name.trim().length > 0) ?? null;
  const featuredTap = firstBeer
    ? {
        name: firstBeer.name.trim(),
        priceCzk: typeof firstBeer.priceCzk === 'number' ? firstBeer.priceCzk : null,
      }
    : null;
  const referencePrice =
    typeof pub.price?.czk === 'number' && Number.isFinite(pub.price.czk) ? pub.price.czk : null;
  const beerLine = featuredTap
    ? featuredTap.priceCzk == null
      ? featuredTap.name
      : `${featuredTap.name}  (${featuredTap.priceCzk} Kč)`
    : referencePrice == null
      ? null
      : `Pivo od ${referencePrice} Kč`;
  const rating =
    typeof pub.rating === 'number' && Number.isFinite(pub.rating) ? pub.rating : null;
  const visitsSummary = summarizePubVisits(pub, visits);
  const amenities = amenityOverride ?? pub.amenities;

  return {
    pub,
    id: pub.id,
    name: pub.name,
    address: pub.address?.trim() || pub.city?.trim() || 'Adresa není známá',
    distanceMeters,
    distanceLabel,
    distanceValue: distance.value,
    distanceUnit: distance.unit,
    openState: open.state,
    openLabel: open.label,
    featuredTap,
    beerLine,
    rating,
    ratingLabel: pub.ratingLabel?.trim() || null,
    hasGarden: pub.hasGarden === true || amenityIsYes(amenities, 'seating_garden'),
    hasTankBeer: amenityIsYes(amenities, 'practical_tank_beer'),
    visitCount: visitsSummary.count,
    lastVisitedAt: visitsSummary.lastVisitedAt,
  };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('cs-CZ');
}

export function beerFilterOptions(pubs: readonly Pub[]): string[] {
  const byKey = new Map<string, string>();
  for (const pub of pubs) {
    for (const beer of pub.beers ?? []) {
      const name = beer.name.trim();
      if (name) byKey.set(normalize(name), name);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'cs-CZ'));
}

export function pubMatchesFilters(pub: PubPresentation, filters: PubListFilters): boolean {
  // Beer, tank and garden are hard server filters. A nearby response may omit
  // its bulky beer menu or amenity aggregates even though that pub matched;
  // filtering those fields again here would erase authoritative results.
  if (filters.openOnly && pub.openState !== 'open') return false;
  return true;
}

/** Translate the redesign's friendly selections to canonical nearby wire keys. */
export function serverFiltersForPubList(filters: PubListFilters): {
  beerBrandKeys: string[];
  amenityKeys: string[];
} {
  return {
    beerBrandKeys: Array.from(new Set(filters.beers.map((key) => key.trim()).filter(Boolean))).sort(),
    amenityKeys: [
      ...(filters.tankOnly ? ['practical_tank_beer'] : []),
      ...(filters.gardenOnly ? ['seating_garden'] : []),
    ],
  };
}

function seededRank(id: string, seed: number): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sortPubs(
  pubs: readonly PubPresentation[],
  sort: PubSort,
  randomSeed = 0,
): PubPresentation[] {
  return pubs
    .map((pub, index) => ({ pub, index }))
    .sort((a, b) => {
      if (sort === 'rating') {
        if (a.pub.rating == null && b.pub.rating != null) return 1;
        if (a.pub.rating != null && b.pub.rating == null) return -1;
        if (a.pub.rating != null && b.pub.rating != null && a.pub.rating !== b.pub.rating) {
          return b.pub.rating - a.pub.rating;
        }
      } else if (sort === 'random') {
        const rankDifference =
          seededRank(a.pub.id, randomSeed) - seededRank(b.pub.id, randomSeed);
        if (rankDifference !== 0) return rankDifference;
      } else {
        if (a.pub.distanceMeters == null || b.pub.distanceMeters == null) return a.index - b.index;
        if (a.pub.distanceMeters !== b.pub.distanceMeters) {
          return a.pub.distanceMeters - b.pub.distanceMeters;
        }
      }
      return a.index - b.index;
    })
    .map(({ pub }) => pub);
}

export function formatLastVisit(iso: string | null, now = new Date()): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (dateKey === todayKey) return 'dnes';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  if (dateKey === yesterdayKey) return 'včera';
  return `${date.getDate()}. ${date.getMonth() + 1}.`;
}
