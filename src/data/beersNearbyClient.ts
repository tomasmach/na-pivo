/**
 * "Čepují v okolí": beers on the current menus of pubs around the drinker
 * (GET /v1/beers/nearby). Only the rounded point and radius leave the phone.
 * Never throws; a failure reads as an unknown list, never as an empty one.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';

const ENDPOINT = '/v1/beers/nearby';
const TIMEOUT_MS = 8_000;

export interface NearbyBeer {
  name: string;
  priceCzk?: number;
  volumeMl?: number;
  pubName: string;
  pubCacheKey: string;
  distanceMeters: number;
}

export type NearbyBeersResult = { ok: true; beers: NearbyBeer[] } | { ok: false };

export function parseNearbyBeers(data: unknown): NearbyBeer[] | null {
  const rows = (data as { beers?: unknown } | null)?.beers;
  if (!Array.isArray(rows)) return null;
  const beers: NearbyBeer[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim() || typeof r.pub_name !== 'string') continue;
    beers.push({
      name: r.name.trim(),
      ...(typeof r.price_czk === 'number' ? { priceCzk: r.price_czk } : {}),
      ...(typeof r.volume_ml === 'number' ? { volumeMl: r.volume_ml } : {}),
      pubName: r.pub_name,
      pubCacheKey: typeof r.pub_cache_key === 'string' ? r.pub_cache_key : '',
      distanceMeters: typeof r.distance_m === 'number' ? r.distance_m : 0,
    });
  }
  return beers;
}

export async function fetchNearbyBeers(
  params: { lat: number; lng: number; radiusMeters?: number },
  signal?: AbortSignal,
): Promise<NearbyBeersResult> {
  const base = getBackendEndpoint(ENDPOINT);
  if (!base || signal?.aborted) return { ok: false };
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return { ok: false };

  const radius = Math.round(params.radiusMeters ?? 2000);
  const query = `lat=${params.lat.toFixed(3)}&lng=${params.lng.toFixed(3)}&radius=${radius}`;
  const abort = chainAbortSignal(signal, TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}?${query}`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, { source: 'beers_nearby_fetch', endpoint: ENDPOINT });
      return { ok: false };
    }
    if (!resp.ok) return { ok: false };
    const beers = parseNearbyBeers(await resp.json());
    return beers ? { ok: true, beers } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    abort.cleanup();
  }
}
