/**
 * Persistent retry queue for drink name UPDATES.
 *
 * A corrected beer name should apply locally immediately and eventually reach
 * the backend. Updates are keyed by client_id and deduped last-write-wins so a
 * user can fix the same typo twice while offline without building a backlog.
 */

import { updateDrink, updateDrinkName, type DrinkUpdate } from './drinksClient';
import { createQueueStorage, createQueueLock, createCoalescingFlush } from './createQueue';

const STORAGE_KEY = 'na-pivo-update-drinks-queue';
const MAX_QUEUE_LENGTH = 200;

export interface DrinkUpdateEntry {
  client_id: string;
  beer_name?: string;
  drink_type?: DrinkUpdate['drink_type'];
  price_czk?: DrinkUpdate['price_czk'];
  volume_ml?: DrinkUpdate['volume_ml'];
  serving_type?: DrinkUpdate['serving_type'];
}

function isDrinkUpdateEntry(entry: unknown): entry is DrinkUpdateEntry {
  const e = entry as DrinkUpdateEntry;
  return !!e && typeof e.client_id === 'string' && Object.keys(e).some((key) => key !== 'client_id');
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<DrinkUpdateEntry>(
  STORAGE_KEY,
  isDrinkUpdateEntry,
);

/** Serializes only AsyncStorage mutations. Network delivery deliberately runs
 *  outside this lock so a slow/offline flush cannot block a fresh edit from
 *  being persisted immediately. */
const runMutation = createQueueLock();

function signature(entry: DrinkUpdateEntry): string {
  return JSON.stringify(entry);
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const entry of queue) {
    // Stop before delivering the next update once an account-boundary clear has
    // aborted us, so a previous account's queued drink updates are never sent
    // under the session that replaces this one. (An update already in flight
    // keeps the token it captured before the boundary, so it still lands on the
    // right account.)
    if (signal.aborted) break;
    attempted.set(entry.client_id, signature(entry));
    const { client_id, ...update } = entry;
    const result = Object.keys(update).length === 1 && typeof update.beer_name === 'string'
      ? await updateDrinkName(client_id, update.beer_name)
      : await updateDrink(client_id, update);
    if (result !== 'retry') settled.add(entry.client_id);
  }

  await runMutation(async () => {
    const current = await loadQueue();
    const remaining = current.filter((entry) => {
      const sig = attempted.get(entry.client_id);
      if (sig === undefined || sig !== signature(entry)) return true;
      return !settled.has(entry.client_id);
    });
    await saveQueue(remaining);
  });
}

export async function enqueueDrinkUpdate(entry: DrinkUpdateEntry): Promise<void> {
  await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((queued) => queued.client_id !== entry.client_id);
    deduped.push(entry);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  await flushUpdateDrinksQueue();
}

export function removeQueuedDrinkUpdate(clientId: string): Promise<boolean> {
  return runMutation(async () => {
    const queue = await loadQueue();
    const filtered = queue.filter((entry) => entry.client_id !== clientId);
    if (filtered.length === queue.length) return false;
    await saveQueue(filtered);
    return true;
  });
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

export function clearUpdateDrinksQueue(): Promise<void> {
  // Cancel any in-flight flush first: its network loop runs outside runMutation,
  // so without this it could keep sending the previous account's drink updates
  // under the session that replaces this one.
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  }, { allowDuringPrivateTransition: true });
}

/**
 * Retries all pending updates. Never throws. Trailing-edge coalesced (see
 * createCoalescingFlush): an update enqueued mid-flight is still delivered
 * without waiting for the next launch.
 */
export function flushUpdateDrinksQueue(): Promise<void> {
  return _flush();
}
