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
 *   - 'permanent-error'       → will never succeed → drop from queue.
 *   - 'retry' (network/5xx/429/dormant) → keep for the next flush.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { submitDrink, type DrinkEntry } from './drinksClient';

const STORAGE_KEY = 'na-pivo-drinks-queue';
/** Hard cap — a queue this long means the backend has been unreachable for a
 *  very long time; dropping the oldest drinks beats unbounded growth. */
const MAX_QUEUE_LENGTH = 200;
export type QueuedDrinkUpdateResult = 'queued' | 'in-flight' | 'missing';
const deliveringIds = new Set<string>();

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

/** Serializes only AsyncStorage mutations. Network delivery deliberately runs
 *  outside this lock so a slow/offline flush cannot block a freshly-counted beer
 *  from being persisted immediately. */
let _mutationChain: Promise<unknown> = Promise.resolve();
let _flushPromise: Promise<void> | null = null;
/** A single coalesced trailing flush: when flushDrinksQueue() is called while a
 *  flush is already in flight, exactly one more flush is queued to run after it,
 *  so a drink enqueued mid-flight is attempted without waiting for the next
 *  launch. Multiple mid-flush callers collapse onto this same trailing promise. */
let _flushAgain: Promise<void> | null = null;

function runMutation<T>(task: () => Promise<T>): Promise<T> {
  const next = _mutationChain.then(task, task);
  _mutationChain = next.catch(() => undefined);
  return next;
}

/** Attempts to send every queued drink, keeping only the ones that should
 *  retry ('ok' and 'permanent-error' are both removed). */
async function flushUnlocked(): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const deliveredOrDropped = new Set<string>();
  const snapshotIds = new Set(queue.map((entry) => entry.client_id));
  for (const entry of queue) {
    deliveringIds.add(entry.client_id);
    try {
      const result = await submitDrink(entry);
      if (result !== 'retry') deliveredOrDropped.add(entry.client_id);
    } finally {
      deliveringIds.delete(entry.client_id);
    }
  }

  await runMutation(async () => {
    const current = await loadQueue();
    const remaining = current.filter((entry) => {
      if (!snapshotIds.has(entry.client_id)) return true;
      return !deliveredOrDropped.has(entry.client_id);
    });
    await saveQueue(remaining);
  });
}

/**
 * Persists the drink and (by default) immediately tries to sync the whole
 * queue. Resolves true when this drink reached the backend (or was permanently
 * rejected) on the first attempt — i.e. it left the queue; false means it stays
 * queued for a later flush. Never throws.
 *
 * Pass `{ deliver: false }` to persist the drink WITHOUT sending it yet. The
 * payload is durably queued (crash-safe) but stays retractable via
 * removeQueuedDrink until a later flush delivers it — this is what gives the
 * counter a real undo window. Resolves false in that case (still queued).
 *
 * No dedup: every drink is a distinct event keyed by its own client_id.
 */
export async function enqueueDrink(entry: DrinkEntry, options?: { deliver?: boolean }): Promise<boolean> {
  const deliver = options?.deliver ?? true;
  await runMutation(async () => {
    const queue = await loadQueue();
    queue.push(entry);
    await saveQueue(queue.slice(-MAX_QUEUE_LENGTH));
  });

  if (!deliver) return false;

  await flushDrinksQueue();
  return !(await isDrinkQueued(entry.client_id));
}

/**
 * True when a drink with this client_id is still waiting in the queue. Lets a
 * caller that deferred delivery learn, after a flush, whether THIS drink was
 * actually delivered (queued → still pending; not queued → delivered/dropped).
 */
export function isDrinkQueued(clientId: string): Promise<boolean> {
  return runMutation(async () => {
    const queue = await loadQueue();
    return queue.some((entry) => entry.client_id === clientId);
  });
}

/**
 * Remove a queued drink by its client_id — used when the user undoes a count
 * before the queued payload has been delivered, so an undone beer is never sent.
 * Resolves true only when the payload was still queued and not already in
 * delivery. False means it was already delivered/dropped, never queued, or its
 * POST is currently in flight; callers should enqueue a backend DELETE after the
 * active flush settles.
 */
export function removeQueuedDrink(clientId: string): Promise<boolean> {
  return runMutation(async () => {
    const queue = await loadQueue();
    const filtered = queue.filter((entry) => entry.client_id !== clientId);
    if (filtered.length !== queue.length) {
      await saveQueue(filtered);
      return !deliveringIds.has(clientId);
    }
    return false;
  });
}

/**
 * Update a drink that is still queued for its initial POST. This avoids sending
 * an old name followed by a PATCH when the typo is fixed before delivery.
 */
export function updateQueuedDrinkBeerName(
  clientId: string,
  beerName: string,
): Promise<QueuedDrinkUpdateResult> {
  return runMutation(async () => {
    const queue = await loadQueue();
    let changed = false;
    const next = queue.map((entry) => {
      if (entry.client_id !== clientId) return entry;
      changed = true;
      return { ...entry, beer: { ...entry.beer, name: beerName } };
    });
    if (changed) await saveQueue(next);
    if (!changed) return 'missing';
    return deliveringIds.has(clientId) ? 'in-flight' : 'queued';
  });
}

/** Drop all pending private drink uploads without attempting delivery. */
export function clearDrinksQueue(): Promise<void> {
  return runMutation(async () => {
    await saveQueue([]);
  });
}

/**
 * Retries all pending drinks. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 *
 * Trailing-edge coalescing: only one flush runs at a time (never two
 * concurrently, preserving the no-duplicate-send guarantee), but a call made
 * while a flush is in flight schedules exactly one more flush to run after it.
 * That trailing flush re-snapshots the queue, so a drink enqueued mid-flight is
 * delivered without waiting for the next launch. The returned promise resolves
 * only after that trailing flush completes.
 */
export function flushDrinksQueue(): Promise<void> {
  if (_flushPromise) {
    if (!_flushAgain) {
      _flushAgain = _flushPromise.then(() => {
        _flushAgain = null;
        return flushDrinksQueue();
      });
    }
    return _flushAgain;
  }
  _flushPromise = flushUnlocked().finally(() => {
    _flushPromise = null;
  });
  return _flushPromise;
}
