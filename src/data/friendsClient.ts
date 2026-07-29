import { clearCachedAnonymousAccount, ensureAccount, generateUuidV4, type AccountSession } from './account';
import {
  parseAchievementsBlock,
  type AccountAchievements,
  type RawAchievementsBlock,
} from './achievements';
import { parseBeerCheckIn, type BeerCheckIn } from './beerCheckinsClient';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { saveFriendsDashboardSnapshot, snapshotGeneration } from './friendsSnapshot';
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

/** Live broadcast vs a scheduled "Dnes v 20:00" plan (Parta 3.0 §B). */
export type ActivityKind = 'live' | 'plan';

/** Reaction glyph on an activity/feed row. Single glyph today (Parta 3.0 §C). */
export type ReactionKind = 'cheers';

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
  /** 'live' (default) or 'plan'. Older payloads omit it → parsed as 'live'. */
  kind: ActivityKind;
  /** Target time for a plan ("Dnes v 20:00"); null for live rows. */
  scheduledFor: string | null;
  /** Reaction tallies by glyph; additive, defaults to zero. */
  reactions: { cheers: number };
  /** My own reaction on this activity, or null. */
  myReaction: ReactionKind | null;
}

export type FriendNotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_at_pub'
  | 'friend_rsvp'
  | 'friend_cheers'
  | 'friend_plan';

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
  /**
   * Whether the party sees me sitting in a pub and what I drank, derived from
   * the counter alone — no "cinknutí" needed. Ghost mode overrules it. Older
   * backends omit the field; they also have no presence to leak, so the parsed
   * default is simply the server's own default (on).
   */
  shareDrinksWithParta: boolean;
}

export const DEFAULT_FRIEND_SOCIAL_SETTINGS: FriendSocialSettings = {
  ghostMode: false,
  quietHoursEnabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 9,
  shareDrinksWithParta: true,
};

/**
 * One friend currently sitting somewhere, derived server-side from the pub
 * visits the counter already syncs. This is the half of Parta that used to
 * require an explicit broadcast: "cinknutí" now only means "and send a push".
 */
export interface FriendPresence {
  account: FriendProfile;
  pubName: string;
  pubCity: string;
  cacheKey: string;
  lat: number | null;
  lng: number | null;
  /** When this sitting started. */
  since: string;
  /** Freshest sign of life — last drink or visit heartbeat. */
  lastSeenAt: string;
  beers: number;
  lastDrinkName: string;
  /** Set when they ALSO broadcast, which is what makes an RSVP possible. */
  activityId: string | null;
}

/** My own row in the same shape, plus whether the party can actually see it. */
export interface MyPresence extends FriendPresence {
  visibleToParta: boolean;
}

export interface FriendsDashboard {
  friends: FriendProfile[];
  friendStats: Record<string, FriendStats>;
  incomingRequests: Friendship[];
  outgoingRequests: Friendship[];
  activeFriends: FriendPubActivity[];
  myActiveActivity: FriendPubActivity | null;
  /** Friends' plans for today (kind=plan). Empty on older backends. */
  plans: FriendPubActivity[];
  /** My own plan for today, or null. */
  myPlan: FriendPubActivity | null;
  /** Who from the party is sitting right now, broadcast or not. */
  presence: FriendPresence[];
  /** Where the server thinks I am sitting, or null. */
  myPresence: MyPresence | null;
  /** Account ids I've blocked, for client-side filtering. */
  blockedIds: string[];
  settings: FriendSocialSettings;
  streak: FriendStreak;
  leaderboard: LeaderboardEntry[];
  notifications: FriendNotification[];
  unreadCount: number;
}

/**
 * Cheap poll slice for the bounded refresh loop (Parta 3.0 §D2). Falls back to
 * the full dashboard on an older backend that lacks `GET /v1/friends/live`.
 */
export interface FriendsLiveSlice {
  activeFriends: FriendPubActivity[];
  myActiveActivity: FriendPubActivity | null;
  plans: FriendPubActivity[];
  myPlan: FriendPubActivity | null;
  presence: FriendPresence[];
  myPresence: MyPresence | null;
  incomingCount: number;
  unreadCount: number;
  serverTime: string | null;
}

/** My reusable invite code + deep link (Parta 3.0 §A1). */
export interface FriendInvite {
  code: string;
  url: string;
  webUrl: string;
  expiresAt: string;
}

const FRIEND_INVITE_WEB_ORIGIN = 'https://na-pivo.cz';

/** Canonical public invite URL. Safe for messaging apps, browsers and QR codes. */
export function buildFriendInviteWebUrl(code: string): string {
  return `${FRIEND_INVITE_WEB_ORIGIN}/p/${encodeURIComponent(code)}`;
}

/** Result of resolving an invite code to its inviter (Parta 3.0 §A2). */
export interface InviteResolveResult {
  valid: boolean;
  expired: boolean;
  inviter: FriendProfile | null;
}

export interface FriendProfileStats {
  sharedPubCount: number;
  nightsTogether: number;
  lastSharedAt: string | null;
  lastPubName: string;
  streakWeeks: number;
  rituals: FriendRitual[];
}

export interface RecentTogether {
  pubName: string;
  cacheKey: string;
  at: string;
}

/**
 * Where the two accounts stand (leaderboards wave). Older backends omit the
 * field — the parser derives 'accepted'/'none' from `is_friend`.
 */
export type FriendshipStatus = 'none' | 'outgoing_pending' | 'incoming_pending' | 'accepted';

/** Public diary numbers shown on any public profile (leaderboards wave). */
export interface PublicProfileStats {
  totalBeers: number;
  distinctPubs: number;
  mapperLevel: number;
  mapperTitle: string;
  mapperXp: number;
}

/** Full friend profile payload for `GET /v1/friends/<id>` (Parta 3.0 §F1). */
export interface FriendProfileDetail {
  profile: FriendProfile;
  isFriend: boolean;
  friendshipId: string | null;
  stats: FriendProfileStats;
  liveActivity: FriendPubActivity | null;
  plan: FriendPubActivity | null;
  recentTogether: RecentTogether[];
  latestBeers: BeerCheckIn[];
  blocked: boolean;
  /** Additive (leaderboards wave); derived from `isFriend` on older backends. */
  friendshipStatus: FriendshipStatus;
  /** Friendship id to accept when status is 'incoming_pending', else null. */
  incomingRequestId: string | null;
  /** Null on older backends → hide the public-numbers strip. */
  publicStats: PublicProfileStats | null;
  /** Null on older backends → hide the badge showcase. */
  achievements: AccountAchievements | null;
}

/** The failure half of {@link FriendActionResult}. */
export interface FriendActionError {
  ok: false;
  code: string;
  detail: string;
}

export type FriendActionResult = { ok: true } | FriendActionError;

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

interface RawActivityReactions {
  cheers?: number;
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
  kind?: string;
  scheduled_for?: string | null;
  reactions?: RawActivityReactions;
  my_reaction?: string | null;
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
  share_drinks_with_parta?: boolean;
}

interface RawFriendPresence {
  account?: RawFriendProfile;
  pub_name?: string;
  pub_city?: string;
  cache_key?: string;
  lat?: number | null;
  lng?: number | null;
  since?: string;
  last_seen_at?: string;
  beers?: number;
  last_drink_name?: string;
  activity_id?: string | null;
  visible_to_parta?: boolean;
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

interface RawFriendProfileStats {
  shared_pub_count?: number;
  nights_together?: number;
  last_shared_at?: string | null;
  last_pub_name?: string;
  streak_weeks?: number;
  rituals?: { key?: string; title?: string }[];
}

interface RawRecentTogether {
  pub_name?: string;
  cache_key?: string;
  at?: string;
}

interface RawPublicProfileStats {
  total_beers?: number;
  distinct_pubs?: number;
  mapper_level?: number;
  mapper_title?: string;
  mapper_xp?: number;
}

interface RawFriendProfileDetail {
  profile?: RawFriendProfile;
  is_friend?: boolean;
  friendship_id?: string | null;
  stats?: RawFriendProfileStats;
  live_activity?: RawFriendActivity | null;
  plan?: RawFriendActivity | null;
  recent_together?: RawRecentTogether[];
  latest_beers?: unknown[];
  blocked?: boolean;
  friendship_status?: string;
  incoming_request_id?: string | null;
  public_stats?: RawPublicProfileStats | null;
  achievements?: RawAchievementsBlock | null;
}

interface RawFriendInvite {
  code?: string;
  url?: string;
  web_url?: string;
  expires_at?: string;
}

interface RawInviteResolve {
  valid?: boolean;
  expired?: boolean;
  inviter?: RawFriendProfile | null;
}

async function handleUnauthorized(session: AccountSession, endpoint: string): Promise<void> {
  await clearCachedAnonymousAccount(session, { source: 'friends_request', endpoint });
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

function parseActivityKind(value: unknown): ActivityKind {
  // Older payloads omit `kind`; treat anything but an explicit 'plan' as 'live'
  // so old rows and unknown values keep the pre-plan "live now" semantic.
  return value === 'plan' ? 'plan' : 'live';
}

function parseReactionKind(value: unknown): ReactionKind | null {
  return value === 'cheers' ? 'cheers' : null;
}

function parseReactions(raw: RawActivityReactions | undefined): FriendPubActivity['reactions'] {
  return { cheers: typeof raw?.cheers === 'number' ? raw.cheers : 0 };
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
    kind: parseActivityKind(raw.kind),
    scheduledFor: raw.scheduled_for ?? null,
    reactions: parseReactions(raw.reactions),
    myReaction: parseReactionKind(raw.my_reaction),
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
    shareDrinksWithParta: raw?.share_drinks_with_parta !== false,
  };
}

function parsePresence(raw: RawFriendPresence): FriendPresence {
  return {
    account: parseProfile(raw.account),
    pubName: raw.pub_name ?? '',
    pubCity: raw.pub_city ?? '',
    cacheKey: raw.cache_key ?? '',
    lat: typeof raw.lat === 'number' ? raw.lat : null,
    lng: typeof raw.lng === 'number' ? raw.lng : null,
    since: raw.since ?? '',
    lastSeenAt: raw.last_seen_at ?? raw.since ?? '',
    beers: typeof raw.beers === 'number' ? raw.beers : 0,
    lastDrinkName: raw.last_drink_name ?? '',
    activityId: typeof raw.activity_id === 'string' ? raw.activity_id : null,
  };
}

function parsePresenceList(raw: unknown): FriendPresence[] {
  return Array.isArray(raw) ? (raw as RawFriendPresence[]).map(parsePresence) : [];
}

function parseMyPresence(raw: unknown): MyPresence | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as RawFriendPresence;
  return { ...parsePresence(row), visibleToParta: row.visible_to_parta !== false };
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

function parseRituals(raw: { key?: string; title?: string }[] | undefined): FriendRitual[] {
  return Array.isArray(raw)
    ? raw.map((r) => ({ key: r.key ?? '', title: r.title ?? '' })).filter((r) => r.key && r.title)
    : [];
}

function parseProfileStats(raw: RawFriendProfileStats | undefined): FriendProfileStats {
  const shared = typeof raw?.shared_pub_count === 'number' ? raw.shared_pub_count : 0;
  return {
    sharedPubCount: shared,
    nightsTogether: typeof raw?.nights_together === 'number' ? raw.nights_together : shared,
    lastSharedAt: raw?.last_shared_at ?? null,
    lastPubName: raw?.last_pub_name ?? '',
    streakWeeks: typeof raw?.streak_weeks === 'number' ? raw.streak_weeks : 0,
    rituals: parseRituals(raw?.rituals),
  };
}

function parseRecentTogether(raw: RawRecentTogether): RecentTogether {
  return {
    pubName: raw.pub_name ?? '',
    cacheKey: raw.cache_key ?? '',
    at: raw.at ?? '',
  };
}

function parseFriendshipStatus(raw: RawFriendProfileDetail): FriendshipStatus {
  const value = raw.friendship_status;
  if (
    value === 'none' ||
    value === 'outgoing_pending' ||
    value === 'incoming_pending' ||
    value === 'accepted'
  ) {
    return value;
  }
  // Older backend without the field: only accepted friends could reach this
  // payload at all, so is_friend fully determines the status.
  return raw.is_friend === true ? 'accepted' : 'none';
}

function parsePublicStats(raw: RawPublicProfileStats | null | undefined): PublicProfileStats | null {
  if (!raw) return null;
  return {
    totalBeers: typeof raw.total_beers === 'number' ? raw.total_beers : 0,
    distinctPubs: typeof raw.distinct_pubs === 'number' ? raw.distinct_pubs : 0,
    mapperLevel: typeof raw.mapper_level === 'number' ? raw.mapper_level : 1,
    mapperTitle: raw.mapper_title ?? '',
    mapperXp: typeof raw.mapper_xp === 'number' ? raw.mapper_xp : 0,
  };
}

function parseProfileDetail(raw: RawFriendProfileDetail): FriendProfileDetail {
  return {
    profile: parseProfile(raw.profile),
    isFriend: raw.is_friend === true,
    friendshipId: raw.friendship_id ?? null,
    stats: parseProfileStats(raw.stats),
    liveActivity: raw.live_activity ? parseActivity(raw.live_activity) : null,
    plan: raw.plan ? parseActivity(raw.plan) : null,
    recentTogether: Array.isArray(raw.recent_together)
      ? raw.recent_together.map(parseRecentTogether)
      : [],
    latestBeers: Array.isArray(raw.latest_beers)
      ? raw.latest_beers.map((item) => parseBeerCheckIn(item as Parameters<typeof parseBeerCheckIn>[0]))
      : [],
    blocked: raw.blocked === true,
    friendshipStatus: parseFriendshipStatus(raw),
    incomingRequestId: raw.incoming_request_id ?? null,
    publicStats: parsePublicStats(raw.public_stats),
    achievements: raw.achievements ? parseAchievementsBlock(raw.achievements) : null,
  };
}

function extractError(data: unknown, status: number): FriendActionError {
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
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; result: FriendActionError }> {
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
      await handleUnauthorized(session, path);
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
  // Capture the account-boundary generation BEFORE the request begins (and thus
  // before requestJson captures this account's bearer). If a logout/delete clears
  // the snapshot while this fetch is in flight, the write below is dropped instead
  // of re-persisting the previous account's graph under the next account.
  const generation = snapshotGeneration();
  const res = await requestJson('/v1/friends', { signal });
  if (!res.ok) return null;
  const rawStats = (res.data.friend_stats ?? {}) as Record<string, RawFriendStats>;
  const friendStats: Record<string, FriendStats> = {};
  for (const [id, stats] of Object.entries(rawStats)) {
    friendStats[id] = parseStats(stats);
  }
  const dashboard: FriendsDashboard = {
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
    plans: Array.isArray(res.data.plans)
      ? (res.data.plans as RawFriendActivity[]).map(parseActivity)
      : [],
    myPlan: res.data.my_plan ? parseActivity(res.data.my_plan as RawFriendActivity) : null,
    presence: parsePresenceList(res.data.presence),
    myPresence: parseMyPresence(res.data.my_presence),
    blockedIds: Array.isArray(res.data.blocked_ids)
      ? (res.data.blocked_ids as unknown[]).filter((id): id is string => typeof id === 'string')
      : [],
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
  // Persist the freshly-loaded graph so an offline cold start can hydrate it
  // behind the OfflineBanner (§H2). Fire-and-forget; never blocks the return. The
  // generation guard drops the write if an account boundary was crossed mid-fetch.
  void saveFriendsDashboardSnapshot(dashboard, generation);
  return dashboard;
}

/**
 * Cheap poll slice for the bounded refresh loop (§D2). Returns just the live
 * surfaces without the 365-day shared-stats / leaderboard work. Falls back to the
 * full dashboard when the endpoint 404s (older backend that predates §D2).
 */
export async function fetchFriendsLive(signal?: AbortSignal): Promise<FriendsLiveSlice | null> {
  const res = await requestJson('/v1/friends/live', { signal });
  if (!res.ok) {
    if (res.result.code === 'http_404') {
      const dashboard = await fetchFriendsDashboard(signal);
      if (!dashboard) return null;
      return {
        activeFriends: dashboard.activeFriends,
        myActiveActivity: dashboard.myActiveActivity,
        plans: dashboard.plans,
        myPlan: dashboard.myPlan,
        presence: dashboard.presence,
        myPresence: dashboard.myPresence,
        incomingCount: dashboard.incomingRequests.length,
        unreadCount: dashboard.unreadCount,
        serverTime: null,
      };
    }
    return null;
  }
  return {
    activeFriends: Array.isArray(res.data.active_friends)
      ? (res.data.active_friends as RawFriendActivity[]).map(parseActivity)
      : [],
    myActiveActivity: res.data.my_active_activity
      ? parseActivity(res.data.my_active_activity as RawFriendActivity)
      : null,
    plans: Array.isArray(res.data.plans)
      ? (res.data.plans as RawFriendActivity[]).map(parseActivity)
      : [],
    myPlan: res.data.my_plan ? parseActivity(res.data.my_plan as RawFriendActivity) : null,
    presence: parsePresenceList(res.data.presence),
    myPresence: parseMyPresence(res.data.my_presence),
    incomingCount: typeof res.data.incoming_count === 'number' ? res.data.incoming_count : 0,
    unreadCount: typeof res.data.unread_count === 'number' ? res.data.unread_count : 0,
    serverTime: typeof res.data.server_time === 'string' ? res.data.server_time : null,
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
  inviteCode?: string;
}): Promise<FriendActionResult> {
  // Exactly one path is sent; invite code wins, then account id, then nickname —
  // matching the backend's mutually-exclusive `validate` (contract §A3).
  const body = params.inviteCode
    ? { invite_code: params.inviteCode }
    : params.accountId
      ? { target_account_id: params.accountId }
      : { nickname: params.nickname ?? '' };
  const res = await requestJson('/v1/friends/requests', { method: 'POST', body });
  return res.ok ? { ok: true } : res.result;
}

/** My reusable invite code + deep link, minting one if none is active (§A1). */
export async function fetchFriendInviteCode(signal?: AbortSignal): Promise<FriendInvite | null> {
  const res = await requestJson('/v1/friends/invite', { signal });
  if (!res.ok) return null;
  const raw = res.data as RawFriendInvite;
  if (typeof raw.code !== 'string' || raw.code.length === 0) return null;
  return {
    code: raw.code,
    url: raw.url ?? '',
    // Older deployed backends returned the unused napivo.app hostname. Build
    // the canonical URL locally so the mobile fix does not depend on deploy
    // ordering; the additive API response remains backwards-compatible.
    webUrl: buildFriendInviteWebUrl(raw.code),
    expiresAt: raw.expires_at ?? '',
  };
}

/** Resolve an invite code to its inviter for the claim screen, without sending (§A2). */
export async function resolveInviteCode(
  code: string,
  signal?: AbortSignal,
): Promise<InviteResolveResult> {
  const res = await requestJson(`/v1/friends/invite/${encodeURIComponent(code)}`, { signal });
  if (!res.ok) {
    // A 404 carries whether the code is unknown vs expired via its machine code.
    const expired = res.result.code === 'invite_expired';
    return { valid: false, expired, inviter: null };
  }
  const raw = res.data as RawInviteResolve;
  return {
    valid: raw.valid !== false,
    expired: raw.expired === true,
    inviter: raw.inviter ? parseProfile(raw.inviter) : null,
  };
}

/**
 * Create a scheduled plan ("Na čas") — a future pub-activity the party can RSVP
 * to (§B1). Live "Teď" broadcasts keep using {@link shareFriendPubActivity}.
 */
export async function createFriendPlan(
  pub: Pub,
  scheduledForISO: string,
  message?: string,
  clientId?: string,
  recipientIds?: string[],
): Promise<FriendActionResult> {
  const targetIds = recipientIds && recipientIds.length > 0 ? recipientIds : undefined;
  const res = await requestJson('/v1/friends/pub-activity', {
    method: 'POST',
    body: {
      client_id: clientId || generateUuidV4(),
      name: pub.name,
      lat: pub.lat,
      lng: pub.lng,
      city: pub.city ?? '',
      external_id: pub.id || '',
      message: message ?? '',
      scheduled_for: scheduledForISO,
      ...(targetIds ? { recipient_ids: targetIds } : {}),
    },
  });
  return res.ok ? { ok: true } : res.result;
}

/** One-tap "Na zdraví" reaction on an activity/feed row (§C1). Idempotent upsert. */
export async function reactToActivity(
  activityId: string,
  reaction: ReactionKind = 'cheers',
): Promise<FriendActionResult> {
  const res = await requestJson(
    `/v1/friends/pub-activity/${encodeURIComponent(activityId)}/react`,
    { method: 'POST', body: { reaction } },
  );
  return res.ok ? { ok: true } : res.result;
}

/** Retract my reaction on an activity (§C2). Idempotent — a missing row still 2xx. */
export async function clearActivityReaction(activityId: string): Promise<FriendActionResult> {
  const res = await requestJson(
    `/v1/friends/pub-activity/${encodeURIComponent(activityId)}/react`,
    { method: 'DELETE' },
  );
  return res.ok ? { ok: true } : res.result;
}

/** Full friend profile (stats, live/plan, recent-together) for the pushed route (§F1). */
export async function fetchFriendProfile(
  accountId: string,
  signal?: AbortSignal,
): Promise<FriendProfileDetail | null> {
  const res = await requestJson(`/v1/friends/${encodeURIComponent(accountId)}`, { signal });
  if (!res.ok) return null;
  return parseProfileDetail(res.data as RawFriendProfileDetail);
}

/** Block an account: removes the friendship and filters them both ways (§G1). */
export async function blockFriend(accountId: string): Promise<FriendActionResult> {
  const res = await requestJson('/v1/friends/blocks', {
    method: 'POST',
    body: { account_id: accountId },
  });
  return res.ok ? { ok: true } : res.result;
}

/** Lift a block (§G2). Does not auto-refriend. Idempotent. */
export async function unblockFriend(accountId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/blocks/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  });
  return res.ok ? { ok: true } : res.result;
}

/**
 * Cancel an outgoing pending invite (§F5). Reuses the broadened
 * `DELETE /v1/friends/<id>` — the outgoing chip carries the recipient's id.
 */
export async function cancelFriendRequest(recipientAccountId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/${encodeURIComponent(recipientAccountId)}`, {
    method: 'DELETE',
  });
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

export async function shareFriendPubActivity(
  pub: Pub,
  message?: string,
  clientId?: string,
  recipientIds?: string[],
): Promise<FriendActionResult> {
  const now = new Date();
  const expires = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const targetIds = recipientIds && recipientIds.length > 0 ? recipientIds : undefined;
  const res = await requestJson('/v1/friends/pub-activity', {
    method: 'POST',
    body: {
      client_id: clientId || generateUuidV4(),
      name: pub.name,
      lat: pub.lat,
      lng: pub.lng,
      city: pub.city ?? '',
      external_id: pub.id || '',
      message: message ?? '',
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
      ...(targetIds ? { recipient_ids: targetIds } : {}),
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
  if (patch.shareDrinksWithParta !== undefined) {
    body.share_drinks_with_parta = patch.shareDrinksWithParta;
  }
  const res = await requestJson('/v1/friends/settings', { method: 'PATCH', body });
  return res.ok ? { ok: true } : res.result;
}

export async function markFriendNotificationsRead(ids?: string[]): Promise<void> {
  await requestJson('/v1/friends/notifications/read', {
    method: 'POST',
    body: ids ? { ids } : {},
  });
}
