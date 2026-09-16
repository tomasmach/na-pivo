/**
 * Global leaderboards client — `GET /v1/leaderboards` (spec: leaderboards §1).
 *
 * Three boards (beers logged · distinct pubs · Mapér XP) over three windows
 * (week · year · all-time; Mapér is all-time only). Only public profiles are
 * listed by the server; the caller's own standing arrives separately in `me`
 * so a private user still sees their rank (and the "ukaž se" nudge).
 *
 * Responses are cached in-memory per (category, period) for the app session so
 * tab-flipping between boards is instant; a hard refresh bypasses the cache.
 * Nothing is persisted to disk — rankings are ephemeral community data and
 * would go stale (and leak across account boundaries) in a snapshot.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;
/** In-memory response TTL — mirrors the server-side cache window. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export type LeaderboardCategory = 'beers' | 'pubs' | 'mapper';
export type LeaderboardPeriod = 'week' | 'year' | 'all';

export interface BoardProfile {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface BoardEntry {
  rank: number;
  score: number;
  isMe: boolean;
  isFriend: boolean;
  account: BoardProfile;
}

/** My own standing — present even when I'm private or outside the top slice. */
export interface BoardMe {
  /** Null when my score is 0 (nothing to rank). */
  rank: number | null;
  score: number;
  /** True iff my row is inside `entries`. */
  listed: boolean;
  /** False → private profile / missing nickname; drives the visibility nudge. */
  eligible: boolean;
}

export interface Leaderboard {
  category: LeaderboardCategory;
  period: LeaderboardPeriod;
  periodStart: string | null;
  totalRanked: number;
  entries: BoardEntry[];
  me: BoardMe;
}

interface RawBoardAccount {
  id?: string;
  nickname?: string | null;
  display_name?: string;
  avatar_url?: string | null;
}

interface RawBoardEntry {
  rank?: number;
  score?: number;
  is_me?: boolean;
  is_friend?: boolean;
  account?: RawBoardAccount;
}

interface RawLeaderboard {
  category?: string;
  period?: string;
  period_start?: string | null;
  total_ranked?: number;
  entries?: RawBoardEntry[];
  me?: { rank?: number | null; score?: number; listed?: boolean; eligible?: boolean };
}

function parseEntry(raw: RawBoardEntry): BoardEntry {
  return {
    rank: typeof raw.rank === 'number' ? raw.rank : 0,
    score: typeof raw.score === 'number' ? raw.score : 0,
    isMe: raw.is_me === true,
    isFriend: raw.is_friend === true,
    account: {
      id: raw.account?.id ?? '',
      nickname:
        typeof raw.account?.nickname === 'string' && raw.account.nickname.length > 0
          ? raw.account.nickname
          : null,
      displayName: raw.account?.display_name ?? '',
      avatarUrl: raw.account?.avatar_url ?? null,
    },
  };
}

export function parseLeaderboard(
  raw: RawLeaderboard,
  fallbackCategory: LeaderboardCategory,
  fallbackPeriod: LeaderboardPeriod,
): Leaderboard {
  const category =
    raw.category === 'beers' || raw.category === 'pubs' || raw.category === 'mapper'
      ? raw.category
      : fallbackCategory;
  // The server coerces unsupported combos (mapper × week) to 'all' — trust its echo.
  const period =
    raw.period === 'week' || raw.period === 'year' || raw.period === 'all'
      ? raw.period
      : fallbackPeriod;
  return {
    category,
    period,
    periodStart: typeof raw.period_start === 'string' ? raw.period_start : null,
    totalRanked: typeof raw.total_ranked === 'number' ? raw.total_ranked : 0,
    entries: Array.isArray(raw.entries) ? raw.entries.map(parseEntry).filter((e) => e.account.id) : [],
    me: {
      rank: typeof raw.me?.rank === 'number' ? raw.me.rank : null,
      score: typeof raw.me?.score === 'number' ? raw.me.score : 0,
      listed: raw.me?.listed === true,
      eligible: raw.me?.eligible !== false,
    },
  };
}

const memoryCache = new Map<string, { at: number; board: Leaderboard }>();

/** Drop all cached boards — call on logout/account switch. */
export function clearLeaderboardsCache(): void {
  memoryCache.clear();
}

export async function fetchLeaderboard(
  category: LeaderboardCategory,
  period: LeaderboardPeriod,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<Leaderboard | null> {
  // Mapér has a single all-time window; normalise before hitting cache/server.
  const effectivePeriod: LeaderboardPeriod = category === 'mapper' ? 'all' : period;
  const cacheKey = `${category}:${effectivePeriod}`;

  if (!options.force) {
    const hit = memoryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.board;
  }

  const endpoint = getBackendEndpoint(
    `/v1/leaderboards?category=${category}&period=${effectivePeriod}`,
  );
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
      await clearCachedAnonymousAccount(session, {
        source: 'leaderboards_fetch',
        endpoint: '/v1/leaderboards',
      });
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('leaderboards_fetch', { endpoint: '/v1/leaderboards', status: resp.status });
      return null;
    }
    const data = (await resp.json()) as RawLeaderboard;
    const board = parseLeaderboard(data, category, effectivePeriod);
    memoryCache.set(cacheKey, { at: Date.now(), board });
    return board;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('leaderboards_fetch', {
        endpoint: '/v1/leaderboards',
        reason: 'exception',
        error: err,
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}
