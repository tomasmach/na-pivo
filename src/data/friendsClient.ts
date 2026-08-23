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
import { parseStatsTimeline, type RemoteStatsTimeline } from './statsClient';
import { notifyUgcConsentRequiredFromResponse, ugcPolicyHeaders } from './ugcConsent';

const REQUEST_TIMEOUT_MS = 9000;

export interface FriendProfile {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
  isPublic: boolean;
}

export type FriendSuggestionReason =
  | { kind: 'shared_pubs'; count: number }
  | { kind: 'mutual_friends'; count: number };

export interface FriendSuggestion extends FriendProfile {
  suggestionReason: FriendSuggestionReason;
}

/**
 * Someone I follow. One-way, so this shape deliberately carries no presence,
 * geohash or live state — only what they publish. Older backends don't send
 * the list at all, which reads as "I follow nobody" rather than as an error.
 */
export interface FollowedProfile extends FriendProfile {
  /** Last beer they logged publicly, or null when they've been quiet. */
  lastDrink: string | null;
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
  /** Beers in the same 30-day window. Null on an older backend without it. */
  beers30d: number | null;
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
  /**
   * Still parsed because versions in the store depend on them; nothing in the
   * app creates one any more (a friendship comes from sharing a table).
   */
  incomingRequests: Friendship[];
  outgoingRequests: Friendship[];
  /** People I follow one-way. Empty on older backends. */
  following: FollowedProfile[];
  /** How many people follow me. 0 on older backends. */
  followersCount: number;
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
  /** Pagination metadata from the dashboard endpoint; absent on older backends. */
  relationshipPage?: FriendsRelationshipPage;
}

/** Pagination slice of the friends dashboard payload (additive, older backends omit it). */
export interface FriendsRelationshipPage {
  friendsCount: number;
  followingCount: number;
  nextCursor: number | null;
  followingNextCursor: number | null;
  friendsTruncated: boolean;
  followingTruncated: boolean;
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
  /** Aggregates over nights this viewer may already see; absent on older backends. */
  publishedTimeline: RemoteStatsTimeline | null;
  /** Whether I follow them one-way. False on older backends. */
  isFollowing: boolean;
}

/** The failure half of {@link FriendActionResult}. */
export interface FriendActionError {
  ok: false;
  code: string;
  detail: string;
}

/**
 * Additive success field: an invite redemption can be accepted immediately
 * (`status: 'accepted'`); every other success stays a plain `{ ok: true }`.
 */
export type FriendActionResult = { ok: true; status?: 'accepted' } | FriendActionError;

interface RawFriendProfile {
  id?: string;
  nickname?: string | null;
  display_name?: string;
  avatar_url?: string | null;
  is_public?: boolean;
  suggestion_reason?: {
    kind?: unknown;
    count?: unknown;
  };
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
  beers_30d?: number;
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

interface RawFollowedProfile extends RawFriendProfile {
  last_drink?: string | null;
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
  published_timeline?: unknown;
  is_following?: boolean;
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

function parseFollowed(raw: RawFollowedProfile | undefined | null): FollowedProfile {
  return {
    ...parseProfile(raw),
    lastDrink: typeof raw?.last_drink === 'string' && raw.last_drink.length > 0 ? raw.last_drink : null,
  };
}

function parseSuggestion(raw: RawFriendProfile): FriendSuggestion | null {
  const reason = raw.suggestion_reason;
  if (
    (reason?.kind !== 'shared_pubs' && reason?.kind !== 'mutual_friends')
    || typeof reason.count !== 'number'
    || !Number.isFinite(reason.count)
    || reason.count < 1
  ) {
    return null;
  }
  return {
    ...parseProfile(raw),
    suggestionReason: {
      kind: reason.kind,
      count: Math.floor(reason.count),
    },
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
    beers30d: typeof raw.beers_30d === 'number' ? raw.beers_30d : null,
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
    publishedTimeline: parseStatsTimeline(raw.published_timeline),
    isFollowing: raw.is_following === true,
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
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    /** Authoring shared UGC (pub name, city, message, recipients) → consent-gated. */
    gatedUgc?: boolean;
  } = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; result: FriendActionError }> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'offline', detail: 'Server teď není dostupný.' } };
  }

  let session: AccountSession | null = null;
  try {
    session = await ensureAccount(options.signal);
  } catch {
    return { ok: false, result: { ok: false, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' } };
  }
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
    // The body is consumed exactly once. On a successful response an unparseable
    // or rejected read must flow to the outer catch (network) instead of
    // degrading to a false success; only non-ok bodies tolerate garbage JSON.
    let data: Record<string, unknown> = {};
    if (resp.ok) {
      const text = await resp.text();
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } else {
      try {
        const text = await resp.text();
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }
    }
    if (!resp.ok && options.gatedUgc) notifyUgcConsentRequiredFromResponse(resp.status, data);
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

function parseNonnegativeInt(value: unknown): number | null {
  if (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && Number.isInteger(value)
  ) {
    return value;
  }
  return null;
}

function parseRelationshipPage(
  data: Record<string, unknown>,
  friends: FriendProfile[],
  following: FollowedProfile[],
): FriendsRelationshipPage {
  const nextCursor = parseNonnegativeInt(data.next_cursor);
  const followingNextCursor = parseNonnegativeInt(data.following_next_cursor);
  return {
    friendsCount: parseNonnegativeInt(data.friends_count) ?? friends.length,
    followingCount: parseNonnegativeInt(data.following_count) ?? following.length,
    nextCursor,
    followingNextCursor,
    friendsTruncated: typeof data.friends_truncated === 'boolean'
      ? data.friends_truncated
      : nextCursor !== null,
    followingTruncated: typeof data.following_truncated === 'boolean'
      ? data.following_truncated
      : followingNextCursor !== null,
  };
}

function parseFriendsDashboard(data: Record<string, unknown>): FriendsDashboard {
  const friends: FriendProfile[] = Array.isArray(data.friends)
    ? (data.friends as RawFriendProfile[]).map(parseProfile)
    : [];
  const following: FollowedProfile[] = Array.isArray(data.following)
    ? (data.following as RawFollowedProfile[]).map(parseFollowed)
    : [];
  const rawStats = (data.friend_stats ?? {}) as Record<string, RawFriendStats>;
  const friendStats: Record<string, FriendStats> = {};
  for (const [id, stats] of Object.entries(rawStats)) {
    friendStats[id] = parseStats(stats);
  }
  return {
    friends,
    friendStats,
    incomingRequests: Array.isArray(data.incoming_requests)
      ? (data.incoming_requests as RawFriendship[]).map(parseFriendship)
      : [],
    outgoingRequests: Array.isArray(data.outgoing_requests)
      ? (data.outgoing_requests as RawFriendship[]).map(parseFriendship)
      : [],
    following,
    followersCount: typeof data.followers_count === 'number' ? data.followers_count : 0,
    activeFriends: Array.isArray(data.active_friends)
      ? (data.active_friends as RawFriendActivity[]).map(parseActivity)
      : [],
    myActiveActivity: data.my_active_activity
      ? parseActivity(data.my_active_activity as RawFriendActivity)
      : null,
    plans: Array.isArray(data.plans)
      ? (data.plans as RawFriendActivity[]).map(parseActivity)
      : [],
    myPlan: data.my_plan ? parseActivity(data.my_plan as RawFriendActivity) : null,
    presence: parsePresenceList(data.presence),
    myPresence: parseMyPresence(data.my_presence),
    blockedIds: Array.isArray(data.blocked_ids)
      ? (data.blocked_ids as unknown[]).filter((id): id is string => typeof id === 'string')
      : [],
    settings: parseSocialSettings(data.settings as RawFriendSocialSettings | undefined),
    streak: parseStreak(data.streak as RawFriendStreak | undefined),
    leaderboard: Array.isArray(data.leaderboard)
      ? (data.leaderboard as RawLeaderboardEntry[]).map(parseLeaderboardEntry)
      : [],
    notifications: Array.isArray(data.notifications)
      ? (data.notifications as RawFriendNotification[]).map(parseNotification)
      : [],
    unreadCount: typeof data.unread_count === 'number' ? data.unread_count : 0,
    relationshipPage: parseRelationshipPage(data, friends, following),
  };
}

export async function fetchFriendsDashboard(signal?: AbortSignal): Promise<FriendsDashboard | null> {
  // Capture the account-boundary generation BEFORE the request begins (and thus
  // before requestJson captures this account's bearer). If a logout/delete clears
  // the snapshot while this fetch is in flight, the write below is dropped instead
  // of re-persisting the previous account's graph under the next account.
  const generation = snapshotGeneration();
  const res = await requestJson('/v1/friends?limit=100', { signal });
  // Fail closed: if the account boundary moved while this fetch was in flight,
  // the response belongs to the previous account — never parse or return it.
  if (!res.ok || snapshotGeneration() !== generation) return null;
  const dashboard = parseFriendsDashboard(res.data);
  // Persist the freshly-loaded graph so an offline cold start can hydrate it
  // behind the OfflineBanner (§H2). Fire-and-forget; never blocks the return. The
  // generation guard drops the write if an account boundary was crossed mid-fetch.
  void saveFriendsDashboardSnapshot(dashboard, generation);
  return dashboard;
}

/** Append page-only rows after current ones; a repeated id takes the page row. */
function mergeRowsById<T extends { id: string }>(currentRows: T[], pageRows: T[]): T[] {
  const pageById = new Map(pageRows.map((row) => [row.id, row]));
  const known = new Set(currentRows.map((row) => row.id));
  const merged = currentRows.map((row) => pageById.get(row.id) ?? row);
  for (const row of pageRows) {
    if (!known.has(row.id)) {
      known.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

/**
 * Fold one paginated slice into the loaded dashboard. Branches the CURRENT
 * metadata marks complete stay untouched (a backend that resent page 1 must not
 * shrink them); only still-truncated branches grow. Live surfaces (presence,
 * activities, settings…) are carried over by reference — pages carry none.
 */
export function mergeFriendsDashboardPage(
  current: FriendsDashboard,
  page: FriendsDashboard,
): FriendsDashboard {
  const currentMeta = current.relationshipPage;
  const pageMeta = page.relationshipPage;
  const friendsAdvances = currentMeta?.friendsTruncated ?? false;
  const followingAdvances = currentMeta?.followingTruncated ?? false;
  const meta: FriendsRelationshipPage | undefined =
    !currentMeta || !pageMeta
      ? pageMeta ?? currentMeta
      : {
          friendsCount: friendsAdvances ? pageMeta.friendsCount : currentMeta.friendsCount,
          followingCount: followingAdvances ? pageMeta.followingCount : currentMeta.followingCount,
          nextCursor: friendsAdvances ? pageMeta.nextCursor : currentMeta.nextCursor,
          followingNextCursor: followingAdvances
            ? pageMeta.followingNextCursor
            : currentMeta.followingNextCursor,
          friendsTruncated: friendsAdvances ? pageMeta.friendsTruncated : currentMeta.friendsTruncated,
          followingTruncated: followingAdvances
            ? pageMeta.followingTruncated
            : currentMeta.followingTruncated,
        };
  return {
    friends: friendsAdvances ? mergeRowsById(current.friends, page.friends) : current.friends,
    following: followingAdvances
      ? mergeRowsById(current.following, page.following)
      : current.following,
    friendStats: friendsAdvances ? { ...current.friendStats, ...page.friendStats } : current.friendStats,
    incomingRequests: friendsAdvances
      ? mergeRowsById(current.incomingRequests, page.incomingRequests)
      : current.incomingRequests,
    outgoingRequests: friendsAdvances
      ? mergeRowsById(current.outgoingRequests, page.outgoingRequests)
      : current.outgoingRequests,
    followersCount: current.followersCount,
    activeFriends: current.activeFriends,
    myActiveActivity: current.myActiveActivity,
    plans: current.plans,
    myPlan: current.myPlan,
    presence: current.presence,
    myPresence: current.myPresence,
    blockedIds: current.blockedIds,
    settings: current.settings,
    streak: current.streak,
    leaderboard: current.leaderboard,
    notifications: current.notifications,
    unreadCount: current.unreadCount,
    relationshipPage: meta,
  };
}

/**
 * Load the next page of a truncated relationship graph. Returns `current` as-is
 * when nothing is truncated, and null when a needed cursor is missing, the
 * request fails, or the account boundary moved mid-flight (so two accounts can
 * never merge their graphs).
 */
export async function fetchNextFriendsDashboardPage(
  current: FriendsDashboard,
  signal?: AbortSignal,
): Promise<FriendsDashboard | null> {
  const meta = current.relationshipPage;
  // Older backends never paginate; nothing to advance.
  if (!meta) return current;
  const friendsTruncated = meta.friendsTruncated;
  const followingTruncated = meta.followingTruncated;
  if (!friendsTruncated && !followingTruncated) return current;
  let path = '/v1/friends?limit=100';
  if (friendsTruncated) {
    if (meta.nextCursor === null) return null;
    path += `&cursor=${meta.nextCursor}`;
  }
  if (followingTruncated) {
    if (meta.followingNextCursor === null) return null;
    path += `&following_cursor=${meta.followingNextCursor}`;
  }
  const generation = snapshotGeneration();
  const res = await requestJson(path, { signal });
  if (!res.ok) return null;
  if (snapshotGeneration() !== generation) return null;
  const merged = mergeFriendsDashboardPage(current, parseFriendsDashboard(res.data));
  void saveFriendsDashboardSnapshot(merged, generation);
  return merged;
}

/**
 * Load the whole relationship graph by walking every truncation flag to
 * completion. Aborts with null on any failure, missing cursor, stalled progress
 * or account-boundary move; there is no page cap — the server's own cursors end
 * the walk.
 */
export async function fetchAllFriendsDashboard(signal?: AbortSignal): Promise<FriendsDashboard | null> {
  const generation = snapshotGeneration();
  let dashboard = await fetchFriendsDashboard(signal);
  if (!dashboard || snapshotGeneration() !== generation) return null;
  // Cursor-pair signatures already requested within THIS walk; a repeat means
  // the server is cycling us (e.g. 100→200→100), so stop before another request.
  const visitedSignatures = new Set<string>();
  for (;;) {
    const previousMeta = dashboard.relationshipPage;
    if (!previousMeta?.friendsTruncated && !previousMeta?.followingTruncated) break;
    const signature =
      `${previousMeta.friendsTruncated ? previousMeta.nextCursor : 'done'}`
      + `|${previousMeta.followingTruncated ? previousMeta.followingNextCursor : 'done'}`;
    if (visitedSignatures.has(signature)) return null;
    visitedSignatures.add(signature);
    const friendsWasActive = previousMeta.friendsTruncated;
    const followingWasActive = previousMeta.followingTruncated;
    const previousSize = dashboard.friends.length + dashboard.following.length;
    const next = await fetchNextFriendsDashboardPage(dashboard, signal);
    if (!next || snapshotGeneration() !== generation) return null;
    // Pages can carry only pending/blocked rows, so loaded friend/following
    // counts may legitimately stall while the walk still advances.
    const nextMeta = next.relationshipPage;
    const cursorChanged =
      (friendsWasActive && nextMeta?.nextCursor !== previousMeta.nextCursor) ||
      (followingWasActive && nextMeta?.followingNextCursor !== previousMeta.followingNextCursor);
    const grew = next.friends.length + next.following.length > previousSize;
    const completed =
      (friendsWasActive && !(nextMeta?.friendsTruncated ?? false)) ||
      (followingWasActive && !(nextMeta?.followingTruncated ?? false));
    if (!cursorChanged && !grew && !completed) return null;
    dashboard = next;
  }
  void saveFriendsDashboardSnapshot(dashboard, generation);
  return dashboard;
}

/**
 * Cheap poll slice for the bounded refresh loop (§D2). Returns just the live
 * surfaces without the 365-day shared-stats / leaderboard work. Falls back to the
 * full dashboard when the endpoint 404s (older backend that predates §D2).
 */
export async function fetchFriendsLive(signal?: AbortSignal): Promise<FriendsLiveSlice | null> {
  const generation = snapshotGeneration();
  const res = await requestJson('/v1/friends/live', { signal });
  // Fail closed before reading the body or falling back: a boundary crossed
  // mid-request makes this response (and any dashboard fallback) prior-account data.
  if (snapshotGeneration() !== generation) return null;
  if (!res.ok) {
    if (res.result.code === 'http_404') {
      const dashboard = await fetchFriendsDashboard(signal);
      if (!dashboard || snapshotGeneration() !== generation) return null;
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

export async function fetchFriendSuggestions(signal?: AbortSignal): Promise<FriendSuggestion[] | null> {
  const res = await requestJson('/v1/friends/search?suggest=true', { signal });
  if (!res.ok) return null;
  return Array.isArray(res.data.results)
    ? (res.data.results as RawFriendProfile[])
        .map(parseSuggestion)
        .filter((profile): profile is FriendSuggestion => profile !== null)
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
  if (!res.ok) return res.result;
  // Additive: only an immediate invite acceptance carries a status; legacy and
  // pending responses stay a plain success so existing callers don't change.
  return res.data.status === 'accepted' ? { ok: true, status: 'accepted' } : { ok: true };
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
    gatedUgc: true,
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

/**
 * Follow someone one-way. Idempotent on the server, so a double tap while the
 * first request is still in flight is not an error the UI has to explain.
 */
export async function followAccount(accountId: string): Promise<FriendActionResult> {
  const res = await requestJson('/v1/follows', {
    method: 'POST',
    body: { account_id: accountId },
  });
  return res.ok ? { ok: true } : res.result;
}

export async function unfollowAccount(accountId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/follows/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
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
    gatedUgc: true,
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

/** Load only the current account's social privacy switches. */
export async function fetchFriendSettings(
  signal?: AbortSignal,
): Promise<FriendSocialSettings | null> {
  const res = await requestJson('/v1/friends/settings', { signal });
  return res.ok
    ? parseSocialSettings(res.data as RawFriendSocialSettings)
    : null;
}

export async function markFriendNotificationsRead(ids?: string[]): Promise<void> {
  await requestJson('/v1/friends/notifications/read', {
    method: 'POST',
    body: ids ? { ids } : {},
  });
}
