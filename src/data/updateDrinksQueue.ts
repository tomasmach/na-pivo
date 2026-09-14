/**
 * Persistent retry queue for drink name UPDATES.
 *
 * A corrected beer name should apply locally immediately and eventually reach
 * the backend. Updates are keyed by client_id and deduped last-write-wins so a
 * user can fix the same typo twice while offline without building a backlog.
 */

import { updateDrink, updateDrinkName, type DrinkUpdate } from './drinksClient';
import { createQueueStorage, createQueueLock, createCoalescingFlush } from './createQueue';
import { preserveDurableQueue } from './durableQueuePolicy';
import { isDrinkType, isServingType } from '@/drinks/drinkTypes';

const STORAGE_KEY = 'na-pivo-update-drinks-queue';
const MAX_QUEUE_LENGTH = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type DrinkUpdateEnqueueResult = 'queued' | 'storage-error';

export interface DrinkUpdateEntry {
  client_id: string;
  beer_name?: string;
  drink_type?: DrinkUpdate['drink_type'];
  price_czk?: DrinkUpdate['price_czk'];
  volume_ml?: DrinkUpdate['volume_ml'];
  serving_type?: DrinkUpdate['serving_type'];
}

function isDrinkUpdateEntry(entry: unknown): entry is DrinkUpdateEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  const updateKeys = Object.keys(e).filter((key) => key !== 'client_id');
  if (
    typeof e.client_id !== 'string' ||
    !UUID_PATTERN.test(e.client_id) ||
    updateKeys.length === 0 ||
    updateKeys.some(
      (key) =>
        !['beer_name', 'drink_type', 'price_czk', 'volume_ml', 'serving_type'].includes(key),
    )
  ) {
    return false;
  }
  if ('beer_name' in e && (typeof e.beer_name !== 'string' || !e.beer_name.trim())) return false;
  if ('drink_type' in e && !isDrinkType(e.drink_type)) return false;
  if (
    'price_czk' in e &&
    e.price_czk !== null &&
    (typeof e.price_czk !== 'number' || !Number.isFinite(e.price_czk) || e.price_czk < 0)
  ) {
    return false;
  }
  if (
    'volume_ml' in e &&
    e.volume_ml !== null &&
    (typeof e.volume_ml !== 'number' || !Number.isFinite(e.volume_ml) || e.volume_ml <= 0)
  ) {
    return false;
  }
  if ('serving_type' in e && !isServingType(e.serving_type)) return false;
  return true;
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
  const queue = await runMutation(async () => {
    const validated = await loadQueue();
    // Rewrite the validated snapshot so malformed persisted entries are
    // actually discarded instead of being reparsed on every foreground retry.
    await saveQueue(validated);
    return validated;
  });
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
    const result =
      Object.keys(update).length === 1 && typeof update.beer_name === 'string'
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

export async function enqueueDrinkUpdate(
  entry: DrinkUpdateEntry,
): Promise<DrinkUpdateEnqueueResult> {
  const persisted = await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((queued) => queued.client_id !== entry.client_id);
    deduped.push(entry);
    return saveQueue(preserveDurableQueue(deduped, MAX_QUEUE_LENGTH));
  });
  if (!persisted) return 'storage-error';
  await flushUpdateDrinksQueue();
  return 'queued';
}

export function removeQueuedDrinkUpdate(clientId: string): Promise<boolean> {
  return runMutation(async () => {
    const queue = await loadQueue();
    const filtered = queue.filter((entry) => entry.client_id !== clientId);
    if (filtered.length === queue.length) return false;
    return saveQueue(filtered);
  });
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

export function clearUpdateDrinksQueue(): Promise<void> {
  // Cancel any in-flight flush first: its network loop runs outside runMutation,
  // so without this it could keep sending the previous account's drink updates
  // under the session that replaces this one.
  abortInFlight();
  return runMutation(
    async () => {
      await saveQueue([]);
    },
    { allowDuringPrivateTransition: true },
  );
}

/**
 * Retries all pending updates. Never throws. Trailing-edge coalesced (see
 * createCoalescingFlush): an update enqueued mid-flight is still delivered
 * without waiting for the next launch.
 */
export function flushUpdateDrinksQueue(): Promise<void> {
  return _flush();
}
