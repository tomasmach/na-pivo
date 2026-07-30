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

import { submitDrink, type DrinkEntry } from './drinksClient';
import { createQueueStorage, createQueueLock, createCoalescingFlush } from './createQueue';
import { isDrinkType, isOutsidePlaceContext, isServingType } from '@/drinks/drinkTypes';

const STORAGE_KEY = 'na-pivo-drinks-queue';
/**
 * Existing-history backfills stay deliberately bounded so one migration cannot
 * monopolise local storage. Live facts are never capped: they remain queued
 * until the backend acknowledges them.
 */
const HISTORICAL_SEED_QUEUE_LIMIT = 200;
export type QueuedDrinkUpdateResult = 'queued' | 'in-flight' | 'missing';
const deliveringIds = new Set<string>();
const protectedHistoricalIds = new Set<string>();
let accountBoundaryGeneration = 0;

function isDrinkEntry(entry: unknown): entry is DrinkEntry {
  const e = entry as DrinkEntry;
  if (
    !e ||
    typeof e.client_id !== 'string' ||
    (e.drink_type !== undefined && !isDrinkType(e.drink_type)) ||
    !e.beer ||
    typeof e.beer.name !== 'string' ||
    (e.beer.serving_type !== undefined && !isServingType(e.beer.serving_type))
  ) {
    return false;
  }
  // Outside drinks (place_context ≠ pub) carry no pub identity and may have no
  // price; a pub drink (or a legacy entry without place_context) must have both.
  if (isOutsidePlaceContext(e.place_context)) {
    return (
      e.name === undefined &&
      e.lat === undefined &&
      e.lng === undefined &&
      (e.beer.price_czk === undefined || typeof e.beer.price_czk === 'number')
    );
  }
  return (
    typeof e.name === 'string' &&
    typeof e.lat === 'number' &&
    typeof e.lng === 'number' &&
    typeof e.beer.price_czk === 'number'
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<DrinkEntry>(
  STORAGE_KEY,
  isDrinkEntry,
);

/** Serializes only AsyncStorage mutations. Network delivery deliberately runs
 *  outside this lock so a slow/offline flush cannot block a freshly-counted beer
 *  from being persisted immediately. */
const runMutation = createQueueLock();

/** Attempts to send every queued drink, keeping only the ones that should
 *  retry ('ok' and 'permanent-error' are both removed). */
async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const deliveredOrDropped = new Set<string>();
  const snapshotIds = new Set(queue.map((entry) => entry.client_id));
  for (const entry of queue) {
    // Stop before delivering the next drink once an account-boundary clear has
    // aborted us, so a previous account's queued drinks are never POSTed under
    // the session that replaces this one. (A drink already in flight keeps the
    // token it captured before the boundary, so it still lands on the right
    // account.)
    if (signal.aborted) break;
    deliveringIds.add(entry.client_id);
    try {
      const result = await submitDrink(entry, signal);
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
    await saveQueue(queue);
  });

  if (!deliver) return false;

  await flushDrinksQueue();
  return !(await isDrinkQueued(entry.client_id));
}

/**
 * Crash-safe enqueue for a drink whose client_id comes from a durable external
 * interaction (for example a lock-screen Live Activity button). Replaying the
 * same interaction must not create duplicate queue rows. The caller flushes
 * only after its matching local tally write is durable.
 */
export function ensureDrinkQueued(entry: DrinkEntry): Promise<void> {
  return runMutation(async () => {
    const queue = await loadQueue();
    if (queue.some((queued) => queued.client_id === entry.client_id)) return;
    queue.push(entry);
    const persisted = await saveQueue(queue);
    if (!persisted) {
      throw new Error('Offline drink queue is unavailable');
    }
  });
}

export interface HistoricalDrinkBatchResult {
  /** IDs already present or newly persisted without evicting another drink. */
  acceptedClientIds: string[];
  /** False when an account clear began while this batch was waiting for the lock. */
  boundaryMatches: boolean;
  /** False when AsyncStorage rejected the attempted write. */
  persisted: boolean;
}

/** Capture the current private-account generation before preparing a seed. */
export function getDrinksQueueBoundaryGeneration(): number {
  return accountBoundaryGeneration;
}

/**
 * Durably add as much of a historical seed batch as fits without applying the
 * normal queue's "drop oldest" cap policy. A backfill must never evict a newer
 * offline drink just to make room, nor claim IDs whose storage write failed.
 *
 * The account generation is checked inside the same mutation lock as the write:
 * a seed snapshot captured before logout cannot enqueue after clearDrinksQueue.
 */
export function ensureHistoricalDrinkBatchQueued(
  entries: DrinkEntry[],
  expectedBoundaryGeneration: number,
): Promise<HistoricalDrinkBatchResult> {
  return runMutation(async () => {
    if (expectedBoundaryGeneration !== accountBoundaryGeneration) {
      return { acceptedClientIds: [], boundaryMatches: false, persisted: false };
    }

    const queue = await loadQueue();
    if (expectedBoundaryGeneration !== accountBoundaryGeneration) {
      return { acceptedClientIds: [], boundaryMatches: false, persisted: false };
    }
    const existingIds = new Set(queue.map((entry) => entry.client_id));
    const acceptedClientIds: string[] = [];
    const additions: DrinkEntry[] = [];
    const batchIds = new Set<string>();
    let available = Math.max(0, HISTORICAL_SEED_QUEUE_LIMIT - queue.length);

    for (const entry of entries) {
      if (batchIds.has(entry.client_id)) continue;
      batchIds.add(entry.client_id);
      if (existingIds.has(entry.client_id)) {
        acceptedClientIds.push(entry.client_id);
      } else if (available > 0) {
        additions.push(entry);
        acceptedClientIds.push(entry.client_id);
        existingIds.add(entry.client_id);
        available -= 1;
      }
    }

    if (additions.length === 0) {
      acceptedClientIds.forEach((clientId) => protectedHistoricalIds.add(clientId));
      return { acceptedClientIds, boundaryMatches: true, persisted: true };
    }
    const persisted = await saveQueue([...queue, ...additions]);
    const boundaryMatches =
      expectedBoundaryGeneration === accountBoundaryGeneration;
    if (!boundaryMatches) {
      return { acceptedClientIds: [], boundaryMatches: false, persisted: false };
    }
    const durableClientIds = persisted
      ? acceptedClientIds
      : acceptedClientIds.filter((clientId) =>
          queue.some((entry) => entry.client_id === clientId),
        );
    durableClientIds.forEach((clientId) => protectedHistoricalIds.add(clientId));
    return {
      acceptedClientIds: durableClientIds,
      boundaryMatches: true,
      persisted,
    };
  });
}

/** Release temporary cap protection after the seed has checked delivery state. */
export function releaseHistoricalDrinkBatch(clientIds: readonly string[]): void {
  for (const clientId of clientIds) protectedHistoricalIds.delete(clientId);
}

/** Return which requested IDs remain pending after a historical batch flush. */
export function getQueuedDrinkIds(clientIds: readonly string[]): Promise<string[]> {
  return runMutation(async () => {
    const wanted = new Set(clientIds);
    return (await loadQueue())
      .map((entry) => entry.client_id)
      .filter((clientId) => wanted.has(clientId));
  });
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
      const persisted = await saveQueue(filtered);
      return persisted && !deliveringIds.has(clientId);
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

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

/** Drop all pending private drink uploads without attempting delivery. */
export function clearDrinksQueue(): Promise<void> {
  // Synchronous invalidation closes the check→lock race for history backfills:
  // any seed waiting to mutate storage sees a different generation.
  accountBoundaryGeneration += 1;
  protectedHistoricalIds.clear();
  // Cancel any in-flight flush first: its network loop runs outside runMutation,
  // so without this it could keep POSTing the previous account's drinks under the
  // session that replaces this one.
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}

/**
 * Retries all pending drinks. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws. Trailing-edge coalesced (see
 * createCoalescingFlush): a drink enqueued mid-flight is still delivered without
 * waiting for the next launch.
 */
export function flushDrinksQueue(): Promise<void> {
  return _flush();
}
