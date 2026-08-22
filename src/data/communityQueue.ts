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
import { isAllowedBeerVolume, isWeeklyHours, MAX_MENU_BEERS } from './communityHours';
import { geohash8 } from './geohash';
import { createCoalescingFlush, createQueueStorage, createQueueLock } from './createQueue';
import {
  isPrivateAccountMutationScopeCurrent,
  runPrivateAccountMutation,
} from './privateAccountBoundary';

const STORAGE_KEY = 'na-pivo-community-queue';
/** The stable dedup key for an entry: the geohash-8 cell of its coordinates. */
function entryCell(entry: CommunityEntry): string {
  return geohash8(entry.lat, entry.lng);
}

function isCommunityEntry(entry: unknown): entry is CommunityEntry {
  const e = entry as CommunityEntry;
  return (
    !!e &&
    typeof e.client_id === 'string' && !!e.client_id &&
    typeof e.name === 'string' && !!e.name.trim() &&
    typeof e.lat === 'number' && Number.isFinite(e.lat) && e.lat >= -90 && e.lat <= 90 &&
    typeof e.lng === 'number' && Number.isFinite(e.lng) && e.lng >= -180 && e.lng <= 180 &&
    (e.city === undefined || typeof e.city === 'string') &&
    (e.external_id === null || typeof e.external_id === 'string') &&
    // At least one of hours/beers must be present for a valid contribution.
    (e.hours !== undefined || e.beers !== undefined) &&
    (e.hours === undefined || isWeeklyHours(e.hours)) &&
    (e.beers === undefined || (
      Array.isArray(e.beers) &&
      e.beers.length <= MAX_MENU_BEERS &&
      e.beers.every((beer) =>
        !!beer &&
        typeof beer.name === 'string' &&
        !!beer.name.trim() &&
        (beer.price_czk === undefined || (
          typeof beer.price_czk === 'number' &&
          Number.isFinite(beer.price_czk) &&
          beer.price_czk >= 1 &&
          beer.price_czk <= 1000
        )) &&
        (beer.volume_ml === undefined || isAllowedBeerVolume(beer.volume_ml)),
      )
    )) &&
    (e.beer_menu_rotates === undefined || typeof e.beer_menu_rotates === 'boolean')
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<CommunityEntry>(
  STORAGE_KEY,
  isCommunityEntry,
);

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose entries. */
const runMutation = createQueueLock();

/** Attempts to send every queued entry, keeping only the ones that failed.
 *  Returns the delivered responses keyed by client_id so a caller can read the
 *  backend envelope (the Mapér XP snapshot) for the entry it just enqueued. */
async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const delivered = new Map<string, string>();
  for (const entry of queue) {
    if (signal.aborted) break;
    const result = await submitPubCommunity(entry, signal);
    if (result) delivered.set(entryCell(entry), entry.client_id);
  }
  if (delivered.size === 0) return;

  await runMutation(async () => {
    const current = await loadQueue();
    await saveQueue(current.filter((entry) =>
      delivered.get(entryCell(entry)) !== entry.client_id,
    ));
  });
}

const communityDelivery = createCoalescingFlush(flushUnlocked);

/**
 * Persists the contribution and immediately tries to sync the whole queue.
 * Resolves the backend response (incl. the Mapér XP envelope) when this entry
 * reached the backend on the first attempt, or null when it stays queued for a
 * later flush. Never throws.
 *
 * A newer edit of the same pub (same geohash-8 cell) replaces any older queued
 * submission for that pub — the older one is stale.
 */
export async function enqueuePubCommunity(entry: CommunityEntry): Promise<CommunityResponse | null> {
  try {
    return await runPrivateAccountMutation(async (scope) => {
      const persisted = await runMutation(async () => {
        const queue = await loadQueue();
        const cell = entryCell(entry);
        const deduped = queue.filter((queued) => entryCell(queued) !== cell);
        deduped.push(entry);
        return saveQueue(deduped);
      });
      if (!persisted || !isPrivateAccountMutationScopeCurrent(scope)) return null;

      const delivered = await submitPubCommunity(entry, scope.signal);
      if (!delivered || !isPrivateAccountMutationScopeCurrent(scope)) return null;
      await runMutation(async () => {
        const current = await loadQueue();
        await saveQueue(current.filter((queued) =>
          entryCell(queued) !== entryCell(entry) || queued.client_id !== entry.client_id,
        ));
      });
      return isPrivateAccountMutationScopeCurrent(scope) ? delivered : null;
    });
  } catch {
    // A credential transition owns the queue now; the durable row is either
    // cleared with the old account or retried after the boundary reopens.
    return null;
  }
}

/**
 * Retries all pending contributions. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushCommunityQueue(): Promise<void> {
  return communityDelivery.flush();
}

export function clearCommunityQueue(): Promise<void> {
  communityDelivery.abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  }, { allowDuringPrivateTransition: true });
}
