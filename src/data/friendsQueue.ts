/**
 * Persistent retry queue for Parta write actions (Parta 3.0 §H1).
 *
 * RSVP, "Na zdraví" reactions, live/plan broadcasts, broadcast-end and friend
 * requests are all best-effort POST/DELETEs. When one fails (offline bar wifi,
 * account hiccup, timeout, 5xx, 429, dormant backend) the optimistic UI has
 * already flipped, so the action must survive to a later flush. This queue
 * persists every op to AsyncStorage BEFORE the first send and retries on launch /
 * foreground, mirroring visitsQueue/drinksQueue.
 *
 * Each op is *state*, not an event: only the LATEST op per composite key matters,
 * so enqueuing collapses onto that key (last write wins). Keys keep distinct
 * actions on the same activity from colliding:
 *   - rsvp:<activityId>   → respond / clear response
 *   - cheer:<activityId>  → react / clear reaction
 *   - act:<clientId>      → live-or-plan broadcast, and its later end (supersedes)
 *   - req:<identity>      → a friend request (invite code / account id / nickname)
 *
 * Flush keep/drop rule (shared mobile retry contract):
 *   - 'ok' (2xx)              → reached backend → drop.
 *   - 'permanent-error' (4xx) → will never succeed → drop.
 *   - 'retry' (network/5xx/429/401/dormant) → keep for the next flush.
 */

import {
  clearActivityReaction,
  clearActivityResponse,
  createPartyEvening,
  createFriendPlan,
  endPartyEvening,
  endFriendPubActivity,
  joinPartyEvening,
  leavePartyEvening,
  reactToActivity,
  respondToActivity,
  sendFriendRequest,
  sharePartyEveningDrink,
  shareFriendPubActivity,
  type ActivityResponseKind,
  type FriendActionError,
  type FriendActionResult,
} from './friendsClient';
import { createQueueStorage, createQueueLock, createCoalescingFlush } from './createQueue';
import type { QueueSyncResult } from './apiFetch';
import type { Pub } from './pubs';

const STORAGE_KEY = 'na-pivo-friends-queue';
/** Hard cap — only bites with a very long offline backlog, where dropping the
 *  oldest beats unbounded growth. */
const MAX_QUEUE_LENGTH = 500;

/** Pub subset broadcast to the party (chosen target, not raw device GPS). */
interface ActivityPayload {
  pub: Pub;
  message?: string;
  /** ISO time for a plan ("Na čas"); absent/null → a live "Teď" broadcast. */
  scheduledFor?: string | null;
  /** Optional explicit audience; absent keeps legacy "all friends" fanout. */
  recipientIds?: string[];
}

/** One pending Parta write, keyed (and deduped) by {@link dedupKey}. */
export type FriendQueueItem =
  | { op: 'rsvp'; activityId: string; response: ActivityResponseKind }
  | { op: 'rsvp-clear'; activityId: string }
  | { op: 'cheer'; activityId: string }
  | { op: 'cheer-clear'; activityId: string }
  | { op: 'activity'; clientId: string; payload: ActivityPayload }
  | { op: 'end'; clientId: string; activityId?: string }
  | { op: 'request'; key: string; inviteCode?: string; accountId?: string; nickname?: string }
  | {
      op: 'party-create';
      clientId: string;
      code: string;
      pubName: string;
      pubCity?: string;
      startedAt: string;
    }
  | { op: 'party-join'; code: string }
  | { op: 'party-leave'; code: string }
  | { op: 'party-end'; code: string }
  | {
      op: 'party-drink';
      code: string;
      clientId: string;
      beerName: string;
      quantity: number;
      sharedAt: string;
    };

/**
 * Composite dedup key: the SAME key means last-write-wins. `act:<clientId>` is
 * shared by `activity` and its `end` so ending supersedes a not-yet-synced
 * broadcast (contract §8.2).
 */
function dedupKey(item: FriendQueueItem): string {
  switch (item.op) {
    case 'rsvp':
    case 'rsvp-clear':
      return `rsvp:${item.activityId}`;
    case 'cheer':
    case 'cheer-clear':
      return `cheer:${item.activityId}`;
    case 'activity':
    case 'end':
      return `act:${item.clientId}`;
    case 'request':
      return `req:${item.key}`;
    case 'party-create':
      return `party-create:${item.clientId}`;
    case 'party-join':
    case 'party-leave':
      return `party-member:${item.code}`;
    case 'party-end':
      return `party-end:${item.code}`;
    case 'party-drink':
      return `party-drink:${item.clientId}`;
  }
}

function isPub(value: unknown): value is Pub {
  const p = value as Pub;
  return (
    !!p &&
    typeof p.name === 'string' &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number'
  );
}

function isQueueItem(value: unknown): value is FriendQueueItem {
  const i = value as FriendQueueItem;
  if (!i || typeof i.op !== 'string') return false;
  switch (i.op) {
    case 'rsvp':
      return typeof i.activityId === 'string' && (i.response === 'going' || i.response === 'maybe' || i.response === 'cant');
    case 'rsvp-clear':
    case 'cheer':
    case 'cheer-clear':
      return typeof (i as { activityId?: unknown }).activityId === 'string';
    case 'activity':
      return (
        typeof i.clientId === 'string' &&
        isPub((i as { payload?: ActivityPayload }).payload?.pub) &&
        ((i as { payload?: ActivityPayload }).payload?.recipientIds === undefined ||
          Array.isArray((i as { payload?: ActivityPayload }).payload?.recipientIds))
      );
    case 'end':
      return typeof i.clientId === 'string';
    case 'request':
      return (
        typeof i.key === 'string' &&
        (typeof i.inviteCode === 'string' ||
          typeof i.accountId === 'string' ||
          typeof i.nickname === 'string')
      );
    case 'party-create':
      return (
        typeof i.clientId === 'string' &&
        typeof i.code === 'string' &&
        typeof i.pubName === 'string' &&
        typeof i.startedAt === 'string'
      );
    case 'party-join':
    case 'party-leave':
    case 'party-end':
      return typeof i.code === 'string';
    case 'party-drink':
      return (
        typeof i.code === 'string' &&
        typeof i.clientId === 'string' &&
        typeof i.beerName === 'string' &&
        typeof i.quantity === 'number' &&
        typeof i.sharedAt === 'string'
      );
    default:
      return false;
  }
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<FriendQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);

/** Serializes only AsyncStorage mutations; network delivery runs outside so a
 *  slow/offline flush never blocks a fresh optimistic action from persisting. */
const runMutation = createQueueLock();

/**
 * Map a client action result onto the three-state keep/drop outcome. `offline` /
 * `account` / `network` / `auth` (401 already cleared the cached account inside
 * requestJson) are transient → retry; a definitive 4xx (validation, gone,
 * not-friends, blocked, expired code) will never succeed → drop; 5xx / unknown
 * codes stay retryable.
 */
function classify(result: FriendActionResult): QueueSyncResult {
  if (result.ok) return 'ok';
  const code = result.code;
  if (code === 'offline' || code === 'account' || code === 'network' || code === 'auth') {
    return 'retry';
  }
  const httpMatch = /^http_(\d{3})$/.exec(code);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 401 || status === 429) return 'retry';
    if (status >= 400 && status < 500) return 'permanent-error';
    return 'retry';
  }
  // A server machine-code (not_friends, blocked, activity_not_found,
  // self_reaction, invite_expired, …) is a definitive 4xx rejection → drop.
  return 'permanent-error';
}

/**
 * Whether a failed direct write is transient (offline / network / 5xx / 429 /
 * account) and therefore worth queueing for a later flush, vs a hard 4xx reject
 * that should surface an error and revert the optimistic UI. Shared by the
 * compose + reaction surfaces so they route offline actions through the queue.
 */
export function isRetriableFriendError(result: FriendActionError): boolean {
  return classify(result) === 'retry';
}

async function deliver(item: FriendQueueItem): Promise<QueueSyncResult> {
  switch (item.op) {
    case 'rsvp':
      return classify(await respondToActivity(item.activityId, item.response));
    case 'rsvp-clear':
      return classify(await clearActivityResponse(item.activityId));
    case 'cheer':
      return classify(await reactToActivity(item.activityId, 'cheers'));
    case 'cheer-clear':
      return classify(await clearActivityReaction(item.activityId));
    case 'activity': {
      const { pub, message, scheduledFor } = item.payload;
      const result = scheduledFor
        ? await createFriendPlan(pub, scheduledFor, message, item.clientId, item.payload.recipientIds)
        : await shareFriendPubActivity(pub, message, item.clientId, item.payload.recipientIds);
      return classify(result);
    }
    case 'end':
      // No server id means the broadcast never synced (its pending upsert was
      // superseded locally by this end), so there is nothing to delete — drop.
      if (!item.activityId) return 'ok';
      return classify(await endFriendPubActivity(item.activityId));
    case 'request':
      return classify(
        await sendFriendRequest({
          inviteCode: item.inviteCode,
          accountId: item.accountId,
          nickname: item.nickname,
        }),
      );
    case 'party-create':
      return classify(
        await createPartyEvening({
          clientId: item.clientId,
          joinCode: item.code,
          pubName: item.pubName,
          pubCity: item.pubCity,
          startedAt: item.startedAt,
        }),
      );
    case 'party-join':
      return classify(await joinPartyEvening(item.code));
    case 'party-leave':
      return classify(await leavePartyEvening(item.code));
    case 'party-end':
      return classify(await endPartyEvening(item.code));
    case 'party-drink':
      return classify(
        await sharePartyEveningDrink(item.code, {
          clientId: item.clientId,
          beerName: item.beerName,
          quantity: item.quantity,
          sharedAt: item.sharedAt,
        }),
      );
  }
}

/** Stable content signature — object identity is lost across the JSON round-trip,
 *  so we compare a queued op to the one we attempted by value. */
function signature(item: FriendQueueItem): string {
  return JSON.stringify(item);
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  const blockedPartyCodes = new Set<string>();
  for (const item of queue) {
    // Stop before delivering the next op once an account-boundary clear has
    // aborted us, so a previous account's queued actions are never sent under the
    // session that replaces this one. (An op already in flight keeps the token it
    // captured before the boundary, so it still lands on the right account.)
    if (signal.aborted) break;
    if (
      'code' in item &&
      blockedPartyCodes.has(item.code) &&
      (item.op === 'party-drink' || item.op === 'party-end' || item.op === 'party-leave')
    ) {
      continue;
    }
    const key = dedupKey(item);
    attempted.set(key, signature(item));
    const result = await deliver(item);
    if (
      result === 'retry' &&
      (item.op === 'party-create' || item.op === 'party-join')
    ) {
      blockedPartyCodes.add(item.code);
    }
    if (result !== 'retry') settled.add(key);
  }

  await runMutation(async () => {
    const current = await loadQueue();
    const remaining = current.filter((item) => {
      const key = dedupKey(item);
      const sig = attempted.get(key);
      // Kept if it was never attempted, or a NEWER op landed for the key mid-flush
      // (different signature), or its attempt is still pending retry.
      if (sig === undefined || sig !== signature(item)) return true;
      return !settled.has(key);
    });
    await saveQueue(remaining);
  });
}

/**
 * Enqueue (and dedup by composite key) one Parta op, then immediately try to
 * flush the whole queue. A new op for a key REPLACES any pending op for the same
 * key (last write wins). Never throws.
 */
export async function enqueueFriendOp(item: FriendQueueItem): Promise<void> {
  const key = dedupKey(item);
  await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => dedupKey(existing) !== key);
    deduped.push(item);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  await flushFriendsQueue();
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

/** Drop all pending Parta ops without attempting delivery (account boundary). */
export function clearFriendsQueue(): Promise<void> {
  // Cancel any in-flight flush first: its network loop runs outside runMutation,
  // so without this it could keep sending the previous account's ops under the
  // session that replaces this one.
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}

/**
 * Retry all pending Parta ops. Call on launch and on foreground — both
 * fire-and-forget. Never throws. Trailing-edge coalesced (see
 * createCoalescingFlush): an op enqueued mid-flight is still delivered without
 * waiting for the next launch.
 */
export function flushFriendsQueue(): Promise<void> {
  return _flush();
}
