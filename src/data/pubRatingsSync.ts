/**
 * Bidirectional sync glue for personal pub ratings — wires the local store
 * (pubRatingsStore) to the backend WITHOUT touching any call-site.
 *
 * PUSH (subscribe-diff): `installPubRatingsSync` subscribes to the store's
 * `ratings` map and, on every change, diffs the previous vs next snapshot. For
 * each pubKey that changed it enqueues either an upsert (rating present/changed)
 * or a delete (rating gone). Because the existing UI just calls setRating /
 * clearRating, this captures every edit with zero changes to those components.
 *
 * PULL (restore): `restorePubRatings` fetches the server set on launch, merges
 * it in via the store's `hydrateRatings` (last-write-wins by updatedAt), then
 * pushes any local ratings the server is missing or has an older copy of, and
 * flushes the queue.
 *
 * The loop-breaker: hydrate writes to the same `ratings` map the push subscriber
 * watches, which would echo every pulled rating straight back out as an upsert.
 * A module-level `suppressSync` flag is raised around every hydrate so the diff
 * subscriber ignores store changes it caused itself.
 *
 * Deriving the wire payload from a pubKey: the store keys ratings only by their
 * geohash-8 `pubKey` and stores no lat/lng/name. We reconstruct lat/lng from the
 * cell centre via decodeGeohash8 (the server re-derives the SAME cache_key from
 * it), and look the pub name up from the tally history (any session at the same
 * pubKey); when unknown we send "".
 */

import { decodeGeohash8 } from './geohash';
import {
  enqueueRatingOp,
  flushPubRatingsQueue,
  getQueuedRatingDeletePubKeys,
  type RatingQueueItem,
} from './pubRatingsQueue';
import { fetchRatings, type WireRatingUpsert } from './pubRatingsClient';
import {
  usePubRatingsStore,
  type PubRating,
} from '@/stores/pubRatingsStore';
import { useTallyStore } from '@/stores/tallyStore';

/**
 * Raised while hydrate writes server data into the store, so the push subscriber
 * does not treat a PULLED change as a local edit and echo it back out.
 */
let suppressSync = false;

/** Best-effort pub name for a pubKey from the tally history (any session at the
 *  same cell), or '' when we have never counted a beer there. */
function pubNameForKey(pubKey: string): string {
  const { current, history } = useTallyStore.getState();
  if (current?.pubKey === pubKey && current.pubName) return current.pubName;
  const match = history.find((session) => session.pubKey === pubKey);
  return match?.pubName ?? '';
}

/** Build the upsert wire payload for a local rating at `pubKey`. */
function buildUpsertPayload(pubKey: string, rating: PubRating): WireRatingUpsert {
  const { lat, lng } = decodeGeohash8(pubKey);
  return {
    name: pubNameForKey(pubKey),
    lat,
    lng,
    verdict: rating.verdict ?? null,
    tag: rating.tag ?? null,
    note: rating.note ?? null,
    updated_at: rating.updatedAt,
  };
}

/** Build a timestamped empty rating tombstone for LWW-safe deletes. */
function buildDeletePayload(pubKey: string): WireRatingUpsert {
  const { lat, lng } = decodeGeohash8(pubKey);
  return {
    name: pubNameForKey(pubKey),
    lat,
    lng,
    verdict: null,
    tag: null,
    note: null,
    updated_at: new Date().toISOString(),
  };
}

/** Enqueue an upsert for a single local rating. */
function enqueueUpsert(pubKey: string, rating: PubRating): void {
  const item: RatingQueueItem = {
    op: 'upsert',
    pubKey,
    payload: buildUpsertPayload(pubKey, rating),
  };
  void enqueueRatingOp(item);
}

/** Enqueue a delete for a removed rating. */
function enqueueDelete(pubKey: string): void {
  void enqueueRatingOp({ op: 'delete', pubKey, payload: buildDeletePayload(pubKey) });
}

/**
 * Subscribe to the store and push every change. Returns the unsubscribe fn (kept
 * for symmetry / tests); the app installs this once for the process lifetime.
 */
export function installPubRatingsSync(): () => void {
  let prev = usePubRatingsStore.getState().ratings;

  return usePubRatingsStore.subscribe((state) => {
    const next = state.ratings;
    if (next === prev) return;
    // A pull-driven hydrate must not echo back out as a push.
    if (suppressSync) {
      prev = next;
      return;
    }

    const prevSnapshot = prev;
    prev = next;

    // Upserts: keys present in next whose rating object actually changed.
    for (const [pubKey, rating] of Object.entries(next)) {
      if (prevSnapshot[pubKey] !== rating) enqueueUpsert(pubKey, rating);
    }
    // Deletes: keys that existed before and are gone now.
    for (const pubKey of Object.keys(prevSnapshot)) {
      if (!(pubKey in next)) enqueueDelete(pubKey);
    }
  });
}

/**
 * Pull + merge the server's ratings, then push anything the server is missing or
 * has an older copy of, and flush the queue. Best-effort, never throws.
 *
 * Merge correctness:
 *   - The server omits empty ratings (they get deleted), so a missing key just
 *     means "server has nothing here" — we push our local copy.
 *   - Server verdict null maps to an ABSENT verdict in the local PubRating shape.
 *   - hydrateRatings does the actual last-write-wins; we run it under
 *     suppressSync so the merged-in entries are not echoed back as upserts.
 */
export async function restorePubRatings(signal?: AbortSignal): Promise<void> {
  // Apply queued tombstones before reading, when possible. If any delete remains
  // pending, skip that server row below so a cleared rating does not reappear.
  await flushPubRatingsQueue();
  const pendingDeleteKeys = await getQueuedRatingDeletePubKeys();
  const serverRatings = await fetchRatings(signal);
  if (serverRatings === null) {
    return;
  }

  // Map wire → local PubRating, keyed by pubKey (= cache_key).
  const serverByKey = new Map<string, PubRating>();
  const merged: { pubKey: string; rating: PubRating }[] = [];
  for (const wire of serverRatings) {
    if (pendingDeleteKeys.has(wire.cache_key)) continue;
    const rating: PubRating = { updatedAt: wire.updated_at };
    if (wire.verdict === 'like' || wire.verdict === 'dislike') rating.verdict = wire.verdict;
    if (wire.tag) rating.tag = wire.tag;
    if (wire.note) rating.note = wire.note;
    serverByKey.set(wire.cache_key, rating);
    merged.push({ pubKey: wire.cache_key, rating });
  }

  // Merge server → local (LWW), suppressing the push echo for the write.
  suppressSync = true;
  try {
    usePubRatingsStore.getState().hydrateRatings(merged);
  } finally {
    suppressSync = false;
  }

  // Push local ratings the server is missing, or where the local copy is newer.
  const localRatings = usePubRatingsStore.getState().ratings;
  for (const [pubKey, local] of Object.entries(localRatings)) {
    if (pendingDeleteKeys.has(pubKey)) continue;
    const server = serverByKey.get(pubKey);
    if (!server) {
      enqueueUpsert(pubKey, local);
      continue;
    }
    const localMs = Date.parse(local.updatedAt);
    const serverMs = Date.parse(server.updatedAt);
    if (Number.isFinite(localMs) && localMs > serverMs) {
      enqueueUpsert(pubKey, local);
    }
  }

  await flushPubRatingsQueue();
}
