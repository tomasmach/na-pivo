/**
 * "Hlídat pivo" client: the account's watched beers, the watch radius, the
 * rounded watch location and how many people the user's lístek edits helped.
 *
 * Online-only on purpose: a watch is a wish, not a record of the evening, so
 * nothing is queued. Every call is a best-effort Bearer request with an 8 s
 * timeout that never throws; callers get null/false or a failure reason.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';

export interface BeerWatch {
  productKey: string;
  name: string;
  aliases: string[];
}

export interface BeerHelped {
  cacheKey: string;
  productName: string;
  helpedCount: number;
}

export interface BeerWatchSnapshot {
  radiusM: number;
  locationSet: boolean;
  /** null when the response omitted the list (a settings PATCH may). */
  watches: BeerWatch[] | null;
  helped: BeerHelped[] | null;
}

export type AddBeerWatchResult =
  | { ok: true; watch: BeerWatch }
  | { ok: false; reason: 'unknown_beer' | 'too_many' | 'failed' };

export const BEER_WATCH_RADII = [1000, 3000, 5000, 10000] as const;

const ENDPOINT = '/v1/beer-watches';
const REQUEST_TIMEOUT_MS = 8000;

async function request(
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown } | null> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint) return null;
  const session = await ensureAccount();
  if (!session) return null;

  const abort = chainAbortSignal(undefined, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${session.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, { source: 'beer_watches', endpoint: ENDPOINT });
      return null;
    }
    let data: unknown = null;
    if (resp.status !== 204) {
      try {
        data = await resp.json();
      } catch {
        data = null;
      }
    }
    return { status: resp.status, data };
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}

function toWatch(value: unknown): BeerWatch | null {
  const w = value as { product_key?: unknown; name?: unknown; aliases?: unknown } | null;
  if (!w || typeof w.product_key !== 'string' || typeof w.name !== 'string') return null;
  const aliases = Array.isArray(w.aliases)
    ? w.aliases.filter((a): a is string => typeof a === 'string')
    : [];
  return { productKey: w.product_key, name: w.name, aliases };
}

function toHelped(value: unknown): BeerHelped | null {
  const h = value as { cache_key?: unknown; product_name?: unknown; helped_count?: unknown } | null;
  if (
    !h ||
    typeof h.cache_key !== 'string' ||
    typeof h.product_name !== 'string' ||
    typeof h.helped_count !== 'number'
  ) {
    return null;
  }
  return { cacheKey: h.cache_key, productName: h.product_name, helpedCount: h.helped_count };
}

function toSnapshot(value: unknown): BeerWatchSnapshot | null {
  const d = value as {
    radius_m?: unknown;
    location_set?: unknown;
    watches?: unknown;
    helped?: unknown;
  } | null;
  if (!d || typeof d.radius_m !== 'number') return null;
  return {
    radiusM: d.radius_m,
    locationSet: d.location_set === true,
    watches: Array.isArray(d.watches)
      ? d.watches.map(toWatch).filter((w): w is BeerWatch => w !== null)
      : null,
    helped: Array.isArray(d.helped)
      ? d.helped.map(toHelped).filter((h): h is BeerHelped => h !== null)
      : null,
  };
}

/** GET the account's watches, radius and helped counts, or null on any failure. */
export async function fetchBeerWatches(): Promise<BeerWatchSnapshot | null> {
  const result = await request('GET', ENDPOINT);
  if (!result || result.status !== 200) return null;
  const snapshot = toSnapshot(result.data);
  return snapshot && snapshot.watches ? snapshot : null;
}

/** Watch a beer by its lístek name; the server resolves the catalog product. */
export async function addBeerWatch(
  beerName: string,
  breweryName?: string | null,
): Promise<AddBeerWatchResult> {
  const body: { beer_name: string; brewery_name?: string } = { beer_name: beerName };
  if (breweryName) body.brewery_name = breweryName;
  const result = await request('POST', ENDPOINT, body);
  if (!result) return { ok: false, reason: 'failed' };
  if (result.status === 200 || result.status === 201) {
    const watch = toWatch(result.data);
    return watch ? { ok: true, watch } : { ok: false, reason: 'failed' };
  }
  if (result.status === 422) {
    const code = (result.data as { code?: unknown } | null)?.code;
    if (code === 'unknown_beer' || code === 'too_many') return { ok: false, reason: code };
  }
  return { ok: false, reason: 'failed' };
}

/** Stop watching. Not watched any more counts as success. */
export async function removeBeerWatch(productKey: string): Promise<boolean> {
  const result = await request('DELETE', `${ENDPOINT}/${encodeURIComponent(productKey)}`);
  return result?.status === 204 || result?.status === 200;
}

/** Change the radius and/or send the grid-snapped watch location. */
export async function updateBeerWatchSettings(settings: {
  radiusM?: number;
  lat?: number;
  lng?: number;
}): Promise<BeerWatchSnapshot | null> {
  const body: { radius_m?: number; lat?: number; lng?: number } = {};
  if (settings.radiusM !== undefined) body.radius_m = settings.radiusM;
  if (settings.lat !== undefined && settings.lng !== undefined) {
    body.lat = settings.lat;
    body.lng = settings.lng;
  }
  const result = await request('PATCH', `${ENDPOINT}/settings`, body);
  if (!result || result.status !== 200) return null;
  return toSnapshot(result.data);
}
