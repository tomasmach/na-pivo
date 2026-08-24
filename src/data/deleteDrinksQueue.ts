/**
 * Persistent retry queue for drink DELETIONS.
 *
 * When the user removes a counted beer that has ALREADY been delivered to the
 * backend (its POST left the local queue), we must tell the backend to drop the
 * per-user DrinkLog row too. deleteDrink() is a single best-effort DELETE; when
 * it fails (offline, timeout, 5xx, 429) the deletion would be lost and the
 * backend would keep a drink the user retracted. This queue persists every
 * client_id to delete BEFORE the first send and retries on launch / foreground,
 * so a retraction eventually reaches the backend.
 *
 * Mirror of drinksQueue, but the unit is a bare client_id string (the DELETE has
 * no body). The backend DELETE is idempotent (a missing id replies deleted:false
 * with 200 → 'ok'), so re-sending a queued deletion is safe.
 *
 * Flush keep/drop rule (matches submitDrink / drinksQueue):
 *   - 'ok' (2xx)              → reached backend → drop from queue.
 *   - 'permanent-error' (4xx) → will never succeed → drop from queue.
 *   - 'retry' (network/5xx/429/dormant) → keep for the next flush.
 */

import { deleteDrink } from './drinksClient';
import { createQueueStorage, createQueueLock, createCoalescingFlush } from './createQueue';
import { preserveDurableQueue } from './durableQueuePolicy';

const STORAGE_KEY = 'na-pivo-delete-drinks-queue';
/** Historical queue limit retained as migration context; durable deletes are never dropped. */
const MAX_QUEUE_LENGTH = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type DeleteDrinkEnqueueResult = 'queued' | 'storage-error';

function isClientId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<string>(
  STORAGE_KEY,
  isClientId,
);

/** Serializes only AsyncStorage mutations. Network delivery deliberately runs
 *  outside this lock so a slow/offline flush cannot block a fresh delete from
 *  being persisted immediately. */
const runMutation = createQueueLock();

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const attempted = new Set(queue);
  const settled = new Set<string>();
  for (const clientId of queue) {
    // Stop before delivering the next deletion once an account-boundary clear has
    // aborted us, so a previous account's queued drink deletions are never sent
    // under the session that replaces this one. (A deletion already in flight
    // keeps the token it captured before the boundary, so it still lands on the
    // right account.)
    if (signal.aborted) break;
    const result = await deleteDrink(clientId);
    if (result !== 'retry') settled.add(clientId);
  }

  await runMutation(async () => {
    const current = await loadQueue();
    const remaining = current.filter((clientId) => {
      if (!attempted.has(clientId)) return true;
      return !settled.has(clientId);
    });
    await saveQueue(remaining);
  });
}

/**
 * Persists the client_id to delete and immediately tries to flush the whole
 * deletion queue. Never throws. Deduped: enqueuing the same client_id twice is
 * a no-op (the DELETE is idempotent, but there is no point queueing it twice).
 */
export async function enqueueDelete(clientId: string): Promise<DeleteDrinkEnqueueResult> {
  const persisted = await runMutation(async () => {
    const queue = await loadQueue();
    if (queue.includes(clientId)) return true;
    queue.push(clientId);
    return saveQueue(preserveDurableQueue(queue, MAX_QUEUE_LENGTH));
  });
  if (!persisted) return 'storage-error';
  await flushDeleteDrinksQueue();
  return 'queued';
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

/** Drop all pending private drink deletions without attempting delivery. */
export function clearDeleteDrinksQueue(): Promise<void> {
  // Cancel any in-flight flush first: its network loop runs outside runMutation,
  // so without this it could keep sending the previous account's drink deletions
  // under the session that replaces this one.
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  }, { allowDuringPrivateTransition: true });
}

/**
 * Retries all pending deletions. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws. Trailing-edge coalesced (see
 * createCoalescingFlush): a deletion enqueued mid-flight is still delivered
 * without waiting for the next launch.
 */
export function flushDeleteDrinksQueue(): Promise<void> {
  return _flush();
}
