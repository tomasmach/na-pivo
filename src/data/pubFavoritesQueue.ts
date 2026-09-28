/**
 * Persistent retry queue for favourite-pub sync.
 *
 * Mirrors pubRatingsQueue: each save or removal is persisted to AsyncStorage
 * before the first send and retried on launch and foreground. A favourite is
 * state, not an event, so a new operation for a pubKey replaces the pending one
 * (last write wins) and rapid heart taps collapse into one delivery.
 *
 * Keep/drop: 'ok' drops, 'permanent-error' (400/422) drops, 'retry' keeps. A
 * save over the account cap answers 409 and is retried, never lost.
 */

import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import { geohash8 } from './geohash';
import { submitFavorite, type WireFavoriteUpsert } from './pubFavoritesClient';

const STORAGE_KEY = 'na-pivo-pub-favorites-queue';
/** One item per pub; only bites with hundreds of saves while offline. */
const MAX_QUEUE_LENGTH = 500;

export interface FavoriteQueueItem {
  pubKey: string;
  payload: WireFavoriteUpsert;
}

function isQueueItem(value: unknown): value is FavoriteQueueItem {
  const item = value as FavoriteQueueItem;
  const p = item?.payload;
  return (
    !!item &&
    typeof item.pubKey === 'string' &&
    !!p &&
    typeof p.lat === 'number' &&
    Math.abs(p.lat) <= 90 &&
    typeof p.lng === 'number' &&
    Math.abs(p.lng) <= 180 &&
    typeof p.favorite === 'boolean' &&
    typeof p.updated_at === 'string' &&
    Number.isFinite(Date.parse(p.updated_at)) &&
    // The server deletes the cell of the point, so it must be the cell named here.
    geohash8(p.lat, p.lng) === item.pubKey
  );
}

/**
 * Cap the queue by dropping the oldest saves only. A lost removal would let
 * the next pull bring the heart back, so removals always stay.
 */
function capped(queue: FavoriteQueueItem[]): FavoriteQueueItem[] {
  let excess = queue.length - MAX_QUEUE_LENGTH;
  return queue.filter((item) => {
    if (excess <= 0 || !item.payload.favorite) return true;
    excess -= 1;
    return false;
  });
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<FavoriteQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);
const runMutation = createQueueLock();

function signature(item: FavoriteQueueItem): string {
  return JSON.stringify(item);
}

/**
 * Deliver outside the storage lock, like the visits queue: a slow request must
 * not keep the next heart tap from being saved. An account-boundary clear
 * aborts the loop, so the previous account's hearts are never sent under the
 * next session.
 */
async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const item of queue) {
    if (signal.aborted) break;
    attempted.set(item.pubKey, signature(item));
    if ((await submitFavorite(item.payload, signal)) !== 'retry') settled.add(item.pubKey);
  }

  // Re-read: a newer change for a pubKey that landed mid-flush must survive.
  await runMutation(async () => {
    const current = await loadQueue();
    await saveQueue(
      current.filter((item) => {
        const sig = attempted.get(item.pubKey);
        if (sig === undefined || sig !== signature(item)) return true;
        return !settled.has(item.pubKey);
      }),
    );
  });
}

const { flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

/** Pending removals, so a restore does not bring a removed heart back. */
export async function getQueuedFavoriteRemovalKeys(): Promise<Set<string>> {
  const queue = await runMutation(loadQueue);
  return new Set(queue.filter((item) => !item.payload.favorite).map((item) => item.pubKey));
}

/** Save one operation (replacing any pending one for the pub), then flush. */
export async function enqueueFavoriteOp(item: FavoriteQueueItem): Promise<void> {
  await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => existing.pubKey !== item.pubKey);
    deduped.push(item);
    await saveQueue(capped(deduped));
  });
  await flush();
}

/** Drop pending operations without sending them (account boundary). */
export function clearPubFavoritesQueue(): Promise<void> {
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}

/** Retry pending operations. Called on launch and foreground. Never throws. */
export function flushPubFavoritesQueue(): Promise<void> {
  return flush();
}
