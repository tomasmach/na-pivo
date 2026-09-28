import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

export interface TopPub {
  key: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  beers: number;
}

/** Beers per pub cell (geohash-8) during last Monday–Sunday week, and the pubs on top. */
export interface PubBeersLastWeek {
  byKey: ReadonlyMap<string, number>;
  top: readonly TopPub[];
}

const ENDPOINT = '/v1/pubs/beers-last-week';
const REQUEST_TIMEOUT_MS = 8000;
// Ghost mode changes reach the server within an hour; this bounds the rest.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
// The same counts outlive an app restart, still only for CACHE_TTL_MS. They
// are one aggregate shared by every account, so no account boundary clears it.
export const PUB_BEERS_STORAGE_KEY = 'na-pivo-pub-beers-last-week';

let cached: { expiresAt: number; beers: PubBeersLastWeek } | null = null;
let deviceCopy: Promise<void> | null = null;

/** Seeds the memory cache from the copy kept on the device, once per app run. */
function loadDeviceCopy(): Promise<void> {
  deviceCopy ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(PUB_BEERS_STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as { expiresAt?: unknown } | null) : null;
      const beers = parsePubBeers(stored);
      if (!beers || typeof stored?.expiresAt !== 'number') return;
      // A clock that ran ahead when the copy was saved must not keep it for days.
      cached ??= { expiresAt: Math.min(stored.expiresAt, Date.now() + CACHE_TTL_MS), beers };
    } catch {
      // A convenience copy; when it cannot be read the counts come from the network.
    }
  })();
  return deviceCopy;
}

/** When the server starts answering with the next week. */
export function nextWeekStartsAt(data: unknown): number | null {
  const value = (data as { next_week_starts_at?: unknown } | null)?.next_week_starts_at;
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseTopPub(raw: unknown): TopPub | null {
  if (!raw || typeof raw !== 'object') return null;
  const { cache_key, name, city, lat, lng, beers } = raw as Record<string, unknown>;
  if (typeof cache_key !== 'string' || typeof name !== 'string' || !name.trim()) return null;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isCount(beers)) return null;
  return { key: cache_key, name, city: typeof city === 'string' ? city : '', lat, lng, beers };
}

export function parsePubBeers(data: unknown): PubBeersLastWeek | null {
  if (!data || typeof data !== 'object') return null;
  const { pubs, top } = data as { pubs?: unknown; top?: unknown };
  if (!pubs || typeof pubs !== 'object' || Array.isArray(pubs)) return null;
  const byKey = new Map<string, number>();
  for (const [key, count] of Object.entries(pubs)) {
    if (isCount(count)) byKey.set(key, count);
  }
  const topPubs = Array.isArray(top)
    ? top.map(parseTopPub).filter((pub): pub is TopPub => pub !== null)
    : [];
  return { byKey, top: topPubs };
}

/** Last week's beers per pub, or null when they cannot be loaded. */
export async function fetchPubBeersLastWeek(
  signal?: AbortSignal,
): Promise<PubBeersLastWeek | null> {
  await loadDeviceCopy();
  if (cached && Date.now() < cached.expiresAt) return cached.beers;

  const endpoint = getBackendEndpoint(ENDPOINT);
  if (!endpoint || signal?.aborted) return null;
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'pub_beers_fetch',
        endpoint: ENDPOINT,
      });
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('pub_beers_fetch', { endpoint: ENDPOINT, status: resp.status });
      return null;
    }
    const data: unknown = await resp.json();
    const beers = parsePubBeers(data);
    if (beers) {
      const rollover = nextWeekStartsAt(data);
      const now = Date.now();
      cached = {
        expiresAt: Math.min(now + CACHE_TTL_MS, rollover ?? now + CACHE_TTL_MS),
        beers,
      };
      const stored = {
        expiresAt: cached.expiresAt,
        pubs: Object.fromEntries(beers.byKey),
        top: (data as { top?: unknown }).top,
      };
      void AsyncStorage.setItem(PUB_BEERS_STORAGE_KEY, JSON.stringify(stored)).catch(
        () => undefined,
      );
    }
    return beers;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbort) {
      trackApiFailure('pub_beers_fetch', {
        endpoint: ENDPOINT,
        reason: 'exception',
        error: err,
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

/** Test hook. */
export function resetPubBeersCache(): void {
  cached = null;
  deviceCopy = null;
}
