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
 * A 429 ends the whole pass, not just its item: the backend counts every vote of
 * the account in one window, so the rest would only collect more 429s. The queue
 * stays untouched and one timer flushes it after Retry-After plus backoff
 * (pubAmenitiesRateLimit.ts). Launch, foreground and enqueue flushes during the
 * pause send nothing.
 *
 * We do NOT flush per enqueue: enqueue debounces a single flush (~250ms microtask)
 * after the subscriber settles, so mapping one pub doesn't fire 16 serial 8s-timeout
 * attempts. Network delivery never holds the storage mutex, so another tap can
 * persist before an earlier request finishes.
 */

import {
  submitAmenityVotes,
  type SubmitAmenityResult,
  type WireAmenityVote,
} from './pubAmenitiesClient';
import { createQueueStorage, createQueueLock, createCoalescingFlush } from './createQueue';
import { clearAmenityVotesRateLimit, getAmenityVotesRetryAt } from './pubAmenitiesRateLimit';
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

/** Serializes storage mutations without keeping the lock during network I/O. */
const runLocked = createQueueLock();

async function deliver(
  item: AmenityQueueItem,
  signal: AbortSignal,
  onAccountUnavailable: () => void,
): Promise<SubmitAmenityResult> {
  // Both ops are PUTs of the snapshot payload (a delete carries a value:null
  // tombstone) so the backend can apply the same last-write-wins rule.
  return submitAmenityVotes([item.payload], signal, onAccountUnavailable);
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

/** True while a 429 pause runs; a flush is then scheduled for its end. */
async function waitForThrottle(signal: AbortSignal): Promise<boolean> {
  const retryAt = await getAmenityVotesRetryAt();
  if (retryAt && !signal.aborted) scheduleThrottleRetry(retryAt);
  return retryAt > 0;
}

async function flushSnapshot(signal: AbortSignal): Promise<void> {
  const queue = await runLocked(loadQueue);
  if (queue.length === 0) {
    resetSessionRetry();
    return;
  }

  let sessionUnavailable = false;
  for (const item of queue) {
    if (signal.aborted || await waitForThrottle(signal)) return;
    const key = dedupKey(item);
    const attempted = signature(item);
    // A newer edit or account-boundary clear may have replaced this snapshot
    // while an earlier request was in flight.
    const stillQueued = await runLocked(async () =>
      (await loadQueue()).some((current) => dedupKey(current) === key && signature(current) === attempted)
    );
    if (!stillQueued || signal.aborted) continue;

    const result = await deliver(item, signal, () => { sessionUnavailable = true; });
    if (signal.aborted) return;
    if (result !== 'retry') {
      await runLocked(async () => {
        const current = await loadQueue();
        // A completed request must never erase a newer vote or retraction.
        const remaining = current.filter((entry) =>
          dedupKey(entry) !== key || signature(entry) !== attempted
        );
        if (remaining.length !== current.length) await saveQueue(remaining);
      });
    }
    // Every queued vote needs the same session. One failed read is enough;
    // retain the untouched siblings for the next attempt.
    if (sessionUnavailable) break;
  }

  // The last item may have been the one that got 429.
  if (signal.aborted || await waitForThrottle(signal)) return;
  if (sessionUnavailable) scheduleSessionRetry();
  else resetSessionRetry();
}

const { flush: flushQueue, abortInFlight } = createCoalescingFlush(flushSnapshot);

/** Pending debounced-flush timer, so rapid enqueues coalesce into one flush. */
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionRetryAttempt = 0;
let _throttleTimer: ReturnType<typeof setTimeout> | null = null;

function resetThrottleRetry(): void {
  if (_throttleTimer) clearTimeout(_throttleTimer);
  _throttleTimer = null;
}

/** One flush when the 429 pause ends. A suspended app flushes on foreground instead. */
function scheduleThrottleRetry(retryAt: number): void {
  resetThrottleRetry();
  _throttleTimer = setTimeout(() => {
    _throttleTimer = null;
    if (AppState.currentState === 'active') void flushQueue();
  }, retryAt - Date.now());
}

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
    if (AppState.currentState === 'active') void flushQueue();
  }, delay);
}

/** Schedule a single debounced flush. Multiple enqueues within the window share it. */
function scheduleFlush(): void {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void flushQueue();
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
  resetThrottleRetry();
  abortInFlight();
  const rateLimitCleared = clearAmenityVotesRateLimit();
  return runLocked(async () => {
    await Promise.all([saveQueue([]), rateLimitCleared]);
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
  return flushQueue();
}
