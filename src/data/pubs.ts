import KDBush from "kdbush";
import * as geokdbush from "geokdbush";
import { searchPubsNear } from "./mapyClient";

export type Pub = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  city?: string;
};

let _pubs: Pub[] = [];
let _index: KDBush | null = null;
let _idMap: Map<string, Pub> = new Map();
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
      _init(pubs);
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
}): Pub | null {
  if (!_loaded || !_index || _pubs.length === 0) return null;

  const { lat, lng, maxKm, excludeIds } = opts;
  const maxDistance = Number.isFinite(maxKm) ? maxKm : undefined;
  const excludeSet = excludeIds ? new Set(excludeIds) : null;

  const predicate = excludeSet
    ? (i: number) => !excludeSet.has(_pubs[i].id)
    : undefined;

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
}): Pub | null {
  if (!_loaded || !_index || _pubs.length === 0) return null;

  const { lat, lng, maxKm, seed, excludeIds } = opts;
  const maxDistance = Number.isFinite(maxKm) ? maxKm : undefined;
  const excludeSet = excludeIds ? new Set(excludeIds) : null;

  const predicate = excludeSet
    ? (i: number) => !excludeSet.has(_pubs[i].id)
    : undefined;

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
