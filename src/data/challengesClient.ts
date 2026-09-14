import { t } from '@/i18n';

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';
import type { FriendProfile } from './friendsClient';

const REQUEST_TIMEOUT_MS = 8000;

export type ChallengeGlyph = 'places' | 'rhythm' | 'taste';

export interface ChallengeFriendProgress {
  account: FriendProfile;
  done: number;
  progress: number;
}

export interface Challenge {
  id: string;
  title: string;
  glyph: ChallengeGlyph;
  progress: number;
  done: number;
  goal: number;
  unit: string;
  blurb: string;
  deadline: string;
  reward: string;
  rules: string[];
  friends: ChallengeFriendProgress[];
}

let cache: { accountId: string; rows: Challenge[] } | null = null;

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseFriendProgress(value: unknown): ChallengeFriendProgress | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!row.account || typeof row.account !== 'object') return null;
  const account = row.account as Record<string, unknown>;
  if (typeof account.id !== 'string' || account.id.length === 0) return null;
  const nickname =
    typeof account.nickname === 'string' && account.nickname.length > 0
      ? account.nickname
      : null;
  const displayName =
    typeof account.display_name === 'string' && account.display_name.length > 0
      ? account.display_name
      : nickname ?? t.common.drinkerFallback;
  return {
    account: {
      id: account.id,
      nickname,
      displayName,
      avatarUrl: typeof account.avatar_url === 'string' ? account.avatar_url : null,
      isPublic: account.is_public !== false,
    },
    done: Math.max(0, Math.floor(number(row.done))),
    progress: Math.max(0, Math.min(1, number(row.progress))),
  };
}

function parseChallenge(value: unknown): Challenge | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null;
  return {
    id: row.id,
    title: row.title,
    glyph: row.glyph === 'rhythm' || row.glyph === 'taste' ? row.glyph : 'places',
    progress: Math.max(0, Math.min(1, number(row.progress))),
    done: Math.max(0, Math.floor(number(row.done))),
    goal: Math.max(1, Math.floor(number(row.goal))),
    unit: typeof row.unit === 'string' ? row.unit : '',
    blurb: typeof row.blurb === 'string' ? row.blurb : '',
    deadline: typeof row.deadline === 'string' ? row.deadline : '',
    reward: typeof row.reward === 'string' ? row.reward : '',
    rules: Array.isArray(row.rules)
      ? row.rules.filter((rule): rule is string => typeof rule === 'string')
      : [],
    friends: Array.isArray(row.friends)
      ? row.friends
          .map(parseFriendProgress)
          .filter((friend): friend is ChallengeFriendProgress => friend !== null)
      : [],
  };
}

function timezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export async function fetchChallenges(options: {
  signal?: AbortSignal;
  force?: boolean;
} = {}): Promise<Challenge[] | null> {
  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) return null;
  if (!options.force && cache?.accountId === session.accountId) return cache.rows;
  const zone = timezone();
  const endpoint = getBackendEndpoint(`/v1/challenges${zone ? `?timezone=${encodeURIComponent(zone)}` : ''}`);
  if (!endpoint) return null;
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
    if (!response.ok) return null;
    const body = (await response.json()) as { challenges?: unknown };
    if (!Array.isArray(body.challenges)) return null;
    const rows = body.challenges
      .map(parseChallenge)
      .filter((row): row is Challenge => row !== null);
    cache = { accountId: session.accountId, rows };
    return rows;
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    if (!options.signal?.aborted && !aborted) {
      trackApiFailure('challenges_fetch', { endpoint: '/v1/challenges', error });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

export async function fetchChallenge(id: string, signal?: AbortSignal): Promise<Challenge | null> {
  const rows = await fetchChallenges({ signal });
  return rows?.find((row) => row.id === id) ?? null;
}

export function clearChallengesCache(): void {
  cache = null;
}
