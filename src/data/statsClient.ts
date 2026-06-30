/**
 * Personal beer-stats read client — GETs the account's durable aggregates from
 * the backend (/v1/me/stats), which mirror the local statsModel rules over the
 * FULL synced drink history. This lets an account holder see lifetime totals,
 * records and per-pub counts that outlive the 50-session local history cap and
 * survive a reinstall.
 *
 * Same best-effort conventions as visitsClient.fetchVisits: a Bearer GET with an
 * 8s timeout that NEVER throws and returns null on ANY failure (dormant backend,
 * no account, network/timeout, non-2xx, malformed body). The "Výkon" screen
 * always renders from local data first and only overlays these when they arrive,
 * so a null here just means "show the local view".
 *
 * Wire format is snake_case; this maps to camelCase. Durations come over the
 * wire in whole SECONDS — the screen converts to ms for its shared formatters.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';

const REQUEST_TIMEOUT_MS = 8000;

/** One pub's lifetime tally as returned by the backend. */
export interface RemotePubTally {
  cacheKey: string;
  name: string;
  beers: number;
  spentCzk: number;
  lastDrankAt: string;
}

/** Personal records from the backend (durations in seconds, null until data). */
export interface RemoteRecords {
  mostBeersInEvening: number;
  mostBeersPubName: string | null;
  mostBeersDate: string | null;
  fastestBeerSeconds: number | null;
  longestEveningSeconds: number | null;
}

/** The account's durable beer stats. */
export interface RemoteStats {
  totalBeers: number;
  totalEvenings: number;
  distinctPubs: number;
  totalSpentCzk: number;
  firstDrinkAt: string | null;
  topPubs: RemotePubTally[];
  records: RemoteRecords;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parsePub(raw: unknown): RemotePubTally | null {
  const p = raw as Record<string, unknown>;
  if (!p || typeof p.cache_key !== 'string') return null;
  return {
    cacheKey: p.cache_key,
    name: str(p.name),
    beers: num(p.beers),
    spentCzk: num(p.spent_czk),
    lastDrankAt: str(p.last_drank_at),
  };
}

function parseStats(body: unknown): RemoteStats | null {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== 'object') return null;
  const records = (b.records ?? {}) as Record<string, unknown>;
  const topPubs = Array.isArray(b.top_pubs)
    ? b.top_pubs.map(parsePub).filter((p): p is RemotePubTally => p != null)
    : [];

  return {
    totalBeers: num(b.total_beers),
    totalEvenings: num(b.total_evenings),
    distinctPubs: num(b.distinct_pubs),
    totalSpentCzk: num(b.total_spent_czk),
    firstDrinkAt: nullableStr(b.first_drink_at),
    topPubs,
    records: {
      mostBeersInEvening: num(records.most_beers_in_evening),
      mostBeersPubName: nullableStr(records.most_beers_pub_name),
      mostBeersDate: nullableStr(records.most_beers_date),
      fastestBeerSeconds: nullableNum(records.fastest_beer_seconds),
      longestEveningSeconds: nullableNum(records.longest_evening_seconds),
    },
  };
}

/**
 * GET the account's durable beer stats, or null on any failure. Never throws.
 */
export async function fetchMyStats(signal?: AbortSignal): Promise<RemoteStats | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/me/stats');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session);
      return null;
    }
    if (!resp.ok) return null;

    return parseStats(await resp.json());
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}
