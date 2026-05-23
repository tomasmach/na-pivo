import KDBush from "kdbush";
import * as geokdbush from "geokdbush";

export type Pub = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  city?: string;
};

interface PubsJson {
  version: string;
  generated: string;
  count: number;
  pubs: Pub[];
}

let _pubs: Pub[] = [];
let _index: KDBush | null = null;
let _idMap: Map<string, Pub> = new Map();
let _loaded = false;

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

/**
 * Builds a KDBush index from the given pubs array.
 * Exposed so tests can inject synthetic data without loading the real JSON.
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
 * Loads and indexes the bundled pubs dataset.
 * Must be called before any find* functions.
 * Safe to call multiple times (no-op after first successful load).
 */
export async function loadPubs(): Promise<void> {
  if (_loaded) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const json: PubsJson = require("../../assets/data/pubs.json");
  _init(json.pubs);
}

export function isLoaded(): boolean {
  return _loaded;
}

function assertLoaded(): void {
  if (!_loaded) {
    throw new Error(
      "Pub data not loaded. Await loadPubs() before calling find* functions."
    );
  }
}

/**
 * Returns the nearest pub within maxKm kilometers (default 100 km).
 * Returns null if no pub is found within the radius.
 */
export function findNearestPub(opts: {
  lat: number;
  lng: number;
  maxKm?: number;
  excludeIds?: string[];
}): Pub | null {
  assertLoaded();
  if (!_index || _pubs.length === 0) return null;

  const { lat, lng, maxKm = 100, excludeIds } = opts;
  const excludeSet = excludeIds ? new Set(excludeIds) : null;

  const predicate = excludeSet
    ? (i: number) => !excludeSet.has(_pubs[i].id)
    : undefined;

  const results = geokdbush.around(_index, lng, lat, 1, maxKm, predicate);
  if (results.length === 0) return null;
  return _pubs[results[0]];
}

/**
 * Returns a random pub within maxKm kilometers.
 * When seed is provided, selection is deterministic for that seed value.
 * Returns null if no pub is found within the radius.
 */
export function findRandomPubInRadius(opts: {
  lat: number;
  lng: number;
  maxKm: number;
  seed?: number;
  excludeIds?: string[];
}): Pub | null {
  assertLoaded();
  if (!_index || _pubs.length === 0) return null;

  const { lat, lng, maxKm, seed, excludeIds } = opts;
  const excludeSet = excludeIds ? new Set(excludeIds) : null;

  const predicate = excludeSet
    ? (i: number) => !excludeSet.has(_pubs[i].id)
    : undefined;

  // Retrieve all pubs within radius (up to a reasonable upper bound)
  const results = geokdbush.around(_index, lng, lat, Infinity, maxKm, predicate);
  if (results.length === 0) return null;

  const rng =
    seed !== undefined ? mulberry32(seed) : () => Math.random();
  const chosen = Math.floor(rng() * results.length);
  return _pubs[results[chosen]];
}

/**
 * Returns a pub by its id string (e.g. "osm:12345"), or null if not found.
 */
export function getPubById(id: string): Pub | null {
  assertLoaded();
  return _idMap.get(id) ?? null;
}
