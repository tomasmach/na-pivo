import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

/** Distinct people per pub cell (geohash-8) during last Monday–Sunday week. */
export type PubVisitorsByKey = ReadonlyMap<string, number>;

const ENDPOINT = '/v1/pubs/visitors-last-week';
const REQUEST_TIMEOUT_MS = 8000;
// Ghost mode changes reach the server within an hour; this bounds the rest.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
// The same counts outlive an app restart, still only for CACHE_TTL_MS. They
// are one aggregate shared by every account, so no account boundary clears it.
export const PUB_VISITORS_STORAGE_KEY = 'na-pivo-pub-visitors-last-week';

let cached: { expiresAt: number; visitors: PubVisitorsByKey } | null = null;
let deviceCopy: Promise<void> | null = null;

/** Seeds the memory cache from the copy kept on the device, once per app run. */
function loadDeviceCopy(): Promise<void> {
  deviceCopy ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(PUB_VISITORS_STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as { expiresAt?: unknown } | null) : null;
      const visitors = parsePubVisitors(stored);
      if (!visitors || typeof stored?.expiresAt !== 'number') return;
      // A clock that ran ahead when the copy was saved must not keep it for days.
      cached ??= { expiresAt: Math.min(stored.expiresAt, Date.now() + CACHE_TTL_MS), visitors };
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

export function parsePubVisitors(data: unknown): PubVisitorsByKey | null {
  if (!data || typeof data !== 'object') return null;
  const pubs = (data as { pubs?: unknown }).pubs;
  if (!pubs || typeof pubs !== 'object' || Array.isArray(pubs)) return null;
  const visitors = new Map<string, number>();
  for (const [key, count] of Object.entries(pubs)) {
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) {
      visitors.set(key, count);
    }
  }
  return visitors;
}

/** Last week's pub visitor counts, or null when they cannot be loaded. */
export async function fetchPubVisitorsLastWeek(
  signal?: AbortSignal,
): Promise<PubVisitorsByKey | null> {
  await loadDeviceCopy();
  if (cached && Date.now() < cached.expiresAt) return cached.visitors;

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
        source: 'pub_visitors_fetch',
        endpoint: ENDPOINT,
      });
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('pub_visitors_fetch', { endpoint: ENDPOINT, status: resp.status });
      return null;
    }
    const data: unknown = await resp.json();
    const visitors = parsePubVisitors(data);
    if (visitors) {
      const rollover = nextWeekStartsAt(data);
      const now = Date.now();
      cached = {
        expiresAt: Math.min(now + CACHE_TTL_MS, rollover ?? now + CACHE_TTL_MS),
        visitors,
      };
      const stored = { expiresAt: cached.expiresAt, pubs: Object.fromEntries(visitors) };
      void AsyncStorage.setItem(PUB_VISITORS_STORAGE_KEY, JSON.stringify(stored)).catch(
        () => undefined,
      );
    }
    return visitors;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbort) {
      trackApiFailure('pub_visitors_fetch', {
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
export function resetPubVisitorsCache(): void {
  cached = null;
  deviceCopy = null;
}
