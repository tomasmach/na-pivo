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

import { submitPubCommunity, type CommunityEntry, type CommunityResponse } from './communityClient';
import { geohash8 } from './geohash';
import { createQueueStorage, createQueueLock } from './createQueue';

const STORAGE_KEY = 'na-pivo-community-queue';
/** Hard cap — a queue this long means the backend has been unreachable for a
 *  very long time; dropping the oldest entries beats unbounded growth. */
const MAX_QUEUE_LENGTH = 30;

/** The stable dedup key for an entry: the geohash-8 cell of its coordinates. */
function entryCell(entry: CommunityEntry): string {
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

const { load: loadQueue, save: saveQueue } = createQueueStorage<CommunityEntry>(
  STORAGE_KEY,
  isCommunityEntry,
);

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose entries. */
const enqueueTask = createQueueLock();

/** Attempts to send every queued entry, keeping only the ones that failed.
 *  Returns the delivered responses keyed by client_id so a caller can read the
 *  backend envelope (the Mapér XP snapshot) for the entry it just enqueued. */
async function flushLocked(): Promise<Map<string, CommunityResponse>> {
  const delivered = new Map<string, CommunityResponse>();
  const queue = await loadQueue();
  if (queue.length === 0) return delivered;

  const remaining: CommunityEntry[] = [];
  for (const entry of queue) {
    const result = await submitPubCommunity(entry);
    if (result) delivered.set(entry.client_id, result);
    else remaining.push(entry);
  }
  await saveQueue(remaining);
  return delivered;
}

/**
 * Persists the contribution and immediately tries to sync the whole queue.
 * Resolves the backend response (incl. the Mapér XP envelope) when this entry
 * reached the backend on the first attempt, or null when it stays queued for a
 * later flush. Never throws.
 *
 * A newer edit of the same pub (same geohash-8 cell) replaces any older queued
 * submission for that pub — the older one is stale.
 */
export function enqueuePubCommunity(entry: CommunityEntry): Promise<CommunityResponse | null> {
  return enqueueTask(async () => {
    const queue = await loadQueue();
    const cell = entryCell(entry);
    const deduped = queue.filter((queued) => entryCell(queued) !== cell);
    deduped.push(entry);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));

    const delivered = await flushLocked();
    return delivered.get(entry.client_id) ?? null;
  });
}

/**
 * Retries all pending contributions. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushCommunityQueue(): Promise<void> {
  return enqueueTask(async () => {
    await flushLocked();
  });
}

export function clearCommunityQueue(): Promise<void> {
  return enqueueTask(async () => {
    await saveQueue([]);
  }, { allowDuringPrivateTransition: true });
}
