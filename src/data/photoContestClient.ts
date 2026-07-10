/**
 * "FotoPivař" photo contest client — the biweekly best-beer-photo round.
 *
 * Every 14 days one contest round runs server-side: each account may enter ONE
 * diary photo, vote for ONE other entry (upsert/move), and at period end the
 * top 3 get XP and the winner the "FotoPivař" badge (surfaced additively via
 * GET /v1/account/me achievements.foto_pivar).
 *
 * Entering and voting are ONLINE-ONLY — no offline queue. A vote against a
 * finished round or a moved entry cannot be meaningfully replayed later, so
 * every mutation returns an explicit {ok:false, code, detail} on failure and
 * the UI reverts its optimistic state (same hard-reject contract as the
 * CheersPill reactions in friendsClient/beerCheckinsClient).
 *
 * Known 400 codes: 'nickname_required' (entering needs a public handle),
 * 'cannot_vote_own' (no self-votes).
 */

import { ensureAccount, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { resolveBeerPhotoUrl } from './beerPhotosClient';
import type { FriendActionError, FriendActionResult, FriendProfile } from './friendsClient';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;

/** One contest round. `status` is server-owned ('open', 'closed', …). */
export interface PhotoContest {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

/** One photo entered into the current round. */
export interface PhotoContestEntry {
  id: string;
  /**
   * The underlying diary photo's id when the backend surfaces it (additive
   * `photo_id`); null on older backends. Used to pin content reports to the
   * exact photo.
   */
  photoId: string | null;
  account: FriendProfile;
  imageUrl: string;
  caption: string;
  pubName: string;
  pubCity: string;
  votes: number;
  /** True when MY vote currently sits on this entry. */
  myVote: boolean;
  isMine: boolean;
  createdAt: string;
}

/** One podium row of a finished round. */
export interface PhotoContestWinner {
  rank: number;
  account: FriendProfile;
  imageUrl: string;
  caption: string;
  votes: number;
}

/** The finished previous round, when the backend still surfaces it. */
export interface PhotoContestResults {
  contest: PhotoContest;
  winners: PhotoContestWinner[];
}

/**
 * Everything GET /v1/photo-contest returns, camelCased. The wire also carries
 * `my_entry_photo_id`, which the app derives from the diary store instead —
 * deliberately not parsed until something needs it.
 */
export interface PhotoContestSnapshot {
  contest: PhotoContest | null;
  entries: PhotoContestEntry[];
  myEntryId: string | null;
  myVoteEntryId: string | null;
  lastResults: PhotoContestResults | null;
}

interface RawContestProfile {
  public_id?: string;
  id?: string;
  nickname?: string | null;
  display_name?: string;
  avatar_url?: string | null;
  is_public?: boolean;
}

interface RawContest {
  id?: string;
  period_start?: string;
  period_end?: string;
  status?: string;
}

interface RawEntry {
  id?: string;
  photo_id?: string;
  account?: RawContestProfile;
  image_url?: string | null;
  caption?: string;
  pub_name?: string;
  pub_city?: string;
  votes?: number;
  my_vote?: boolean;
  is_mine?: boolean;
  created_at?: string;
}

interface RawWinner {
  rank?: number;
  account?: RawContestProfile;
  image_url?: string | null;
  caption?: string;
  votes?: number;
}

function parseProfile(raw?: RawContestProfile): FriendProfile {
  return {
    // The contest wire uses `public_id`; `id` is a defensive alias.
    id: raw?.public_id ?? raw?.id ?? '',
    nickname: typeof raw?.nickname === 'string' ? raw.nickname : null,
    displayName: raw?.display_name ?? raw?.nickname ?? 'Pivař',
    avatarUrl: raw?.avatar_url ?? null,
    isPublic: raw?.is_public !== false,
  };
}

export function parsePhotoContest(raw: RawContest): PhotoContest {
  return {
    id: raw.id ?? '',
    periodStart: raw.period_start ?? '',
    periodEnd: raw.period_end ?? '',
    status: raw.status ?? '',
  };
}

export function parsePhotoContestEntry(raw: RawEntry): PhotoContestEntry {
  return {
    id: raw.id ?? '',
    photoId: typeof raw.photo_id === 'string' && raw.photo_id.length > 0 ? raw.photo_id : null,
    account: parseProfile(raw.account),
    imageUrl: resolveBeerPhotoUrl(raw.image_url),
    caption: raw.caption ?? '',
    pubName: raw.pub_name ?? '',
    pubCity: raw.pub_city ?? '',
    votes: typeof raw.votes === 'number' && Number.isFinite(raw.votes) ? raw.votes : 0,
    myVote: raw.my_vote === true,
    isMine: raw.is_mine === true,
    createdAt: raw.created_at ?? '',
  };
}

export function parsePhotoContestWinner(raw: RawWinner): PhotoContestWinner {
  return {
    rank: typeof raw.rank === 'number' && Number.isFinite(raw.rank) ? raw.rank : 0,
    account: parseProfile(raw.account),
    imageUrl: resolveBeerPhotoUrl(raw.image_url),
    caption: raw.caption ?? '',
    votes: typeof raw.votes === 'number' && Number.isFinite(raw.votes) ? raw.votes : 0,
  };
}

interface RequestOk {
  ok: true;
  data: Record<string, unknown>;
}

type RequestResult = RequestOk | { ok: false; result: FriendActionError };

function extractError(data: Record<string, unknown>, status: number): FriendActionError {
  const detail =
    typeof data.detail === 'string' ? data.detail : 'Nepodařilo se to uložit. Zkus to znovu.';
  const code = typeof data.code === 'string' ? data.code : `http_${status}`;
  return { ok: false, code, detail };
}

async function handleUnauthorized(session: AccountSession): Promise<void> {
  await classifyQueueHttpFailure(401, session);
}

async function requestJson(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<RequestResult> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'offline', detail: 'Server teď není dostupný.' } };
  }

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'account', detail: 'Účet teď není připravený.' } };
  }

  const abort = chainAbortSignal(options.signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: abort.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      const text = await resp.text();
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (resp.status === 401) {
      await handleUnauthorized(session);
      return { ok: false, result: { ok: false, code: 'auth', detail: 'Přihlášení vypršelo.' } };
    }
    if (!resp.ok) return { ok: false, result: extractError(data, resp.status) };
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('photo_contest_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { ok: false, result: { ok: false, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' } };
  } finally {
    abort.cleanup();
  }
}

/** GET /v1/photo-contest — the whole round snapshot. null on any failure. */
export async function fetchPhotoContest(
  signal?: AbortSignal,
): Promise<PhotoContestSnapshot | null> {
  const res = await requestJson('/v1/photo-contest', { signal });
  if (!res.ok) return null;
  const d = res.data;
  const rawLast = d.last_results as
    | { contest?: RawContest; winners?: RawWinner[] }
    | null
    | undefined;
  return {
    contest:
      d.contest && typeof d.contest === 'object'
        ? parsePhotoContest(d.contest as RawContest)
        : null,
    entries: Array.isArray(d.entries)
      ? (d.entries as RawEntry[]).map(parsePhotoContestEntry)
      : [],
    myEntryId: typeof d.my_entry_id === 'string' ? d.my_entry_id : null,
    myVoteEntryId: typeof d.my_vote_entry_id === 'string' ? d.my_vote_entry_id : null,
    lastResults:
      rawLast && typeof rawLast === 'object'
        ? {
            contest: parsePhotoContest(rawLast.contest ?? {}),
            winners: Array.isArray(rawLast.winners)
              ? rawLast.winners.map(parsePhotoContestWinner)
              : [],
          }
        : null,
  };
}

/**
 * POST /v1/photo-contest/entries — enter (or replace my existing entry with)
 * one diary photo. Hard-rejects with code 'nickname_required' when the account
 * has no public handle yet.
 */
export async function enterPhotoContest(
  photoId: string,
): Promise<{ ok: true; entry: PhotoContestEntry } | FriendActionError> {
  const res = await requestJson('/v1/photo-contest/entries', {
    method: 'POST',
    body: { photo_id: photoId },
  });
  if (!res.ok) return res.result;
  return { ok: true, entry: parsePhotoContestEntry((res.data.entry ?? {}) as RawEntry) };
}

/** DELETE /v1/photo-contest/entries — withdraw my entry from the round. */
export async function withdrawPhotoContestEntry(): Promise<FriendActionResult> {
  const res = await requestJson('/v1/photo-contest/entries', { method: 'DELETE' });
  return res.ok ? { ok: true } : res.result;
}

/**
 * POST /v1/photo-contest/vote — cast (or move) my single vote onto an entry.
 * Hard-rejects with code 'cannot_vote_own'. Returns the fresh vote count so the
 * UI can reconcile its optimistic bump.
 */
export async function votePhotoContest(
  entryId: string,
): Promise<{ ok: true; entryId: string; votes: number } | FriendActionError> {
  const res = await requestJson('/v1/photo-contest/vote', {
    method: 'POST',
    body: { entry_id: entryId },
  });
  if (!res.ok) return res.result;
  return {
    ok: true,
    entryId: typeof res.data.entry_id === 'string' ? res.data.entry_id : entryId,
    votes:
      typeof res.data.votes === 'number' && Number.isFinite(res.data.votes)
        ? res.data.votes
        : 0,
  };
}

/** DELETE /v1/photo-contest/vote — retract my vote. */
export async function clearPhotoContestVote(): Promise<FriendActionResult> {
  const res = await requestJson('/v1/photo-contest/vote', { method: 'DELETE' });
  return res.ok ? { ok: true } : res.result;
}
