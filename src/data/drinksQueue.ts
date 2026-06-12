/**
 * Persistent retry queue for counted drinks.
 *
 * submitDrink() is a single best-effort POST; when it fails (offline, account
 * hiccup, timeout, 5xx, 429) the drink would be lost while the local tally
 * already counted it. This queue persists every drink to AsyncStorage BEFORE
 * the first send and retries pending drinks on each app launch / foreground, so
 * a counted beer eventually reaches the backend.
 *
 * Difference from communityQueue: there is NO dedup-by-geohash. Every drink
 * event is a distinct fact (you can have three of the same beer at the same
 * pub), so each is keyed only by its own client_id. The backend is idempotent
 * on client_id, so re-sending a queued drink is safe.
 *
 * Flush keep/drop rule (matches the mobile retry contract):
 *   - 'ok' (2xx)              → reached backend → drop from queue.
 *   - 'permanent-error' (4xx) → will never succeed → drop from queue.
 *   - 'retry' (network/5xx/429/dormant) → keep for the next flush.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { submitDrink, type DrinkEntry } from './drinksClient';

const STORAGE_KEY = 'na-pivo-drinks-queue';
/** Hard cap — a queue this long means the backend has been unreachable for a
 *  very long time; dropping the oldest drinks beats unbounded growth. */
const MAX_QUEUE_LENGTH = 200;

function isDrinkEntry(entry: unknown): entry is DrinkEntry {
  const e = entry as DrinkEntry;
  return (
    !!e &&
    typeof e.client_id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.lat === 'number' &&
    typeof e.lng === 'number' &&
    !!e.beer &&
    typeof e.beer.name === 'string' &&
    typeof e.beer.price_czk === 'number'
  );
}

async function loadQueue(): Promise<DrinkEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDrinkEntry);
  } catch {
    return [];
  }
}

async function saveQueue(queue: DrinkEntry[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Storage failure leaves the previous snapshot in place; the drink was
    // already attempted once, so the worst case matches the old behavior.
  }
}

/** Serializes queue mutations — concurrent enqueue/flush/remove calls would
 *  otherwise read-modify-write the same AsyncStorage snapshot and lose items. */
let _chain: Promise<unknown> = Promise.resolve();

function runLocked<T>(task: () => Promise<T>): Promise<T> {
  const next = _chain.then(task, task);
  _chain = next.catch(() => undefined);
  return next;
}

/** Attempts to send every queued drink, keeping only the ones that should
 *  retry ('ok' and 'permanent-error' are both removed). */
async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: DrinkEntry[] = [];
  for (const entry of queue) {
    const result = await submitDrink(entry);
    if (result === 'retry') remaining.push(entry);
  }
  await saveQueue(remaining);
}

/**
 * Persists the drink and immediately tries to sync the whole queue. Resolves
 * true when this drink reached the backend (or was permanently rejected) on the
 * first attempt — i.e. it left the queue; false means it stays queued for a
 * later flush. Never throws.
 *
 * No dedup: every drink is a distinct event keyed by its own client_id.
 */
export function enqueueDrink(entry: DrinkEntry): Promise<boolean> {
  return runLocked(async () => {
    const queue = await loadQueue();
    queue.push(entry);
    await saveQueue(queue.slice(-MAX_QUEUE_LENGTH));

    await flushLocked();
    const after = await loadQueue();
    return !after.some((queued) => queued.client_id === entry.client_id);
  });
}

/**
 * Remove a queued drink by its client_id — used when the user undoes a count
 * before the queued payload has been delivered, so an undone beer is never sent.
 * Resolves true only when the payload was still queued and got removed. False
 * means it was already delivered/dropped or was never queued, so callers must not
 * roll back their local tally.
 */
export function removeQueuedDrink(clientId: string): Promise<boolean> {
  return runLocked(async () => {
    const queue = await loadQueue();
    const filtered = queue.filter((entry) => entry.client_id !== clientId);
    if (filtered.length !== queue.length) {
      await saveQueue(filtered);
      return true;
    }
    return false;
  });
}

/**
 * Retries all pending drinks. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushDrinksQueue(): Promise<void> {
  return runLocked(flushLocked);
}
