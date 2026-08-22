/**
 * Persisted snapshot of the last successful Parta dashboard (Parta 3.0 §H2).
 *
 * The social graph (friends, streak, leaderboard, live cards) is expensive to
 * refetch and useless when offline. On every successful `fetchFriendsDashboard`
 * we stash the already-parsed dashboard here; on mount FriendsScreen hydrates
 * from it BEFORE the network resolves, so an offline cold start shows the graph
 * behind the OfflineBanner instead of an empty tab.
 *
 * The blob is the user's social graph → sensitive. The storage key is registered
 * in `PRIVATE_STORAGE_KEYS` (privateAccountData.ts) so logout / account-switch
 * wipes it alongside the queues. Best-effort throughout: a failed read/write just
 * means the app falls back to a network fetch.
 */

import AsyncStorage, { privateAccountCleanupStorage } from './privateAccountStorage';

import type {
  FriendNotification,
  FriendPresence,
  FriendProfile,
  FriendPubActivity,
  Friendship,
  FriendsDashboard,
  LeaderboardEntry,
  MyPresence,
} from './friendsClient';

export const FRIENDS_DASHBOARD_SNAPSHOT_KEY = 'na-pivo-friends-dashboard';

interface StoredSnapshot {
  savedAt: number;
  dashboard: FriendsDashboard;
}

export interface FriendsDashboardSnapshot {
  /** Epoch ms when the snapshot was written — lets the UI show a "stale" cue. */
  savedAt: number;
  dashboard: FriendsDashboard;
}

/**
 * Account-boundary generation. `clearFriendsDashboardSnapshot()` bumps it (called
 * from clearLocalPrivateAccountData on logout / delete / password reset). A
 * dashboard fetch captures the generation via {@link snapshotGeneration} BEFORE it
 * begins; its fire-and-forget write is dropped if the generation moved in the
 * meantime, so an in-flight fetch that resolves after the session rotates cannot
 * re-persist the previous account's social graph under the next account. This
 * mirrors the queue `abortInFlight` guard (see createQueue.ts).
 */
let boundaryGeneration = 0;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function nullableCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function hour(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : fallback;
}

function profile(value: unknown): FriendProfile | null {
  const row = record(value);
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  return {
    id: row.id,
    nickname: nullableString(row.nickname),
    displayName: string(row.displayName),
    avatarUrl: nullableString(row.avatarUrl),
    isPublic: row.isPublic !== false,
  };
}

function profiles(value: unknown): FriendProfile[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = profile(item);
        return parsed ? [parsed] : [];
      })
    : [];
}

function friendship(value: unknown): Friendship | null {
  const row = record(value);
  const requester = profile(row?.requester);
  const recipient = profile(row?.recipient);
  if (!row || typeof row.id !== 'string' || !row.id || !requester || !recipient) return null;
  const status = row.status === 'accepted' || row.status === 'declined' ? row.status : 'pending';
  return {
    id: row.id,
    status,
    requester,
    recipient,
    requestedAt: string(row.requestedAt),
    respondedAt: nullableString(row.respondedAt),
    updatedAt: string(row.updatedAt),
  };
}

function friendships(value: unknown): Friendship[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = friendship(item);
        return parsed ? [parsed] : [];
      })
    : [];
}

function activity(value: unknown): FriendPubActivity | null {
  const row = record(value);
  const account = profile(row?.account);
  if (!row || typeof row.id !== 'string' || !row.id || !account) return null;
  const responses = record(row.responses);
  const reactions = record(row.reactions);
  return {
    id: row.id,
    account,
    cacheKey: string(row.cacheKey),
    name: string(row.name),
    city: string(row.city),
    externalId: string(row.externalId),
    message: string(row.message),
    startedAt: string(row.startedAt),
    expiresAt: string(row.expiresAt),
    active: row.active !== false,
    createdAt: string(row.createdAt),
    updatedAt: string(row.updatedAt),
    responses: {
      going: count(responses?.going),
      maybe: count(responses?.maybe),
      cant: count(responses?.cant),
      goingProfiles: profiles(responses?.goingProfiles),
    },
    myResponse:
      row.myResponse === 'going' || row.myResponse === 'maybe' || row.myResponse === 'cant'
        ? row.myResponse
        : null,
    kind: row.kind === 'plan' ? 'plan' : 'live',
    scheduledFor: nullableString(row.scheduledFor),
    reactions: { cheers: count(reactions?.cheers) },
    myReaction: row.myReaction === 'cheers' ? 'cheers' : null,
  };
}

function activities(value: unknown): FriendPubActivity[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = activity(item);
        return parsed ? [parsed] : [];
      })
    : [];
}

function presence(value: unknown, mine: false): FriendPresence | null;
function presence(value: unknown, mine: true): MyPresence | null;
function presence(value: unknown, mine: boolean): FriendPresence | MyPresence | null {
  const row = record(value);
  const account = profile(row?.account);
  if (!row || !account) return null;
  const parsed: FriendPresence = {
    account,
    pubName: string(row.pubName),
    pubCity: string(row.pubCity),
    cacheKey: string(row.cacheKey),
    lat:
      typeof row.lat === 'number' && Number.isFinite(row.lat) && row.lat >= -90 && row.lat <= 90
        ? row.lat
        : null,
    lng:
      typeof row.lng === 'number' && Number.isFinite(row.lng) && row.lng >= -180 && row.lng <= 180
        ? row.lng
        : null,
    since: string(row.since),
    lastSeenAt: string(row.lastSeenAt, string(row.since)),
    beers: count(row.beers),
    lastDrinkName: string(row.lastDrinkName),
    activityId: nullableString(row.activityId),
  };
  return mine ? { ...parsed, visibleToParta: row.visibleToParta !== false } : parsed;
}

function notification(value: unknown): FriendNotification | null {
  const row = record(value);
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  return {
    id: row.id,
    kind: typeof row.kind === 'string' && row.kind ? row.kind : 'friend_at_pub',
    title: string(row.title),
    body: string(row.body),
    actor: row.actor == null ? null : profile(row.actor),
    friendshipId: nullableString(row.friendshipId),
    activityId: nullableString(row.activityId),
    pubCacheKey: string(row.pubCacheKey),
    pubName: string(row.pubName),
    readAt: nullableString(row.readAt),
    createdAt: string(row.createdAt),
  };
}

function leaderboardEntry(value: unknown): LeaderboardEntry | null {
  const row = record(value);
  const account = profile(row?.account);
  if (!row || !account) return null;
  return {
    account,
    visits30d: count(row.visits30d),
    sharedCount: count(row.sharedCount),
    beers30d: nullableCount(row.beers30d),
    isMe: row.isMe === true,
  };
}

function sanitizeDashboard(value: unknown): FriendsDashboard | null {
  const row = record(value);
  if (!row) return null;
  const friendStats: FriendsDashboard['friendStats'] = {};
  const rawStats = record(row.friendStats);
  for (const [id, value] of Object.entries(rawStats ?? {})) {
    const stats = record(value);
    if (!id || !stats) continue;
    friendStats[id] = {
      sharedPubCount: count(stats.sharedPubCount),
      lastSharedAt: nullableString(stats.lastSharedAt),
      lastPubName: string(stats.lastPubName),
      rituals: Array.isArray(stats.rituals)
        ? stats.rituals.flatMap((item) => {
            const ritual = record(item);
            return ritual && typeof ritual.key === 'string' && ritual.key && typeof ritual.title === 'string' && ritual.title
              ? [{ key: ritual.key, title: ritual.title }]
              : [];
          })
        : [],
    };
  }
  const settings = record(row.settings);
  const streak = record(row.streak);
  const myActiveActivity = activity(row.myActiveActivity);
  const myPlan = activity(row.myPlan);
  const myPresence = presence(row.myPresence, true);
  return {
    friends: profiles(row.friends),
    friendStats,
    incomingRequests: friendships(row.incomingRequests),
    outgoingRequests: friendships(row.outgoingRequests),
    following: Array.isArray(row.following)
      ? row.following.flatMap((item) => {
          const parsed = profile(item);
          const raw = record(item);
          return parsed && raw ? [{ ...parsed, lastDrink: nullableString(raw.lastDrink) }] : [];
        })
      : [],
    followersCount: count(row.followersCount),
    activeFriends: activities(row.activeFriends),
    myActiveActivity,
    plans: activities(row.plans),
    myPlan,
    presence: Array.isArray(row.presence)
      ? row.presence.flatMap((item) => {
          const parsed = presence(item, false);
          return parsed ? [parsed] : [];
        })
      : [],
    myPresence,
    blockedIds: Array.isArray(row.blockedIds)
      ? row.blockedIds.filter((id): id is string => typeof id === 'string' && !!id)
      : [],
    settings: {
      ghostMode: settings?.ghostMode === true,
      quietHoursEnabled: settings?.quietHoursEnabled !== false,
      quietHoursStart: hour(settings?.quietHoursStart, 23),
      quietHoursEnd: hour(settings?.quietHoursEnd, 9),
      shareDrinksWithParta: settings?.shareDrinksWithParta !== false,
    },
    streak: {
      currentWeeks: count(streak?.currentWeeks),
      thisWeekLit: streak?.thisWeekLit === true,
    },
    leaderboard: Array.isArray(row.leaderboard)
      ? row.leaderboard.flatMap((item) => {
          const parsed = leaderboardEntry(item);
          return parsed ? [parsed] : [];
        })
      : [],
    notifications: Array.isArray(row.notifications)
      ? row.notifications.flatMap((item) => {
          const parsed = notification(item);
          return parsed ? [parsed] : [];
        })
      : [],
    unreadCount: count(row.unreadCount),
  };
}

/** The current account-boundary generation, captured before a dashboard fetch. */
export function snapshotGeneration(): number {
  return boundaryGeneration;
}

/**
 * Persist the latest dashboard. Never throws. `generation` is the value
 * {@link snapshotGeneration} returned before the fetch started; the write is
 * suppressed (and any blob that raced in is removed) once an account-boundary
 * clear has bumped the generation.
 */
export async function saveFriendsDashboardSnapshot(
  dashboard: FriendsDashboard,
  generation: number,
): Promise<void> {
  if (generation !== boundaryGeneration) return;
  try {
    const payload: StoredSnapshot = { savedAt: Date.now(), dashboard };
    await AsyncStorage.setItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY, JSON.stringify(payload));
    // A boundary clear that landed while we were writing would otherwise leave our
    // just-written blob behind — undo it if the generation moved mid-write.
    if (generation !== boundaryGeneration) {
      await AsyncStorage.removeItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY);
    }
  } catch {
    // Snapshot is a convenience cache; a write failure just means no offline seed.
  }
}

/** Load the last persisted dashboard, or null when absent / unreadable. */
export async function loadFriendsDashboardSnapshot(): Promise<FriendsDashboardSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot>;
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt) ||
      parsed.savedAt <= 0
    ) return null;
    const dashboard = sanitizeDashboard(parsed.dashboard);
    if (!dashboard) return null;
    return {
      savedAt: parsed.savedAt,
      dashboard,
    };
  } catch {
    return null;
  }
}

/**
 * Drop the persisted snapshot at an account boundary. Bumps the generation FIRST
 * so any in-flight dashboard fetch's pending write is suppressed rather than
 * re-creating the file after the session rotates. Never throws.
 */
export async function clearFriendsDashboardSnapshot(): Promise<void> {
  boundaryGeneration += 1;
  try {
    await privateAccountCleanupStorage.removeItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY);
  } catch {
    // Nothing to do — the write guard above already blocks a stale re-persist.
  }
}
