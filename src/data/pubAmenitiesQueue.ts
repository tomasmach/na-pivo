/**
 * Persistent retry queue for "Zmapuj hospodu" community amenity votes.
 *
 * Each vote (set ano/ne, or retract) is a best-effort PUT via pubAmenitiesClient.
 * When a send fails (offline, account hiccup, timeout, 5xx, 429, dormant backend)
 * the change would be lost while the local store has already applied it. This
 * queue persists every operation to AsyncStorage BEFORE the first send and retries
 * on each app launch / foreground, so a vote eventually reaches the backend.
 *
 * Difference from pubRatingsQueue: ratings dedup by `pubKey` ALONE because a rating
 * is one scalar piece of state. An amenity report is a MAP of up to 16 independent
 * facts, so the dedup key here is `(pubKey, amenityKey)`. The pubKey-only model is
 * explicitly WRONG here — it would silently collapse a user's darts and wifi votes
 * into one delivery and drop the sibling. Only the LATEST state for each
 * (pubKey, amenityKey) matters, so enqueuing a new op for a pair REPLACES any
 * pending op for that same pair (last write wins), collapsing rapid edits
 * (ano → ne → cleared) into a single delivery.
 *
 * Each queue item is one operation on one (pubKey, amenityKey):
 *   - { op: 'upsert', pubKey, amenityKey, payload } → PUT { votes: [payload] }.
 *   - { op: 'delete', pubKey, amenityKey, payload } → PUT a value:null tombstone.
 * The queued payload is the FULL current local entry for that (pubKey, amenityKey)
 * at flush time (a snapshot, not a diff) so coalescing is safe.
 *
 * Flush keep/drop rule (matches the mobile retry contract):
 *   - 'ok' (2xx)              → reached backend → drop from queue.
 *   - 'permanent-error' (4xx) → will never succeed → drop from queue.
 *   - 'retry' (network/5xx/429/dormant) → keep for the next flush.
 *
 * We do NOT flush per enqueue: enqueue debounces a single flush (~250ms microtask)
 * after the subscriber settles, so mapping one pub doesn't fire 16 serial 8s-timeout
 * attempts and block the mutex.
 */

import {
  submitAmenityVotes,
  type SubmitAmenityResult,
  type WireAmenityVote,
} from './pubAmenitiesClient';
import { createQueueStorage, createQueueLock } from './createQueue';
import { AppState } from 'react-native';

const STORAGE_KEY = 'na-pivo-pub-amenities-queue';
/** Hard cap — one item per (pub, amenity). A realistic offline crawl (~10 pubs ×
 *  16 ≈ 160) is far under this; dropping the oldest beats unbounded growth. */
const MAX_QUEUE_LENGTH = 500;
/** Debounce window for the post-enqueue flush. */
const FLUSH_DEBOUNCE_MS = 250;
// SecureStore reads are suppressed for 2 s after an access error. Retry only
// while the app is active, with a small cap so a locked/unavailable session does
// not keep waking the app or generate a failure event for every queued vote.
const SESSION_RETRY_DELAYS_MS = [2_100, 5_000, 15_000];

/** One pending sync operation, keyed (and deduped) by (pubKey, amenityKey). */
export type AmenityQueueItem =
  | { op: 'upsert'; pubKey: string; amenityKey: string; payload: WireAmenityVote }
  | { op: 'delete'; pubKey: string; amenityKey: string; payload: WireAmenityVote };

/** Dedup / identity key for one queue item — the (pubKey, amenityKey) pair. */
function dedupKey(item: { pubKey: string; amenityKey: string }): string {
  return `${item.pubKey} ${item.amenityKey}`;
}

function isAmenityPayload(value: unknown): value is WireAmenityVote {
  const p = value as WireAmenityVote;
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    typeof p.amenity_key === 'string' &&
    typeof p.client_updated_at === 'string'
  );
}

function isQueueItem(value: unknown): value is AmenityQueueItem {
  const i = value as AmenityQueueItem;
  if (!i || typeof i.pubKey !== 'string' || typeof i.amenityKey !== 'string') return false;
  if (i.op === 'delete' || i.op === 'upsert') {
    return isAmenityPayload((i as { payload?: unknown }).payload);
  }
  return false;
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<AmenityQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose items. */
const runLocked = createQueueLock();

async function deliver(
  item: AmenityQueueItem,
  onAccountUnavailable: () => void,
): Promise<SubmitAmenityResult> {
  // Both ops are PUTs of the snapshot payload (a delete carries a value:null
  // tombstone) so the backend can apply the same last-write-wins rule.
  return submitAmenityVotes([item.payload], undefined, onAccountUnavailable);
}

/** Pending tombstones that restore must not hydrate back into local state. Keyed
 *  by dedupKey so a pending retraction of darts does not block a wifi pull. */
export function getQueuedAmenityDeletes(): Promise<Set<string>> {
  return runLocked(async () => {
    const queue = await loadQueue();
    return new Set(queue.filter((item) => item.op === 'delete').map(dedupKey));
  });
}

/** Stable content signature for an op, used to tell whether the queued op for a
 *  (pubKey, amenityKey) is still the SAME one we just attempted (object identity
 *  is lost across the AsyncStorage JSON round-trip, so we compare by value). */
function signature(item: AmenityQueueItem): string {
  return JSON.stringify(item);
}

async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) {
    resetSessionRetry();
    return;
  }

  // Snapshot the exact op (by content) we attempt per (pubKey, amenityKey), plus
  // its result. We re-load after delivery so an edit that landed mid-flush
  // (replacing the pending op for a pair) is NOT clobbered: a pair whose op
  // content changed under us is kept regardless of the stale result.
  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  let sessionUnavailable = false;
  for (const item of queue) {
    const key = dedupKey(item);
    attempted.set(key, signature(item));
    const result = await deliver(item, () => { sessionUnavailable = true; });
    if (result !== 'retry') settled.add(key);
    // Every queued vote needs the same session. One failed read is enough;
    // retain the untouched siblings for the next attempt.
    if (sessionUnavailable) break;
  }

  const current = await loadQueue();
  const remaining = current.filter((item) => {
    const key = dedupKey(item);
    const sig = attempted.get(key);
    // A different/newer op for this pair arrived during the flush → keep it.
    if (sig === undefined || sig !== signature(item)) return true;
    return !settled.has(key);
  });
  await saveQueue(remaining);
  if (sessionUnavailable) scheduleSessionRetry();
  else resetSessionRetry();
}

/** Pending debounced-flush timer, so rapid enqueues coalesce into one flush. */
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionRetryAttempt = 0;

function resetSessionRetry(): void {
  if (_sessionRetryTimer) clearTimeout(_sessionRetryTimer);
  _sessionRetryTimer = null;
  _sessionRetryAttempt = 0;
}

function scheduleSessionRetry(): void {
  if (_sessionRetryTimer || AppState.currentState !== 'active') return;
  const delay = SESSION_RETRY_DELAYS_MS[_sessionRetryAttempt];
  if (delay == null) return;
  _sessionRetryAttempt += 1;
  _sessionRetryTimer = setTimeout(() => {
    _sessionRetryTimer = null;
    if (AppState.currentState === 'active') void runLocked(flushLocked);
  }, delay);
}

/** Schedule a single debounced flush. Multiple enqueues within the window share it. */
function scheduleFlush(): void {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void runLocked(flushLocked);
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Enqueue (and dedup) one amenity operation, then schedule a debounced flush. A
 * new operation for a (pubKey, amenityKey) REPLACES any pending operation for that
 * same pair (last write wins). Never throws. Does NOT flush synchronously — see
 * the module header on why per-enqueue flushing is avoided.
 */
export function enqueueAmenityOp(item: AmenityQueueItem): Promise<void> {
  return runLocked(async () => {
    const key = dedupKey(item);
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => dedupKey(existing) !== key);
    deduped.push(item);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
    scheduleFlush();
  });
}

/** Drop all pending amenity sync operations without attempting delivery. */
export function clearPubAmenitiesQueue(): Promise<void> {
  resetSessionRetry();
  return runLocked(async () => {
    await saveQueue([]);
  });
}

/**
 * Retries all pending amenity operations. Call on app launch and on returning to
 * the foreground — both fire-and-forget. Cancels any pending debounced flush and
 * flushes immediately. Never throws.
 */
export function flushPubAmenitiesQueue(): Promise<void> {
  resetSessionRetry();
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  return runLocked(flushLocked);
}
