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

import { createQueueLock, createQueueStorage } from './createQueue';
import { submitFavorite, type WireFavoriteUpsert } from './pubFavoritesClient';

const STORAGE_KEY = 'na-pivo-pub-favorites-queue';
/** One item per pub; only bites with hundreds of changes while offline. */
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
    typeof p.lng === 'number' &&
    typeof p.favorite === 'boolean' &&
    typeof p.updated_at === 'string'
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<FavoriteQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);
const runLocked = createQueueLock();

function signature(item: FavoriteQueueItem): string {
  return JSON.stringify(item);
}

async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const item of queue) {
    attempted.set(item.pubKey, signature(item));
    if ((await submitFavorite(item.payload)) !== 'retry') settled.add(item.pubKey);
  }

  // Re-read: a newer change for a pubKey that landed mid-flush must survive.
  const current = await loadQueue();
  await saveQueue(
    current.filter((item) => {
      const sig = attempted.get(item.pubKey);
      if (sig === undefined || sig !== signature(item)) return true;
      return !settled.has(item.pubKey);
    }),
  );
}

/** Pending removals, so a restore does not bring a removed heart back. */
export function getQueuedFavoriteRemovalKeys(): Promise<Set<string>> {
  return runLocked(async () => {
    const queue = await loadQueue();
    return new Set(queue.filter((item) => !item.payload.favorite).map((item) => item.pubKey));
  });
}

/** Enqueue one operation (replacing any pending one for the pub), then flush. */
export function enqueueFavoriteOp(item: FavoriteQueueItem): Promise<void> {
  return runLocked(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => existing.pubKey !== item.pubKey);
    deduped.push(item);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
    await flushLocked();
  });
}

/** Drop pending operations without sending them (account boundary). */
export function clearPubFavoritesQueue(): Promise<void> {
  return runLocked(async () => {
    await saveQueue([]);
  });
}

/** Retry pending operations. Called on launch and foreground. Never throws. */
export function flushPubFavoritesQueue(): Promise<void> {
  return runLocked(flushLocked);
}
