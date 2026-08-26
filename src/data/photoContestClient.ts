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
import { notifyUgcConsentRequiredFromResponse, ugcPolicyHeaders } from './ugcConsent';

const REQUEST_TIMEOUT_MS = 9000;

/** Server-side page size for contest entries (additive pagination contract). */
export const PHOTO_CONTEST_PAGE_SIZE = 20;

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

/**
 * MY outcome in the finished round (additive `my_result` on the wire; null on
 * older backends). Powers the one-time results celebration and teaser copy.
 */
export interface PhotoContestMyResult {
  entered: boolean;
  voted: boolean;
  /** 1–3 when I made the podium, null otherwise. */
  rank: number | null;
  votes: number;
  xpAwarded: number;
  winsCount: number;
}

/** The finished previous round, when the backend still surfaces it. */
export interface PhotoContestResults {
  contest: PhotoContest;
  winners: PhotoContestWinner[];
  myResult: PhotoContestMyResult | null;
}

/**
 * Everything GET /v1/photo-contest returns, camelCased, plus the local viewer
 * account id that scopes personalized fields. The wire also carries
 * `my_entry_photo_id`, which the app derives from the diary store instead.
 */
export interface PhotoContestSnapshot {
  /** Account whose personalized my_* fields and result this snapshot belongs to. */
  viewerAccountId: string;
  contest: PhotoContest | null;
  entries: PhotoContestEntry[];
  myEntryId: string | null;
  myVoteEntryId: string | null;
  /**
   * My own entry when the wire surfaces it additively (`my_entry`); legacy
   * backends fall back to the first `isMine` entry, null otherwise.
   */
  myEntry: PhotoContestEntry | null;
  /** Total visible entries server-side; falls back to the parsed page length. */
  entryCount: number;
  /** Opaque cursor for the next page; null when there are no more entries. */
  nextCursor: string | null;
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

interface RawMyResult {
  entered?: boolean;
  voted?: boolean;
  rank?: number | null;
  votes?: number;
  xp_awarded?: number;
  wins_count?: number;
}

function parseMyResult(raw?: RawMyResult | null): PhotoContestMyResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    entered: raw.entered === true,
    voted: raw.voted === true,
    rank:
      typeof raw.rank === 'number' && Number.isFinite(raw.rank) && raw.rank >= 1
        ? raw.rank
        : null,
    votes: num(raw.votes),
    xpAwarded: num(raw.xp_awarded),
    winsCount: num(raw.wins_count),
  };
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

async function handleUnauthorized(session: AccountSession, endpoint: string): Promise<void> {
  await classifyQueueHttpFailure(401, session, { source: 'photo_contest_request', endpoint });
}

async function requestJson(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    session?: AccountSession;
    gatedUgc?: boolean;
  } = {},
): Promise<RequestResult> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'offline', detail: 'Teď se k serveru nedostanu.' } };
  }

  const session = options.session ?? (await ensureAccount(options.signal));
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
        ...(options.gatedUgc ? ugcPolicyHeaders(session.accountId) : {}),
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
    if (options.gatedUgc) notifyUgcConsentRequiredFromResponse(resp.status, data);
    if (resp.status === 401) {
      await handleUnauthorized(session, path);
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

/**
 * Teaser cache — the Parta strip refetches on every tab focus, which would
 * hammer GET /v1/photo-contest for a surface that only shows a countdown and
 * counts. Any successful full fetch (e.g. opening the contest screen)
 * refreshes it, so the teaser is at most TTL-stale.
 */
const TEASER_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const teaserCache = new Map<string, { at: number; snapshot: PhotoContestSnapshot }>();
let accountBoundaryGeneration = 0;

/** Drop every account's in-memory contest view and invalidate in-flight reads. */
export function clearPhotoContestCache(): void {
  accountBoundaryGeneration += 1;
  teaserCache.clear();
}

/** The snapshot for lightweight teaser surfaces: cached, TTL-bounded. */
export async function fetchPhotoContestTeaser(
  signal?: AbortSignal,
): Promise<PhotoContestSnapshot | null> {
  const generation = accountBoundaryGeneration;
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted || generation !== accountBoundaryGeneration) return null;

  const hit = teaserCache.get(session.accountId);
  if (hit && Date.now() - hit.at < TEASER_SNAPSHOT_TTL_MS) {
    return hit.snapshot;
  }
  return fetchPhotoContestForSession(session, generation, {
    limit: 1,
    cacheTeaser: true,
    signal,
  });
}

/** GET /v1/photo-contest — the whole round snapshot. null on any failure. */
export async function fetchPhotoContest(
  signal?: AbortSignal,
): Promise<PhotoContestSnapshot | null> {
  const generation = accountBoundaryGeneration;
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted || generation !== accountBoundaryGeneration) return null;
  return fetchPhotoContestForSession(session, generation, {
    limit: PHOTO_CONTEST_PAGE_SIZE,
    cacheTeaser: true,
    signal,
  });
}

/**
 * GET /v1/photo-contest?limit=20&cursor=… — one page of entries beyond the
 * initial snapshot. Never touches the teaser cache: a partial second page must
 * not replace the full first-page snapshot cached for teaser surfaces.
 */
export async function fetchPhotoContestPage(
  cursor: string,
  signal?: AbortSignal,
): Promise<PhotoContestSnapshot | null> {
  const generation = accountBoundaryGeneration;
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted || generation !== accountBoundaryGeneration) return null;
  return fetchPhotoContestForSession(session, generation, {
    limit: PHOTO_CONTEST_PAGE_SIZE,
    cursor,
    cacheTeaser: false,
    signal,
  });
}

interface SnapshotFetchOptions {
  limit: number;
  cursor?: string;
  cacheTeaser: boolean;
  signal?: AbortSignal;
}

async function fetchPhotoContestForSession(
  session: AccountSession,
  generation: number,
  options: SnapshotFetchOptions,
): Promise<PhotoContestSnapshot | null> {
  const signal = options.signal;
  let path = `/v1/photo-contest?limit=${options.limit}`;
  if (options.cursor !== undefined) path += `&cursor=${encodeURIComponent(options.cursor)}`;
  const res = await requestJson(path, { signal, session });
  if (!res.ok) return null;
  const d = res.data;
  const rawLast = d.last_results as
    | { contest?: RawContest; winners?: RawWinner[]; my_result?: RawMyResult | null }
    | null
    | undefined;
  // Parse the entry page once; both `entries` and the legacy my-entry fallback
  // read from the same parsed array.
  const entries = Array.isArray(d.entries)
    ? (d.entries as RawEntry[]).map(parsePhotoContestEntry)
    : [];
  const rawMyEntry = d.my_entry as RawEntry | null | undefined;
  const snapshot: PhotoContestSnapshot = {
    viewerAccountId: session.accountId,
    contest:
      d.contest && typeof d.contest === 'object'
        ? parsePhotoContest(d.contest as RawContest)
        : null,
    entries,
    myEntryId: typeof d.my_entry_id === 'string' ? d.my_entry_id : null,
    myVoteEntryId: typeof d.my_vote_entry_id === 'string' ? d.my_vote_entry_id : null,
    myEntry:
      rawMyEntry && typeof rawMyEntry === 'object'
        ? parsePhotoContestEntry(rawMyEntry)
        : (entries.find((entry) => entry.isMine) ?? null),
    entryCount:
      typeof d.visible_entry_count === 'number' &&
      Number.isFinite(d.visible_entry_count) &&
      d.visible_entry_count >= 0
        ? d.visible_entry_count
        : entries.length,
    nextCursor: typeof d.next_cursor === 'string' && d.next_cursor.length > 0 ? d.next_cursor : null,
    lastResults:
      rawLast && typeof rawLast === 'object'
        ? {
            contest: parsePhotoContest(rawLast.contest ?? {}),
            winners: Array.isArray(rawLast.winners)
              ? rawLast.winners.map(parsePhotoContestWinner)
              : [],
            myResult: parseMyResult(rawLast.my_result),
          }
        : null,
  };
  const currentSession = await ensureAccount(signal);
  if (
    !currentSession ||
    currentSession.accountId !== session.accountId ||
    signal?.aborted ||
    generation !== accountBoundaryGeneration
  ) {
    return null;
  }
  if (options.cacheTeaser) {
    teaserCache.set(session.accountId, { at: Date.now(), snapshot });
  }
  return snapshot;
}

/**
 * POST /v1/photo-contest/entries — enter (or replace my existing entry with)
 * one diary photo. Hard-rejects with code 'nickname_required' when the account
 * has no public handle yet.
 */
export async function enterPhotoContest(
  photoId: string,
  signal?: AbortSignal,
): Promise<{ ok: true; entry: PhotoContestEntry } | FriendActionError> {
  const res = await requestJson('/v1/photo-contest/entries', {
    method: 'POST',
    body: { photo_id: photoId },
    signal,
    gatedUgc: true,
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
