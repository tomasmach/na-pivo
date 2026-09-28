/**
 * Pub beer board — `GET /v1/pubs/beer-board`: the pubs where the most beers
 * went down in one window (last week · this year · all time), optionally in one
 * city. Only pubs where at least two people drank rank.
 *
 * Boards are cached in memory per (period, city) for the app session, so
 * flipping filters back is instant. They are one aggregate for everyone, so no
 * account boundary clears them.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import type { LeaderboardPeriod } from './leaderboardsClient';
import { trackApiFailure } from './telemetryClient';

const ENDPOINT = '/v1/pubs/beer-board';
const REQUEST_TIMEOUT_MS = 9000;
/** Mirrors the server, which recounts each board at most once an hour. */
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface PubBoardEntry {
  rank: number;
  key: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  beers: number;
}

export interface PubBoard {
  period: LeaderboardPeriod;
  /** First and last day of the window (YYYY-MM-DD); null for all time. */
  periodStart: string | null;
  periodEnd: string | null;
  city: string | null;
  /** Cities with the most beers in the window, for the city picker. */
  cities: { name: string; beers: number }[];
  totalRanked: number;
  entries: PubBoardEntry[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseEntry(raw: unknown): PubBoardEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const { rank, cache_key, name, city, lat, lng, beers } = raw as Record<string, unknown>;
  if (typeof rank !== 'number' || typeof beers !== 'number' || beers <= 0) return null;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!text(cache_key) || !text(name).trim()) return null;
  return { rank, key: text(cache_key), name: text(name), city: text(city), lat, lng, beers };
}

export function parsePubBoard(data: unknown, fallback: LeaderboardPeriod): PubBoard | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.entries)) return null;
  const period =
    raw.period === 'week' || raw.period === 'year' || raw.period === 'all' ? raw.period : fallback;
  return {
    period,
    periodStart: text(raw.period_start) || null,
    periodEnd: text(raw.period_end) || null,
    city: text(raw.city) || null,
    cities: Array.isArray(raw.cities)
      ? raw.cities.flatMap((item) => {
          const { name, beers } = (item ?? {}) as Record<string, unknown>;
          return text(name) && typeof beers === 'number' ? [{ name: text(name), beers }] : [];
        })
      : [],
    totalRanked: typeof raw.total_ranked === 'number' ? raw.total_ranked : 0,
    entries: raw.entries.map(parseEntry).filter((entry): entry is PubBoardEntry => entry !== null),
  };
}

const memoryCache = new Map<string, { at: number; board: PubBoard }>();

export async function fetchPubBoard(
  period: LeaderboardPeriod,
  city: string | null,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<PubBoard | null> {
  const cacheKey = `${period}:${city ?? ''}`;
  if (!options.force) {
    const hit = memoryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.board;
  }

  const query = `period=${period}${city ? `&city=${encodeURIComponent(city)}` : ''}`;
  const endpoint = getBackendEndpoint(`${ENDPOINT}?${query}`);
  if (!endpoint || options.signal?.aborted) return null;
  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) return null;

  const abort = chainAbortSignal(options.signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, { source: 'pub_board_fetch', endpoint: ENDPOINT });
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('pub_board_fetch', { endpoint: ENDPOINT, status: resp.status });
      return null;
    }
    const board = parsePubBoard(await resp.json(), period);
    if (board) memoryCache.set(cacheKey, { at: Date.now(), board });
    return board;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('pub_board_fetch', { endpoint: ENDPOINT, reason: 'exception', error: err });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

/** Test hook. */
export function clearPubBoardCache(): void {
  memoryCache.clear();
}
