/**
 * Persistent retry queue for community contributions (opening hours + beers).
 *
 * submitPubCommunity() is a single best-effort POST; when it fails (offline,
 * account hiccup, timeout) the contribution would be lost while the UI already
 * showed a thank-you and wrote a local optimistic override. This queue persists
 * every entry to AsyncStorage BEFORE the first send attempt and retries pending
 * entries on each app launch / foreground, so a contribution eventually reaches
 * the backend even if the first try fails.
 *
 * The backend is idempotent on client_id, so re-sending a queued entry is safe.
 *
 * Dedup: keyed by the pub's geohash-8 cell (the stable physical-place key — the
 * Mapy.cz external id is unstable). A newer edit of the same pub REPLACES the
 * older queued submission, because the queued one is already stale. The newer
 * entry keeps its own fresh client_id (minted at build time by the caller),
 * since its content differs and we want it stored as a distinct contribution.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { submitPubCommunity, type CommunityEntry } from './communityClient';
import { geohash8 } from './geohash';

const STORAGE_KEY = 'na-pivo-community-queue';
/** Hard cap — a queue this long means the backend has been unreachable for a
 *  very long time; dropping the oldest entries beats unbounded growth. */
const MAX_QUEUE_LENGTH = 30;

/** The stable dedup key for an entry: the geohash-8 cell of its coordinates. */
export function entryCell(entry: CommunityEntry): string {
  return geohash8(entry.lat, entry.lng);
}

function isCommunityEntry(entry: unknown): entry is CommunityEntry {
  const e = entry as CommunityEntry;
  return (
    !!e &&
    typeof e.client_id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.lat === 'number' &&
    typeof e.lng === 'number' &&
    (e.external_id === null || typeof e.external_id === 'string') &&
    // At least one of hours/beers must be present for a valid contribution.
    (e.hours !== undefined || e.beers !== undefined)
  );
}

async function loadQueue(): Promise<CommunityEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCommunityEntry);
  } catch {
    return [];
  }
}

async function saveQueue(queue: CommunityEntry[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Storage failure leaves the previous snapshot in place; the entry was
    // already attempted once, so the worst case matches the old behavior.
  }
}

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose entries. */
let _chain: Promise<unknown> = Promise.resolve();

function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
  const next = _chain.then(task, task);
  _chain = next.catch(() => undefined);
  return next;
}

/** Attempts to send every queued entry, keeping only the ones that failed. */
async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: CommunityEntry[] = [];
  for (const entry of queue) {
    const result = await submitPubCommunity(entry);
    if (!result) remaining.push(entry);
  }
  await saveQueue(remaining);
}

/**
 * Persists the contribution and immediately tries to sync the whole queue.
 * Resolves true when this entry reached the backend on the first attempt; false
 * means it stays queued for a later flush. Never throws.
 *
 * A newer edit of the same pub (same geohash-8 cell) replaces any older queued
 * submission for that pub — the older one is stale.
 */
export function enqueuePubCommunity(entry: CommunityEntry): Promise<boolean> {
  return enqueueTask(async () => {
    const queue = await loadQueue();
    const cell = entryCell(entry);
    const deduped = queue.filter((queued) => entryCell(queued) !== cell);
    deduped.push(entry);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));

    await flushLocked();
    const after = await loadQueue();
    return !after.some((queued) => queued.client_id === entry.client_id);
  });
}

/**
 * Retries all pending contributions. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushCommunityQueue(): Promise<void> {
  return enqueueTask(flushLocked);
}
