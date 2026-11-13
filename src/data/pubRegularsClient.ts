/**
 * Pub regulars — `GET /v1/pubs/regulars`: who drank the most beers in one pub.
 *
 * Only people who turned on the listing in their public profile appear, and
 * today's beers never count. `me` is the caller's own standing, so the answer
 * belongs to one account and the cache is cleared at every account boundary.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

const ENDPOINT = '/v1/pubs/regulars';
const REQUEST_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type RegularsPeriod = '30d' | 'year' | 'all';

export interface PubRegular {
  rank: number;
  beers: number;
  isMe: boolean;
  isFriend: boolean;
  account: { id: string; nickname: string; displayName: string; avatarUrl: string | null };
}

export interface PubRegulars {
  period: RegularsPeriod;
  entries: PubRegular[];
  totalRanked: number;
  me: { beers: number; rank: number | null; listed: boolean; optedIn: boolean; eligible: boolean; ghost: boolean };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseEntry(raw: unknown): PubRegular | null {
  if (!raw || typeof raw !== 'object') return null;
  const { rank, beers, is_me, is_friend, account } = raw as Record<string, unknown>;
  const a = (account ?? {}) as Record<string, unknown>;
  if (typeof rank !== 'number' || typeof beers !== 'number' || !text(a.id) || !text(a.nickname)) return null;
  return {
    rank,
    beers,
    isMe: is_me === true,
    isFriend: is_friend === true,
    account: { id: text(a.id), nickname: text(a.nickname), displayName: text(a.display_name), avatarUrl: text(a.avatar_url) || null },
  };
}

export function parsePubRegulars(data: unknown, fallback: RegularsPeriod): PubRegulars | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.entries)) return null;
  const me = (raw.me ?? {}) as Record<string, unknown>;
  return {
    period: raw.period === '30d' || raw.period === 'year' || raw.period === 'all' ? raw.period : fallback,
    entries: raw.entries.map(parseEntry).filter((entry): entry is PubRegular => entry !== null),
    totalRanked: typeof raw.total_ranked === 'number' ? raw.total_ranked : 0,
    me: {
      beers: typeof me.beers === 'number' ? me.beers : 0,
      rank: typeof me.rank === 'number' ? me.rank : null,
      listed: me.listed === true,
      optedIn: me.opted_in === true,
      eligible: me.eligible === true,
      ghost: me.ghost === true,
    },
  };
}

const memoryCache = new Map<string, { at: number; regulars: PubRegulars }>();

export function clearPubRegularsCache(): void {
  memoryCache.clear();
}

export async function fetchPubRegulars(
  pubKey: string,
  period: RegularsPeriod,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<PubRegulars | null> {
  const cacheKey = `${pubKey}:${period}`;
  if (!options.force) {
    const hit = memoryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.regulars;
  }

  const endpoint = getBackendEndpoint(`${ENDPOINT}?cache_key=${encodeURIComponent(pubKey)}&period=${period}`);
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
      await clearCachedAnonymousAccount(session, { source: 'pub_regulars_fetch', endpoint: ENDPOINT });
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('pub_regulars_fetch', { endpoint: ENDPOINT, status: resp.status });
      return null;
    }
    const regulars = parsePubRegulars(await resp.json(), period);
    if (regulars) memoryCache.set(cacheKey, { at: Date.now(), regulars });
    return regulars;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('pub_regulars_fetch', { endpoint: ENDPOINT, reason: 'exception', error: err });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}
