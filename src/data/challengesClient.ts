import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type ChallengeGlyph = 'places' | 'rhythm' | 'taste';
export type ChallengeMetricRule = 'beer_count' | 'distinct_pubs' | 'photo_count';

export interface ChallengeProfile {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface ChallengeRival {
  account: ChallengeProfile;
  progress: number;
}

export interface Challenge {
  id: string;
  slug: string;
  title: string;
  glyph: ChallengeGlyph;
  metricRule: ChallengeMetricRule;
  target: number;
  unit: string;
  blurb: string;
  reward: string;
  rules: string[];
  windowStart: string;
  windowEnd: string;
  current: number;
  ratio: number;
  rivals: ChallengeRival[];
}

interface RawChallengeProfile {
  id?: unknown;
  nickname?: unknown;
  display_name?: unknown;
  avatar_url?: unknown;
}

interface RawChallenge {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  glyph_key?: unknown;
  metric_rule?: unknown;
  target?: unknown;
  unit?: unknown;
  blurb?: unknown;
  reward?: unknown;
  rules?: unknown;
  window_start?: unknown;
  window_end?: unknown;
  progress?: { current?: unknown; target?: unknown; ratio?: unknown };
  rivals?: { account?: RawChallengeProfile; progress?: unknown }[];
}

function parseProfile(raw: RawChallengeProfile | undefined): ChallengeProfile {
  return {
    id: typeof raw?.id === 'string' ? raw.id : '',
    nickname: typeof raw?.nickname === 'string' && raw.nickname ? raw.nickname : null,
    displayName: typeof raw?.display_name === 'string' ? raw.display_name : '',
    avatarUrl: typeof raw?.avatar_url === 'string' && raw.avatar_url ? raw.avatar_url : null,
  };
}

function parseChallenge(value: unknown): Challenge | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as RawChallenge;
  const id = typeof raw.id === 'string' ? raw.id : typeof raw.slug === 'string' ? raw.slug : '';
  if (!id || typeof raw.title !== 'string') return null;
  const target =
    typeof raw.target === 'number' && Number.isFinite(raw.target) && raw.target > 0
      ? Math.floor(raw.target)
      : 1;
  const current =
    typeof raw.progress?.current === 'number' && Number.isFinite(raw.progress.current)
      ? Math.max(0, Math.floor(raw.progress.current))
      : 0;
  const glyph: ChallengeGlyph =
    raw.glyph_key === 'rhythm' || raw.glyph_key === 'taste' ? raw.glyph_key : 'places';
  const metricRule: ChallengeMetricRule =
    raw.metric_rule === 'beer_count' || raw.metric_rule === 'photo_count'
      ? raw.metric_rule
      : 'distinct_pubs';

  return {
    id,
    slug: typeof raw.slug === 'string' ? raw.slug : id,
    title: raw.title,
    glyph,
    metricRule,
    target,
    unit: typeof raw.unit === 'string' ? raw.unit : '',
    blurb: typeof raw.blurb === 'string' ? raw.blurb : '',
    reward: typeof raw.reward === 'string' ? raw.reward : '',
    rules: Array.isArray(raw.rules)
      ? raw.rules.filter((rule): rule is string => typeof rule === 'string' && Boolean(rule))
      : [],
    windowStart: typeof raw.window_start === 'string' ? raw.window_start : '',
    windowEnd: typeof raw.window_end === 'string' ? raw.window_end : '',
    current,
    ratio: Math.min(1, current / target),
    rivals: Array.isArray(raw.rivals)
      ? raw.rivals
          .map((rival) => ({
            account: parseProfile(rival.account),
            progress:
              typeof rival.progress === 'number' && Number.isFinite(rival.progress)
                ? Math.max(0, Math.floor(rival.progress))
                : 0,
          }))
          .filter((rival) => Boolean(rival.account.id))
      : [],
  };
}

let memoryCache: { accountId: string; at: number; challenges: Challenge[] } | null = null;

export function clearChallengesCache(): void {
  memoryCache = null;
}

export async function fetchChallenges(
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<Challenge[] | null> {
  const endpoint = getBackendEndpoint('/v1/challenges');
  if (!endpoint || options.signal?.aborted) return null;
  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) return null;

  if (
    !options.force &&
    memoryCache?.accountId === session.accountId &&
    Date.now() - memoryCache.at < CACHE_TTL_MS
  ) {
    return memoryCache.challenges;
  }

  const abort = chainAbortSignal(options.signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (response.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'challenges_fetch',
        endpoint: '/v1/challenges',
      });
      return null;
    }
    if (!response.ok) {
      trackApiFailure('challenges_fetch', { endpoint: '/v1/challenges', status: response.status });
      return null;
    }
    const data = (await response.json()) as { challenges?: unknown[] };
    const challenges = Array.isArray(data.challenges)
      ? data.challenges
          .map(parseChallenge)
          .filter((challenge): challenge is Challenge => challenge != null)
      : [];
    memoryCache = { accountId: session.accountId, at: Date.now(), challenges };
    return challenges;
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('challenges_fetch', {
        endpoint: '/v1/challenges',
        reason: 'exception',
        error,
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

export async function fetchChallenge(
  id: string,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<Challenge | null> {
  const challenges = await fetchChallenges(options);
  return challenges?.find((challenge) => challenge.id === id) ?? null;
}
