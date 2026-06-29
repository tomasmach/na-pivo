import { clearCachedAnonymousAccount, ensureAccount, generateUuidV4, type AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';
import type { Pub } from './pubs';

const REQUEST_TIMEOUT_MS = 9000;

export interface FriendProfile {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
  isPublic: boolean;
}

export interface Friendship {
  id: string;
  status: 'pending' | 'accepted' | 'declined';
  requester: FriendProfile;
  recipient: FriendProfile;
  requestedAt: string;
  respondedAt: string | null;
  updatedAt: string;
}

export interface FriendRitual {
  key: string;
  title: string;
}

export interface FriendStats {
  sharedPubCount: number;
  lastSharedAt: string | null;
  lastPubName: string;
  rituals: FriendRitual[];
}

export type ActivityResponseKind = 'going' | 'maybe' | 'cant';

export interface FriendPubActivity {
  id: string;
  account: FriendProfile;
  cacheKey: string;
  name: string;
  city: string;
  externalId: string;
  message: string;
  startedAt: string;
  expiresAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  responses: { going: number; maybe: number; cant: number; goingProfiles: FriendProfile[] };
  myResponse: ActivityResponseKind | null;
}

export type FriendNotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_at_pub'
  | 'friend_rsvp';

export interface FriendNotification {
  id: string;
  // Known kinds are listed above for autocomplete; any unknown server kind is
  // preserved verbatim by the parser so a newer backend value is never silently
  // rewritten to the wrong kind.
  kind: FriendNotificationKind | (string & {});
  title: string;
  body: string;
  actor: FriendProfile | null;
  friendshipId: string | null;
  activityId: string | null;
  pubCacheKey: string;
  pubName: string;
  readAt: string | null;
  createdAt: string;
}

export interface FriendStreak {
  currentWeeks: number;
  thisWeekLit: boolean;
}

export interface LeaderboardEntry {
  account: FriendProfile;
  visits30d: number;
  sharedCount: number;
  isMe: boolean;
}

export interface FriendSocialSettings {
  ghostMode: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export const DEFAULT_FRIEND_SOCIAL_SETTINGS: FriendSocialSettings = {
  ghostMode: false,
  quietHoursEnabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 9,
};

export interface FriendsDashboard {
  friends: FriendProfile[];
  friendStats: Record<string, FriendStats>;
  incomingRequests: Friendship[];
  outgoingRequests: Friendship[];
  activeFriends: FriendPubActivity[];
  myActiveActivity: FriendPubActivity | null;
  settings: FriendSocialSettings;
  streak: FriendStreak;
  leaderboard: LeaderboardEntry[];
  notifications: FriendNotification[];
  unreadCount: number;
}

export type FriendActionResult =
  | { ok: true }
  | { ok: false; code: string; detail: string };

interface RawFriendProfile {
  id?: string;
  nickname?: string | null;
  display_name?: string;
  avatar_url?: string | null;
  is_public?: boolean;
}

interface RawFriendship {
  id?: string;
  status?: string;
  requester?: RawFriendProfile;
  recipient?: RawFriendProfile;
  requested_at?: string;
  responded_at?: string | null;
  updated_at?: string;
}

interface RawActivityResponses {
  going?: number;
  maybe?: number;
  cant?: number;
  going_profiles?: RawFriendProfile[];
}

interface RawFriendActivity {
  id?: string;
  account?: RawFriendProfile;
  cache_key?: string;
  name?: string;
  city?: string;
  external_id?: string;
  message?: string;
  started_at?: string;
  expires_at?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  responses?: RawActivityResponses;
  my_response?: string | null;
}

interface RawFriendStreak {
  current_weeks?: number;
  this_week_lit?: boolean;
}

interface RawLeaderboardEntry {
  account?: RawFriendProfile;
  visits_30d?: number;
  shared_count?: number;
  is_me?: boolean;
}

interface RawFriendSocialSettings {
  ghost_mode?: boolean;
  quiet_hours_enabled?: boolean;
  quiet_hours_start?: number;
  quiet_hours_end?: number;
}

interface RawFriendNotification {
  id?: string;
  kind?: string;
  title?: string;
  body?: string;
  actor?: RawFriendProfile | null;
  friendship_id?: string | null;
  activity_id?: string | null;
  pub_cache_key?: string;
  pub_name?: string;
  read_at?: string | null;
  created_at?: string;
}

interface RawFriendStats {
  shared_pub_count?: number;
  last_shared_at?: string | null;
  last_pub_name?: string;
  rituals?: { key?: string; title?: string }[];
}

function chainTimeout(signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
  };
}

async function handleUnauthorized(session: AccountSession): Promise<void> {
  await clearCachedAnonymousAccount(session);
}

function parseProfile(raw: RawFriendProfile | undefined | null): FriendProfile {
  return {
    id: raw?.id ?? '',
    nickname: typeof raw?.nickname === 'string' && raw.nickname.length > 0 ? raw.nickname : null,
    displayName: raw?.display_name ?? '',
    avatarUrl: raw?.avatar_url ?? null,
    isPublic: raw?.is_public !== false,
  };
}

function parseFriendship(raw: RawFriendship): Friendship {
  const status =
    raw.status === 'accepted' || raw.status === 'declined' || raw.status === 'pending'
      ? raw.status
      : 'pending';
  return {
    id: raw.id ?? '',
    status,
    requester: parseProfile(raw.requester),
    recipient: parseProfile(raw.recipient),
    requestedAt: raw.requested_at ?? '',
    respondedAt: raw.responded_at ?? null,
    updatedAt: raw.updated_at ?? '',
  };
}

function parseStats(raw: RawFriendStats | undefined): FriendStats {
  return {
    sharedPubCount: typeof raw?.shared_pub_count === 'number' ? raw.shared_pub_count : 0,
    lastSharedAt: raw?.last_shared_at ?? null,
    lastPubName: raw?.last_pub_name ?? '',
    rituals: Array.isArray(raw?.rituals)
      ? raw.rituals.map((r) => ({ key: r.key ?? '', title: r.title ?? '' })).filter((r) => r.key && r.title)
      : [],
  };
}

function parseResponseKind(value: unknown): ActivityResponseKind | null {
  return value === 'going' || value === 'maybe' || value === 'cant' ? value : null;
}

function parseActivityResponses(raw: RawActivityResponses | undefined): FriendPubActivity['responses'] {
  return {
    going: typeof raw?.going === 'number' ? raw.going : 0,
    maybe: typeof raw?.maybe === 'number' ? raw.maybe : 0,
    cant: typeof raw?.cant === 'number' ? raw.cant : 0,
    goingProfiles: Array.isArray(raw?.going_profiles) ? raw.going_profiles.map(parseProfile) : [],
  };
}

function parseActivity(raw: RawFriendActivity): FriendPubActivity {
  return {
    id: raw.id ?? '',
    account: parseProfile(raw.account),
    cacheKey: raw.cache_key ?? '',
    name: raw.name ?? '',
    city: raw.city ?? '',
    externalId: raw.external_id ?? '',
    message: raw.message ?? '',
    startedAt: raw.started_at ?? '',
    expiresAt: raw.expires_at ?? '',
    active: raw.active !== false,
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? '',
    responses: parseActivityResponses(raw.responses),
    myResponse: parseResponseKind(raw.my_response),
  };
}

function parseStreak(raw: RawFriendStreak | undefined | null): FriendStreak {
  return {
    currentWeeks: typeof raw?.current_weeks === 'number' ? raw.current_weeks : 0,
    thisWeekLit: raw?.this_week_lit === true,
  };
}

function parseSocialSettings(raw: RawFriendSocialSettings | undefined | null): FriendSocialSettings {
  return {
    ghostMode: raw?.ghost_mode === true,
    quietHoursEnabled: raw?.quiet_hours_enabled !== false,
    quietHoursStart: typeof raw?.quiet_hours_start === 'number' ? raw.quiet_hours_start : 23,
    quietHoursEnd: typeof raw?.quiet_hours_end === 'number' ? raw.quiet_hours_end : 9,
  };
}

function parseLeaderboardEntry(raw: RawLeaderboardEntry): LeaderboardEntry {
  return {
    account: parseProfile(raw.account),
    visits30d: typeof raw.visits_30d === 'number' ? raw.visits_30d : 0,
    sharedCount: typeof raw.shared_count === 'number' ? raw.shared_count : 0,
    isMe: raw.is_me === true,
  };
}

function parseNotification(raw: RawFriendNotification): FriendNotification {
  // Recognised kinds pass through; unknown server kinds are kept verbatim so a
  // newer backend value is never coerced. Only a missing/empty kind defaults.
  const kind = typeof raw.kind === 'string' && raw.kind.length > 0 ? raw.kind : 'friend_at_pub';
  return {
    id: raw.id ?? '',
    kind,
    title: raw.title ?? '',
    body: raw.body ?? '',
    actor: raw.actor ? parseProfile(raw.actor) : null,
    friendshipId: raw.friendship_id ?? null,
    activityId: raw.activity_id ?? null,
    pubCacheKey: raw.pub_cache_key ?? '',
    pubName: raw.pub_name ?? '',
    readAt: raw.read_at ?? null,
    createdAt: raw.created_at ?? '',
  };
}

function extractError(data: unknown, status: number): FriendActionResult {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === 'string') {
      return {
        ok: false,
        code: typeof obj.code === 'string' ? obj.code : `http_${status}`,
        detail: obj.detail,
      };
    }
  }
  return { ok: false, code: `http_${status}`, detail: 'Nepodařilo se to uložit. Zkus to znovu.' };
}

async function requestJson(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; result: FriendActionResult }> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'offline', detail: 'Server teď není dostupný.' } };
  }

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'account', detail: 'Účet teď není připravený.' } };
  }

  const abort = chainTimeout(options.signal);
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
      trackApiFailure('friends_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { ok: false, result: { ok: false, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' } };
  } finally {
    abort.cleanup();
  }
}

export async function fetchFriendsDashboard(signal?: AbortSignal): Promise<FriendsDashboard | null> {
  const res = await requestJson('/v1/friends', { signal });
  if (!res.ok) return null;
  const rawStats = (res.data.friend_stats ?? {}) as Record<string, RawFriendStats>;
  const friendStats: Record<string, FriendStats> = {};
  for (const [id, stats] of Object.entries(rawStats)) {
    friendStats[id] = parseStats(stats);
  }
  return {
    friends: Array.isArray(res.data.friends)
      ? (res.data.friends as RawFriendProfile[]).map(parseProfile)
      : [],
    friendStats,
    incomingRequests: Array.isArray(res.data.incoming_requests)
      ? (res.data.incoming_requests as RawFriendship[]).map(parseFriendship)
      : [],
    outgoingRequests: Array.isArray(res.data.outgoing_requests)
      ? (res.data.outgoing_requests as RawFriendship[]).map(parseFriendship)
      : [],
    activeFriends: Array.isArray(res.data.active_friends)
      ? (res.data.active_friends as RawFriendActivity[]).map(parseActivity)
      : [],
    myActiveActivity: res.data.my_active_activity
      ? parseActivity(res.data.my_active_activity as RawFriendActivity)
      : null,
    settings: parseSocialSettings(res.data.settings as RawFriendSocialSettings | undefined),
    streak: parseStreak(res.data.streak as RawFriendStreak | undefined),
    leaderboard: Array.isArray(res.data.leaderboard)
      ? (res.data.leaderboard as RawLeaderboardEntry[]).map(parseLeaderboardEntry)
      : [],
    notifications: Array.isArray(res.data.notifications)
      ? (res.data.notifications as RawFriendNotification[]).map(parseNotification)
      : [],
    unreadCount: typeof res.data.unread_count === 'number' ? res.data.unread_count : 0,
  };
}

export async function searchFriends(query: string, signal?: AbortSignal): Promise<FriendProfile[] | null> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await requestJson(`/v1/friends/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return null;
  return Array.isArray(res.data.results)
    ? (res.data.results as RawFriendProfile[]).map(parseProfile)
    : [];
}

export async function sendFriendRequest(params: {
  accountId?: string;
  nickname?: string;
}): Promise<FriendActionResult> {
  const body = params.accountId
    ? { target_account_id: params.accountId }
    : { nickname: params.nickname ?? '' };
  const res = await requestJson('/v1/friends/requests', { method: 'POST', body });
  return res.ok ? { ok: true } : res.result;
}

export async function respondFriendRequest(
  requestId: string,
  action: 'accept' | 'decline',
): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/requests/${encodeURIComponent(requestId)}/${action}`, {
    method: 'POST',
  });
  return res.ok ? { ok: true } : res.result;
}

export async function removeFriend(accountId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  return res.ok ? { ok: true } : res.result;
}

export async function shareFriendPubActivity(pub: Pub, message?: string): Promise<FriendActionResult> {
  const now = new Date();
  const expires = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const res = await requestJson('/v1/friends/pub-activity', {
    method: 'POST',
    body: {
      client_id: generateUuidV4(),
      name: pub.name,
      lat: pub.lat,
      lng: pub.lng,
      city: pub.city ?? '',
      external_id: pub.id || '',
      message: message ?? '',
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
    },
  });
  return res.ok ? { ok: true } : res.result;
}

export async function respondToActivity(
  activityId: string,
  response: ActivityResponseKind,
): Promise<FriendActionResult> {
  const res = await requestJson(
    `/v1/friends/pub-activity/${encodeURIComponent(activityId)}/respond`,
    { method: 'POST', body: { response } },
  );
  return res.ok ? { ok: true } : res.result;
}

export async function clearActivityResponse(activityId: string): Promise<FriendActionResult> {
  const res = await requestJson(
    `/v1/friends/pub-activity/${encodeURIComponent(activityId)}/respond`,
    { method: 'DELETE' },
  );
  return res.ok ? { ok: true } : res.result;
}

export async function endFriendPubActivity(activityId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/pub-activity/${encodeURIComponent(activityId)}`, {
    method: 'DELETE',
  });
  return res.ok ? { ok: true } : res.result;
}

export async function updateFriendSettings(
  patch: Partial<FriendSocialSettings>,
): Promise<FriendActionResult> {
  const body: Record<string, unknown> = {};
  if (patch.ghostMode !== undefined) body.ghost_mode = patch.ghostMode;
  if (patch.quietHoursEnabled !== undefined) body.quiet_hours_enabled = patch.quietHoursEnabled;
  if (patch.quietHoursStart !== undefined) body.quiet_hours_start = patch.quietHoursStart;
  if (patch.quietHoursEnd !== undefined) body.quiet_hours_end = patch.quietHoursEnd;
  const res = await requestJson('/v1/friends/settings', { method: 'PATCH', body });
  return res.ok ? { ok: true } : res.result;
}

export async function markFriendNotificationsRead(ids?: string[]): Promise<void> {
  await requestJson('/v1/friends/notifications/read', {
    method: 'POST',
    body: ids ? { ids } : {},
  });
}
