import KDBush from "kdbush";
import * as geokdbush from "geokdbush";
import { searchPubsNear } from "./mapyClient";
import { fetchBlockedPubReports } from "./pubReportsClient";
import { geohash8 } from "./geohash";
import type { CommunityBeer, WeeklyHours } from "./communityHours";

/**
 * Lifecycle of an opening-hours lookup for a single pub.
 *
 * - 'ok'      — hours were resolved (openingHours / isOpenNow may still be null
 *               if the source had no schedule, but the lookup itself succeeded).
 * - 'unknown' — the backend looked but found no usable hours.
 * - 'pending' — the backend accepted the request but is still resolving it
 *               (lazy fill in progress); the client may retry later.
 * - 'error'   — the backend reported a failure for this pub.
 * - 'loading' — client-side state while the request is in flight.
 *
 * Opening hours are a non-blocking enrichment: when the backend is unset or a
 * request fails, hours fields simply stay undefined and the app behaves exactly
 * as it does without a backend.
 */
export type HoursStatus = 'ok' | 'unknown' | 'pending' | 'error' | 'loading';

export type Pub = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  /** Human-readable opening hours (e.g. "Po–Pá 11:00–23:00"), or null if none. */
  openingHours?: string | null;
  /** Whether the pub is open at the moment the lookup resolved, or null/unknown. */
  isOpenNow?: boolean | null;
  /** ISO-8601 timestamp of the next open/close transition, or null if unknown. */
  nextChange?: string | null;
  /** Lifecycle of the opening-hours lookup for this pub. */
  hoursStatus?: HoursStatus;
  /** Origin of the resolved hours (e.g. "community", "firmy"); undefined if none. */
  hoursSource?: string;
  /** Structured weekly hours when the source is community — used for form prefill. */
  communityHours?: WeeklyHours;
  /** Beers on tap, when known (community-sourced). */
  beers?: CommunityBeer[];
};

let _pubs: Pub[] = [];
let _index: KDBush | null = null;
let _idMap: Map<string, Pub> = new Map();
/** geohash-8 cell per pub, parallel to _pubs — precomputed so selection-time
 *  cache-key exclusion does not re-encode coordinates on every query. */
let _cacheKeys: string[] = [];
let _loaded = false;
let _lastFetchCenter: { lat: number; lng: number } | null = null;
let _lastFetchRadiusKm: number | null = null;
let _inflight: Promise<void> | null = null;

interface FetchPubsNearOptions {
  force?: boolean;
  radiusKm?: number;
}

/** Re-fetch from Mapy.cz when the user has moved more than this distance from
 *  the previous fetch center (km). */
const REFETCH_THRESHOLD_KM = 2;
const DEFAULT_FETCH_RADIUS_KM = 25;

/** mulberry32 seeded PRNG — returns a function that yields floats in [0, 1) */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Builds a KDBush index from the given pubs array.
 * Exposed so tests can inject synthetic data without hitting the network.
 */
export function _init(syntheticPubs: Pub[]): void {
  _pubs = syntheticPubs.slice();
  _idMap = new Map(_pubs.map((p) => [p.id, p]));
  _cacheKeys = _pubs.map((p) => geohash8(p.lat, p.lng));

  if (_pubs.length === 0) {
    _index = null;
    _loaded = true;
    return;
  }

  const idx = new KDBush(_pubs.length);
  for (const pub of _pubs) {
    idx.add(pub.lng, pub.lat);
  }
  idx.finish();
  _index = idx;
  _loaded = true;
}

/**
 * Fetch pubs near (lat, lng) from Mapy.cz and rebuild the spatial index.
 * Short-circuits when the user is within REFETCH_THRESHOLD_KM of the last
 * fetch center, so it is safe to call on every GPS update.
 */
export async function fetchPubsNear(
  lat: number,
  lng: number,
  signal?: AbortSignal,
  options: FetchPubsNearOptions = {},
): Promise<void> {
  const radiusKm = Number.isFinite(options.radiusKm)
    ? Math.max(options.radiusKm ?? DEFAULT_FETCH_RADIUS_KM, 0.1)
    : DEFAULT_FETCH_RADIUS_KM;

  if (!options.force && _loaded && _lastFetchCenter) {
    const movedKm = haversineKm(_lastFetchCenter.lat, _lastFetchCenter.lng, lat, lng);
    const radiusAlreadyCovered =
      _lastFetchRadiusKm !== null && _lastFetchRadiusKm >= radiusKm;
    if (movedKm < REFETCH_THRESHOLD_KM && radiusAlreadyCovered) return;
  }
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const pubs = await searchPubsNear(lat, lng, radiusKm, signal);
      if (signal?.aborted) return;
      const blockedReports = await fetchBlockedPubReports(lat, lng, radiusKm, signal);
      if (signal?.aborted) return;
      // A place is hidden if it matches a report by either signal:
      //  - external_id: the exact Mapy.cz item id that was reported, or
      //  - cache_key: the geohash-8 cell of the report, which still catches the
      //    same physical place when Mapy.cz returns a different id for it.
      const blockedExternalIds = new Set(
        blockedReports.flatMap((report) => (report.externalId ? [report.externalId] : [])),
      );
      const blockedCacheKeys = new Set(blockedReports.map((report) => report.cacheKey));
      _init(
        pubs.filter(
          (pub) =>
            !blockedExternalIds.has(pub.id) &&
            !blockedCacheKeys.has(geohash8(pub.lat, pub.lng)),
        ),
      );
      _lastFetchCenter = { lat, lng };
      _lastFetchRadiusKm = radiusKm;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function isLoaded(): boolean {
  return _loaded;
}

/** Builds an index predicate excluding pubs by id and/or geohash-8 cell. The
 *  cell match hides a reported place even when a later Mapy.cz fetch returns
 *  it under a fresh provider id (the ids are coordinate-derived and unstable). */
function buildExcludePredicate(
  excludeIds?: string[],
  excludeCacheKeys?: string[],
): ((i: number) => boolean) | undefined {
  const idSet = excludeIds?.length ? new Set(excludeIds) : null;
  const keySet = excludeCacheKeys?.length ? new Set(excludeCacheKeys) : null;
  if (!idSet && !keySet) return undefined;
  return (i: number) =>
    !(idSet?.has(_pubs[i].id) || keySet?.has(_cacheKeys[i]));
}

/**
 * Returns the nearest pub within maxKm kilometers.
 * When maxKm is omitted, there is no distance limit.
 * Returns null if no pub is found within the radius.
 */
export function findNearestPub(opts: {
  lat: number;
  lng: number;
  maxKm?: number;
  excludeIds?: string[];
  excludeCacheKeys?: string[];
}): Pub | null {
  if (!_loaded || !_index || _pubs.length === 0) return null;

  const { lat, lng, maxKm, excludeIds, excludeCacheKeys } = opts;
  const maxDistance = Number.isFinite(maxKm) ? maxKm : undefined;
  const predicate = buildExcludePredicate(excludeIds, excludeCacheKeys);

  const results = geokdbush.around(_index, lng, lat, 1, maxDistance, predicate);
  if (results.length === 0) return null;
  return _pubs[results[0]];
}

/**
 * Returns a random pub within maxKm kilometers.
 * When maxKm is omitted, there is no distance limit.
 * When seed is provided, selection is deterministic for that seed value.
 * Returns null if no pub is found within the radius.
 */
export function findRandomPubInRadius(opts: {
  lat: number;
  lng: number;
  maxKm?: number;
  seed?: number;
  excludeIds?: string[];
  excludeCacheKeys?: string[];
}): Pub | null {
  if (!_loaded || !_index || _pubs.length === 0) return null;

  const { lat, lng, maxKm, seed, excludeIds, excludeCacheKeys } = opts;
  const maxDistance = Number.isFinite(maxKm) ? maxKm : undefined;
  const predicate = buildExcludePredicate(excludeIds, excludeCacheKeys);

  const results = geokdbush.around(_index, lng, lat, Infinity, maxDistance, predicate);
  if (results.length === 0) return null;

  const rng = seed !== undefined ? mulberry32(seed) : () => Math.random();
  const chosen = Math.floor(rng() * results.length);
  return _pubs[results[chosen]];
}

/**
 * Returns a pub by its id string, or null if not found.
 */
export function getPubById(id: string): Pub | null {
  if (!_loaded) return null;
  return _idMap.get(id) ?? null;
}
