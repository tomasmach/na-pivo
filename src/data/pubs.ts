import KDBush from "kdbush";
import * as geokdbush from "geokdbush";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

/**
 * Backend verdict on whether a place is actually a pub, derived from Firmy.cz
 * categories (community beer reports override to 'pub' server-side).
 *
 * - 'pub'     — confidently a pub.
 * - 'maybe'   — possibly a pub (half-restaurant, etc.) — kept.
 * - 'not_pub' — confidently NOT a pub — hidden entirely; the compass never
 *               targets it (see useCompass auto-exclusion).
 * - 'unknown' — no verdict (also the default for older backends) — kept.
 */
export type VenueKind = 'pub' | 'maybe' | 'not_pub' | 'unknown';

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
  /** Public star rating from the enrichment source, on a 0-5 scale. */
  rating?: number | null;
  /** Number of user ratings behind `rating`, when known. */
  ratingCount?: number | null;
  /** Human rating label from the source, e.g. "Velmi dobré". */
  ratingLabel?: string | null;
  /**
   * Backend verdict on whether this place is a pub. Resolved asynchronously with
   * opening hours; 'not_pub' places are auto-excluded from compass targeting.
   * Undefined until hours resolve (or when the backend is dormant) → treated as
   * 'unknown' (shown).
   */
  venueKind?: VenueKind;
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
/** Whether we have already attempted to hydrate from AsyncStorage this session.
 *  The persisted snapshot is only consulted once, on the first fetchPubsNear
 *  call — afterwards the in-memory state is authoritative. */
let _hydrationAttempted = false;

interface FetchPubsNearOptions {
  force?: boolean;
  radiusKm?: number;
}

/** Re-fetch nearby pubs when the user has moved more than this distance from
 *  the previous fetch center (km). */
const REFETCH_THRESHOLD_KM = 2;
const DEFAULT_FETCH_RADIUS_KM = 25;

/** AsyncStorage key for the persisted result snapshot. */
const SNAPSHOT_KEY = "na-pivo-pubs-snapshot";
/** A snapshot older than this is treated as stale and ignored (ms). */
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/** Persisted shape of the last successful fetch — the block-filtered pubs plus
 *  the fetch center/radius gate values, so a cold start can skip the network. */
interface PubsSnapshot {
  pubs: Pub[];
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  savedAt: number;
}

/** Persist the post-block-filtering result set. Degrades silently on any
 *  storage failure (quota, serialization) — caching must never throw. */
async function saveSnapshot(snapshot: PubsSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort cache: a failed write just means the next cold start fetches.
  }
}

/** Clear the persisted nearby-pubs snapshot so the next cold start refetches.
 * Used after a user adds a missing pub; otherwise a stale 24h snapshot could
 * hide the server-side addition on this device. */
export async function clearPubsSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // Best-effort cache invalidation; the in-memory index remains authoritative.
  }
}

/** Read and validate the persisted snapshot. Returns null when absent, corrupt,
 *  expired, or unreadable — never throws. */
async function loadSnapshot(): Promise<PubsSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PubsSnapshot;
    if (
      !Array.isArray(parsed.pubs) ||
      !Number.isFinite(parsed.centerLat) ||
      !Number.isFinite(parsed.centerLng) ||
      !Number.isFinite(parsed.radiusKm) ||
      !Number.isFinite(parsed.savedAt)
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > SNAPSHOT_TTL_MS) return null;
    return parsed;
  } catch {
    // Missing, corrupt JSON, or storage error → behave as if nothing was cached.
    return null;
  }
}

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

/** Insert or replace a pub in the in-memory index. The geohash-8 replacement
 * keeps one visible entry per physical place, matching the backend cache key. */
export function upsertLocalPub(pub: Pub): void {
  const cacheKey = geohash8(pub.lat, pub.lng);
  const next = [
    pub,
    ..._pubs.filter((existing) => {
      if (existing.id === pub.id) return false;
      return geohash8(existing.lat, existing.lng) !== cacheKey;
    }),
  ];
  _init(next);
}

/**
 * Reset the module state to a fresh-launch baseline. Exposed for tests so each
 * case can exercise the one-shot cold-start hydration in isolation; clears the
 * in-memory index, the fetch gate, and the "hydration already attempted" latch.
 */
export function _reset(): void {
  _pubs = [];
  _index = null;
  _idMap = new Map();
  _cacheKeys = [];
  _loaded = false;
  _lastFetchCenter = null;
  _lastFetchRadiusKm = null;
  _inflight = null;
  _hydrationAttempted = false;
}

/**
 * Returns true if a fetch center/radius covers a request at (lat, lng, radiusKm):
 * the request is within REFETCH_THRESHOLD_KM of the center and the cached radius
 * is at least as large. Shared by the in-memory short-circuit and the persisted
 * snapshot hydration gate so both apply the identical move-threshold rule.
 */
function gateCovers(
  centerLat: number,
  centerLng: number,
  cachedRadiusKm: number,
  lat: number,
  lng: number,
  radiusKm: number,
): boolean {
  const movedKm = haversineKm(centerLat, centerLng, lat, lng);
  return movedKm < REFETCH_THRESHOLD_KM && cachedRadiusKm >= radiusKm;
}

/**
 * Fetch pubs near (lat, lng) through the backend/Mapy lookup and rebuild the
 * spatial index.
 * Short-circuits when the user is within REFETCH_THRESHOLD_KM of the last
 * fetch center, so it is safe to call on every GPS update.
 *
 * On the FIRST call of a session it also tries a persisted snapshot before the
 * network: a fresh (within TTL) snapshot whose center/radius covers the request
 * hydrates the index and skips the fetch entirely — killing the cold-start
 * Mapy requests. A force refetch always bypasses both caches.
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

  // In-memory short-circuit (also covers the post-hydration session).
  if (!options.force && _loaded && _lastFetchCenter) {
    if (gateCovers(_lastFetchCenter.lat, _lastFetchCenter.lng, _lastFetchRadiusKm ?? 0, lat, lng, radiusKm)) {
      return;
    }
  }
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      // Cold-start hydration: consult the persisted snapshot exactly once, and
      // only when not force-refetching. A covering, fresh snapshot lets us skip
      // the network entirely.
      if (!options.force && !_hydrationAttempted) {
        _hydrationAttempted = true;
        const snapshot = await loadSnapshot();
        if (signal?.aborted) return;
        if (
          snapshot &&
          gateCovers(snapshot.centerLat, snapshot.centerLng, snapshot.radiusKm, lat, lng, radiusKm)
        ) {
          _init(snapshot.pubs);
          _lastFetchCenter = { lat: snapshot.centerLat, lng: snapshot.centerLng };
          _lastFetchRadiusKm = snapshot.radiusKm;
          return;
        }
      }

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
      const filtered = pubs.filter(
        (pub) =>
          !blockedExternalIds.has(pub.id) &&
          !blockedCacheKeys.has(geohash8(pub.lat, pub.lng)),
      );
      _init(filtered);
      _lastFetchCenter = { lat, lng };
      _lastFetchRadiusKm = radiusKm;
      // Persist the post-block-filtering result so the next cold start can skip
      // the network. Fire-and-forget — saveSnapshot never throws.
      void saveSnapshot({ pubs: filtered, centerLat: lat, centerLng: lng, radiusKm, savedAt: Date.now() });
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
 * Returns the nearest `limit` pubs to (lat, lng), each with its distance in
 * meters, sorted nearest-first. Used by the beer counter to build a "where are
 * you?" picker and to auto-detect the pub the user is sitting in. Respects
 * maxKm when provided; returns [] when nothing is loaded / in range.
 */
export function findNearbyPubs(opts: {
  lat: number;
  lng: number;
  limit: number;
  maxKm?: number;
}): { pub: Pub; distanceMeters: number }[] {
  if (!_loaded || !_index || _pubs.length === 0) return [];

  const { lat, lng, limit, maxKm } = opts;
  const maxDistance = Number.isFinite(maxKm) ? maxKm : undefined;
  const results = geokdbush.around(_index, lng, lat, limit, maxDistance);
  return results.map((i) => ({
    pub: _pubs[i],
    // geokdbush returns results sorted by distance; recompute meters for the UI.
    distanceMeters: haversineKm(lat, lng, _pubs[i].lat, _pubs[i].lng) * 1000,
  }));
}

/**
 * Returns a pub by its id string, or null if not found.
 */
export function getPubById(id: string): Pub | null {
  if (!_loaded) return null;
  return _idMap.get(id) ?? null;
}
