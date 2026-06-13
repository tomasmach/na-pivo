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

import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteDrink } from './drinksClient';

const STORAGE_KEY = 'na-pivo-delete-drinks-queue';
/** Hard cap — matches drinksQueue; an unbounded backlog means the backend has
 *  been unreachable for a very long time, so dropping the oldest beats growth. */
const MAX_QUEUE_LENGTH = 200;

function isClientId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function loadQueue(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isClientId);
  } catch {
    return [];
  }
}

async function saveQueue(queue: string[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Storage failure leaves the previous snapshot in place; the deletion was
    // already attempted once, so the worst case matches the old behavior.
  }
}

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose items. */
let _chain: Promise<unknown> = Promise.resolve();

function runLocked<T>(task: () => Promise<T>): Promise<T> {
  const next = _chain.then(task, task);
  _chain = next.catch(() => undefined);
  return next;
}

async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: string[] = [];
  for (const clientId of queue) {
    const result = await deleteDrink(clientId);
    if (result === 'retry') remaining.push(clientId);
  }
  await saveQueue(remaining);
}

/**
 * Persists the client_id to delete and immediately tries to flush the whole
 * deletion queue. Never throws. Deduped: enqueuing the same client_id twice is
 * a no-op (the DELETE is idempotent, but there is no point queueing it twice).
 */
export function enqueueDelete(clientId: string): Promise<void> {
  return runLocked(async () => {
    const queue = await loadQueue();
    if (!queue.includes(clientId)) {
      queue.push(clientId);
      await saveQueue(queue.slice(-MAX_QUEUE_LENGTH));
    }
    await flushLocked();
  });
}

/**
 * Retries all pending deletions. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushDeleteDrinksQueue(): Promise<void> {
  return runLocked(flushLocked);
}
