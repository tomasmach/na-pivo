/**
 * The pub context the unified "Zmapuj hospodu" surface needs to also cover the
 * two non-amenity info groups — opening hours and beers on tap. The amenities
 * sheet historically only needed {pubKey, pubName}; once it became the single
 * pub-info hub it also has to (a) know whether hours/beers already exist so the
 * completeness ring spans all three groups, and (b) carry enough to deep-link
 * into the contribute editor with the current data pre-filled.
 *
 * `pubInfoFromPub` adapts the shared Pub shape (used by both the compass and the
 * counter) into this context, and `usePubInfoFacts` resolves the live presence
 * booleans by merging the local optimistic override with the enriched pub —
 * exactly the same precedence the contribute prefill uses.
 */

import { useMemo } from 'react';

import { geohash8 } from '@/data/geohash';
import type { Pub, PubPrice } from '@/data/pubs';
import {
  parseOsmOpeningHoursToWeeklyHours,
  type CommunityBeer,
  type WeeklyHours,
} from '@/data/communityHours';
import { isBeerOverrideCurrent, useCommunityStore } from '@/stores/communityStore';

export interface PubInfoContext {
  /** Source external id (for the contribute payload), when known. */
  externalId?: string | null;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  address?: string;
  userAddedClientId?: string;
  /** Structured community hours from the enrichment, if any (prefill source). */
  prefillHours?: WeeklyHours | null;
  /** Raw OSM opening_hours string fallback (still proves hours exist). */
  openingHours?: string | null;
  /** Beers on tap from the enrichment, if any (prefill source). */
  prefillBeers?: CommunityBeer[] | null;
  /** Removed rows kept as lightweight menu history and restore suggestions. */
  historicalBeers?: CommunityBeer[] | null;
  /** Whether the current list is a snapshot of intentionally rotating taps. */
  beerMenuRotates?: boolean;
  /** Fresh reference price attached by nearby discovery, including its age. */
  price?: PubPrice | null;
  /** ISO timestamps of the community's latest hours / beers contribution — the
   *  "naposledy zmapováno" recency shown on the hub's fact tiles. */
  hoursUpdatedAt?: string | null;
  beersUpdatedAt?: string | null;
}

/** Adapt the shared Pub shape into the hub's info context. */
export function pubInfoFromPub(pub: Pub): PubInfoContext {
  return {
    externalId: pub.id ?? null,
    name: pub.name,
    lat: pub.lat,
    lng: pub.lng,
    city: pub.city,
    address: pub.address,
    userAddedClientId: pub.userAddedClientId,
    prefillHours: pub.communityHours ?? null,
    openingHours: pub.openingHours ?? null,
    prefillBeers: pub.beers ?? null,
    historicalBeers: pub.historicalBeers ?? null,
    beerMenuRotates: pub.beerMenuRotates ?? false,
    price: pub.price ?? null,
    hoursUpdatedAt: pub.hoursUpdatedAt ?? null,
    beersUpdatedAt: pub.beersUpdatedAt ?? null,
  };
}

/** Serialize the shared pub-info context for the contribution editor route. */
export function contributeParamsFromPubInfo(
  info: PubInfoContext,
  focus: 'hours' | 'beers',
  resolvedBeerMenuRotates: boolean | undefined = info.beerMenuRotates,
): Record<string, string> {
  const prefillHours =
    info.prefillHours ?? parseOsmOpeningHoursToWeeklyHours(info.openingHours);

  return {
    focus,
    ...(info.externalId ? { id: info.externalId } : {}),
    name: info.name,
    lat: String(info.lat),
    lng: String(info.lng),
    ...(info.city ? { city: info.city } : {}),
    ...(prefillHours ? { hours: JSON.stringify(prefillHours) } : {}),
    ...(info.prefillBeers?.length ? { beers: JSON.stringify(info.prefillBeers) } : {}),
    ...(info.historicalBeers?.length
      ? { historicalBeers: JSON.stringify(info.historicalBeers) }
      : {}),
    ...(typeof resolvedBeerMenuRotates === 'boolean'
      ? { beerMenuRotates: resolvedBeerMenuRotates ? '1' : '0' }
      : {}),
  };
}

export interface PubInfoFactsView {
  hasHours: boolean;
  hasBeers: boolean;
  /** Beers on tap count (override wins over enrichment). */
  beerCount: number;
  beerMenuRotates: boolean;
}

function hoursHaveAnyInterval(hours: WeeklyHours | null | undefined): boolean {
  if (!hours) return false;
  return Object.values(hours).some((intervals) => intervals.length > 0);
}

/**
 * Resolve the live hours/beers presence for a pub, merging the local optimistic
 * override (the freshest truth, even offline) over the enriched pub. Returns null
 * when no info context is supplied (legacy amenities-only mounts). The hook is
 * called unconditionally; it just reads `overrides['']` (undefined) when absent.
 */
export function usePubInfoFacts(info: PubInfoContext | undefined): PubInfoFactsView | null {
  const cell = info ? geohash8(info.lat, info.lng) : '';
  const override = useCommunityStore((s) => s.overrides[cell]);

  return useMemo(() => {
    if (!info) return null;
    const hasHours =
      hoursHaveAnyInterval(override?.hours) ||
      hoursHaveAnyInterval(info.prefillHours) ||
      Boolean(info.openingHours);
    const currentOverride = isBeerOverrideCurrent(override, info.beersUpdatedAt)
      ? override
      : undefined;
    const beerCount = currentOverride?.beers?.length ?? info.prefillBeers?.length ?? 0;
    const beerMenuRotates =
      currentOverride?.beerMenuRotates ?? info.beerMenuRotates ?? false;
    return {
      hasHours,
      hasBeers: beerMenuRotates || beerCount > 0 || Boolean(info.price),
      beerCount,
      beerMenuRotates,
    };
  }, [info, override]);
}
