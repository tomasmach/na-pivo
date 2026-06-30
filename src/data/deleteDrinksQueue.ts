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

const STORAGE_KEY = 'na-pivo-delete-drinks-queue';
/** Hard cap — matches drinksQueue; an unbounded backlog means the backend has
 *  been unreachable for a very long time, so dropping the oldest beats growth. */
const MAX_QUEUE_LENGTH = 200;

function isClientId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<string>(
  STORAGE_KEY,
  isClientId,
);

/** Serializes only AsyncStorage mutations. Network delivery deliberately runs
 *  outside this lock so a slow/offline flush cannot block a fresh delete from
 *  being persisted immediately. */
const runMutation = createQueueLock();

async function flushUnlocked(): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const attempted = new Set(queue);
  const settled = new Set<string>();
  for (const clientId of queue) {
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
export async function enqueueDelete(clientId: string): Promise<void> {
  await runMutation(async () => {
    const queue = await loadQueue();
    if (!queue.includes(clientId)) {
      queue.push(clientId);
      await saveQueue(queue.slice(-MAX_QUEUE_LENGTH));
    }
  });
  await flushDeleteDrinksQueue();
}

/** Drop all pending private drink deletions without attempting delivery. */
export function clearDeleteDrinksQueue(): Promise<void> {
  return runMutation(async () => {
    await saveQueue([]);
  });
}

const _flush = createCoalescingFlush(flushUnlocked);

/**
 * Retries all pending deletions. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws. Trailing-edge coalesced (see
 * createCoalescingFlush): a deletion enqueued mid-flight is still delivered
 * without waiting for the next launch.
 */
export function flushDeleteDrinksQueue(): Promise<void> {
  return _flush();
}
