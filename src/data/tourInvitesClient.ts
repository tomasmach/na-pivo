/**
 * Parta invites to a tour. The owner asks friends and reads who goes; a friend
 * reads their own invite and answers. Never throws: every call resolves to a
 * result the screen can show. A server from before invites answers its routes
 * with a bare 404, which reads as `unsupported`, so the app keeps the link path.
 */

import type { FriendProfile } from './friendsClient';
import { ensureAccount, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { tourBoundary } from './toursBoundary';

export type TourInviteStatus = 'invited' | 'going' | 'declined';

export interface TourInviteRow {
  friend: FriendProfile;
  status: TourInviteStatus;
  invitedAt: string;
  respondedAt: string | null;
}

export interface MyTourInvite {
  planId: string;
  status: TourInviteStatus;
  inviter: FriendProfile;
}

export type TourInviteError =
  | 'ghost' | 'share_required' | 'not_friends' | 'limit' | 'not_found' | 'unsupported'
  | 'invalid' | 'auth' | 'throttled' | 'network' | 'account_changed';

/** `retry`: the same request may still go through later (offline, server busy, session being renewed). */
export type TourInviteResult<T> = { ok: true; value: T } | { ok: false; error: TourInviteError; status: number; retry: boolean };

const TIMEOUT_MS = 12000;
const STATUSES: TourInviteStatus[] = ['invited', 'going', 'declined'];

function parseFriend(raw: unknown): FriendProfile | null {
  const p = raw as { id?: unknown; nickname?: unknown; display_name?: unknown; avatar_url?: unknown; is_public?: unknown } | null;
  if (!p || typeof p.id !== 'string' || !p.id) return null;
  return {
    id: p.id,
    nickname: typeof p.nickname === 'string' && p.nickname ? p.nickname : null,
    displayName: typeof p.display_name === 'string' ? p.display_name : '',
    avatarUrl: typeof p.avatar_url === 'string' ? p.avatar_url : null,
    isPublic: p.is_public === true,
  };
}

function parseStatus(raw: unknown): TourInviteStatus | null {
  return STATUSES.includes(raw as TourInviteStatus) ? (raw as TourInviteStatus) : null;
}

/** Rows the app cannot read are left out rather than failing the whole roster. */
export function parseRoster(raw: unknown): TourInviteRow[] | null {
  const invites = (raw as { invites?: unknown } | null)?.invites;
  if (!Array.isArray(invites)) return null;
  return invites.flatMap((row: { account?: unknown; status?: unknown; invited_at?: unknown; responded_at?: unknown }) => {
    const friend = parseFriend(row?.account);
    const status = parseStatus(row?.status);
    if (!friend || !status) return [];
    return [{ friend, status, invitedAt: typeof row.invited_at === 'string' ? row.invited_at : '',
      respondedAt: typeof row.responded_at === 'string' ? row.responded_at : null }];
  });
}

function parseMine(raw: unknown): MyTourInvite | null {
  const r = raw as { plan_id?: unknown; status?: unknown; inviter?: unknown } | null;
  const status = parseStatus(r?.status);
  const inviter = parseFriend(r?.inviter);
  return r && typeof r.plan_id === 'string' && status && inviter ? { planId: r.plan_id, status, inviter } : null;
}

type Raw = { status: number; data: unknown; session: AccountSession | null; stale?: boolean };

async function request(path: string, method: string, body?: unknown): Promise<Raw> {
  const boundary = tourBoundary();
  if (boundary.changing) return { status: 0, data: null, session: null, stale: true };
  const endpoint = getBackendEndpoint(path);
  if (!endpoint) return { status: 0, data: null, session: null };
  const abort = chainAbortSignal(undefined, TIMEOUT_MS);
  try {
    const session = await ensureAccount();
    const moved = () => tourBoundary().generation !== boundary.generation || tourBoundary().changing;
    if (moved()) return { status: 0, data: null, session: null, stale: true };
    if (!session) return { status: 0, data: null, session: null };
    const response = await fetch(endpoint, {
      method, signal: abort.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data: unknown = null;
    try { data = await response.json(); } catch { /* An old server's 404 page is not JSON. */ }
    if (moved()) return { status: 0, data: null, session: null, stale: true };
    return { status: response.status, data, session };
  } catch {
    return { status: 0, data: null, session: null };
  } finally {
    abort.cleanup();
  }
}

async function failure<T>(r: Raw, source: string, path: string): Promise<TourInviteResult<T>> {
  const code = (r.data as { error?: unknown } | null)?.error;
  const fail = (error: TourInviteError, retry: boolean): TourInviteResult<T> => ({ ok: false, error, status: r.status, retry });
  if (r.stale) return fail('account_changed', false);
  if (code === 'ghost_mode') return fail('ghost', false);
  if (code === 'share_required') return fail('share_required', true);
  if (code === 'not_friends') return fail('not_friends', false);
  if (code === 'invite_limit') return fail('limit', false);
  // Only the new server names its 404; a bare one is a route it does not have yet.
  if (r.status === 404) return fail(code === 'not_found' ? 'not_found' : 'unsupported', false);
  const retry = !r.session || (await classifyQueueHttpFailure(r.status, r.session, { source, endpoint: path })) === 'retry';
  const error: TourInviteError = r.status === 0 ? 'network' : r.status === 401 || r.status === 403 ? 'auth'
    : r.status === 429 ? 'throttled' : r.status === 400 || r.status === 422 ? 'invalid' : 'network';
  return fail(error, retry);
}

/** Invite accepted friends by their Parta ids. Friends invited before are not asked again. */
export async function sendTourInvites(planId: string, recipientIds: string[]): Promise<TourInviteResult<{ roster: TourInviteRow[]; invited: number }>> {
  const path = `/v1/tours/${encodeURIComponent(planId)}/invites`;
  const r = await request(path, 'POST', { recipient_ids: recipientIds });
  if (r.status < 200 || r.status >= 300) return failure(r, 'tour_invite_send', '/v1/tours/{id}/invites');
  const roster = parseRoster(r.data);
  const invited = (r.data as { invited?: unknown } | null)?.invited;
  // The server took it; a body this app cannot read still means the invites went out.
  return { ok: true, value: { roster: roster ?? [], invited: typeof invited === 'number' ? invited : recipientIds.length } };
}

/** Who the owner invited and what they answered. */
export async function fetchTourRoster(planId: string): Promise<TourInviteResult<TourInviteRow[]>> {
  const path = `/v1/tours/${encodeURIComponent(planId)}/invites`;
  const r = await request(path, 'GET');
  if (r.status !== 200) return failure(r, 'tour_invite_roster', '/v1/tours/{id}/invites');
  const roster = parseRoster(r.data);
  return roster ? { ok: true, value: roster } : { ok: false, error: 'invalid', status: r.status, retry: false };
}

/** My own invite to someone's tour; `not_found` when nobody invited this account. */
export async function fetchMyTourInvite(planId: string): Promise<TourInviteResult<MyTourInvite>> {
  const path = `/v1/tour-invites/${encodeURIComponent(planId)}`;
  const r = await request(path, 'GET');
  if (r.status !== 200) return failure(r, 'tour_invite_mine', '/v1/tour-invites/{id}');
  const mine = parseMine(r.data);
  return mine ? { ok: true, value: mine } : { ok: false, error: 'invalid', status: r.status, retry: false };
}

export async function answerTourInvite(planId: string, status: 'going' | 'declined'): Promise<TourInviteResult<MyTourInvite>> {
  const path = `/v1/tour-invites/${encodeURIComponent(planId)}`;
  const r = await request(path, 'PUT', { status });
  if (r.status !== 200) return failure(r, 'tour_invite_answer', '/v1/tour-invites/{id}');
  const mine = parseMine(r.data);
  return mine ? { ok: true, value: mine } : { ok: false, error: 'invalid', status: r.status, retry: false };
}
