/**
 * Persistent retry queue for personal pub-rating sync.
 *
 * Each rating change (set verdict/tag/note, or clear) is a best-effort PUT/DELETE
 * via pubRatingsClient. When a send fails (offline, account hiccup, timeout,
 * 5xx, 429, dormant backend) the change would be lost while the local store has
 * already applied it. This queue persists every operation to AsyncStorage BEFORE
 * the first send and retries on each app launch / foreground, so a rating change
 * eventually reaches the backend.
 *
 * Difference from drinksQueue: drinks DON'T dedup (every beer is a distinct
 * event). Ratings DO — a rating is a piece of *state*, not an event, and only
 * the LATEST state for a pubKey matters. So enqueuing a new operation for a
 * pubKey REPLACES any pending operation for that same pubKey (last write wins).
 * This collapses rapid edits ("like" → "dislike" → cleared) into a single
 * delivery and keeps the queue tiny.
 *
 * Each queue item is one operation on one pubKey:
 *   - { op: 'upsert', pubKey, payload } → PUT the payload.
 *   - { op: 'delete', pubKey, payload } → PUT an empty timestamped tombstone.
 *
 * Flush keep/drop rule (matches the mobile retry contract):
 *   - 'ok' (2xx)              → reached backend → drop from queue.
 *   - 'permanent-error' (4xx) → will never succeed → drop from queue.
 *   - 'retry' (network/5xx/429/dormant) → keep for the next flush.
 */

import {
  submitRatingUpsert,
  type SubmitRatingResult,
  type WireRatingUpsert,
} from './pubRatingsClient';
import { createQueueStorage, createQueueLock } from './createQueue';

const STORAGE_KEY = 'na-pivo-pub-ratings-queue';
/** Hard cap — one item per pub, so this only bites with thousands of distinct
 *  rated pubs while the backend is unreachable; dropping the oldest beats
 *  unbounded growth. */
const MAX_QUEUE_LENGTH = 500;

/** One pending sync operation, keyed (and deduped) by pubKey. */
export type RatingQueueItem =
  | { op: 'upsert'; pubKey: string; payload: WireRatingUpsert }
  | { op: 'delete'; pubKey: string; payload: WireRatingUpsert };

function isRatingPayload(value: unknown): value is WireRatingUpsert {
  const p = value as WireRatingUpsert;
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    typeof p.updated_at === 'string'
  );
}

function isQueueItem(value: unknown): value is RatingQueueItem {
  const i = value as RatingQueueItem;
  if (!i || typeof i.pubKey !== 'string') return false;
  if (i.op === 'delete') return isRatingPayload((i as { payload?: unknown }).payload);
  if (i.op === 'upsert') {
    return isRatingPayload((i as { payload?: unknown }).payload);
  }
  return false;
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<RatingQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose items. */
const runLocked = createQueueLock();

async function deliver(item: RatingQueueItem): Promise<SubmitRatingResult> {
  // Deletes are timestamped tombstone PUTs (empty verdict/tag/note) so the
  // backend can apply the same last-write-wins conflict rule as normal upserts.
  return submitRatingUpsert(item.payload);
}

/** Pending tombstones that restore must not hydrate back into local state. */
export function getQueuedRatingDeletePubKeys(): Promise<Set<string>> {
  return runLocked(async () => {
    const queue = await loadQueue();
    return new Set(
      queue
        .filter((item) => item.op === 'delete')
        .map((item) => item.pubKey),
    );
  });
}

/** Stable content signature for an op, used to tell whether the queued op for a
 *  pubKey is still the SAME one we just attempted (object identity is lost across
 *  the AsyncStorage JSON round-trip, so we compare by value). */
function signature(item: RatingQueueItem): string {
  return JSON.stringify(item);
}

async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  // Snapshot the exact op (by content) we attempt per pubKey, plus its result.
  // We re-load after delivery so an edit that landed mid-flush (replacing the
  // pending op for a pubKey) is NOT clobbered: a key whose op content changed
  // under us is kept regardless of the stale result.
  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const item of queue) {
    attempted.set(item.pubKey, signature(item));
    const result = await deliver(item);
    if (result !== 'retry') settled.add(item.pubKey);
  }

  const current = await loadQueue();
  const remaining = current.filter((item) => {
    const sig = attempted.get(item.pubKey);
    // A different/newer op for this key arrived during the flush → keep it.
    if (sig === undefined || sig !== signature(item)) return true;
    return !settled.has(item.pubKey);
  });
  await saveQueue(remaining);
}

/**
 * Enqueue (and dedup) one rating operation, then immediately try to flush the
 * whole queue. A new operation for a pubKey REPLACES any pending operation for
 * that same pubKey (last write wins). Never throws.
 */
export function enqueueRatingOp(item: RatingQueueItem): Promise<void> {
  return runLocked(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => existing.pubKey !== item.pubKey);
    deduped.push(item);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
    await flushLocked();
  });
}

/** Drop all pending private rating sync operations without attempting delivery. */
export function clearPubRatingsQueue(): Promise<void> {
  return runLocked(async () => {
    await saveQueue([]);
  });
}

/**
 * Retries all pending rating operations. Call on app launch and on returning to
 * the foreground — both fire-and-forget. Never throws.
 */
export function flushPubRatingsQueue(): Promise<void> {
  return runLocked(flushLocked);
}
