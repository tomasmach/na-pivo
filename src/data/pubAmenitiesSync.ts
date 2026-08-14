/**
 * Bidirectional sync glue for "Zmapuj hospodu" community amenity votes — wires the
 * local store (pubAmenitiesStore) to the backend WITHOUT touching any call-site.
 *
 * Mirrors pubRatingsSync, but the merge unit is the INDIVIDUAL amenity vote, so the
 * subscribe-diff goes ONE LEVEL DEEPER (per (pubKey, amenityKey) entry, not per
 * pub). A stale push of one amenity must never clobber a sibling (spec §4.1/§4.7).
 *
 * PUSH (subscribe-diff): installPubAmenitiesSync subscribes to the store's `votes`
 * map and, on every change, diffs the previous vs next snapshot per amenity entry.
 * An appeared/changed entry → enqueueAmenityOp({op:'upsert'}); a removed entry →
 * enqueueAmenityOp({op:'delete'}) (a timestamped value:null tombstone). Because the
 * UI just calls setVote, this captures every tap with zero changes to components.
 *
 * PULL (restore): restorePubAmenities flushes the queue, reads the pending-delete
 * set, fetches the account's own votes, maps wire → entries (skipping any pair with
 * a pending local delete and dropping unknown keys), hydrates them under the
 * suppress flag (LWW), then pushes any local votes the server is missing or has an
 * older copy of, and flushes again. Aggregates are NOT pulled here — they refresh
 * via the Pub enrichment path.
 *
 * The loop-breaker: hydrate writes to the same `votes` map the push subscriber
 * watches, which would echo every pulled vote straight back out as an upsert. A
 * module-level `suppressSync` flag is raised STRICTLY SYNCHRONOUSLY around the
 * hydrateVotes call only (never across an await).
 *
 * Deriving the wire payload from a pub identity: the store keys votes by
 * cache_key::normalized_name so neighbouring businesses in one geohash-8 cell do
 * not mix. We decode lat/lng from the cache_key portion and look the display name
 * up from current/history, falling back to the normalized name in the identity.
 */

import { ensureAccount } from './account';
import { CURRENT_TAXONOMY_VERSION, isKnownAmenityKey, type AmenityKey } from './amenities';
import { decodeGeohash8 } from './geohash';
import {
  enqueueAmenityOp,
  flushPubAmenitiesQueue,
  getQueuedAmenityDeletes,
  type AmenityQueueItem,
} from './pubAmenitiesQueue';
import { fetchMyAmenityVotes, type WireAmenityVote } from './pubAmenitiesClient';
import {
  cacheKeyFromPubIdentityKey,
  nameFromPubIdentityKey,
  pubIdentityKey,
} from './pubIdentity';
import {
  usePubAmenitiesStore,
  type AmenityVoteEntry,
  type HydrateAmenityRow,
  type PubAmenityVotes,
} from '@/stores/pubAmenitiesStore';
import { useTallyStore } from '@/stores/tallyStore';

/**
 * Raised while hydrate writes server data into the store, so the push subscriber
 * does not treat a PULLED change as a local edit and echo it back out. Held
 * strictly synchronously around the hydrateVotes call only.
 */
let suppressSync = false;

/** Run local-only vote mutations without enqueueing server upsert/delete
 *  operations. Used for account-boundary wipes where local data must disappear
 *  from this device without deleting the signed-in account's server copy. */
export function runWithoutPubAmenitiesSync<T>(task: () => T): T {
  const previous = suppressSync;
  suppressSync = true;
  try {
    return task();
  } finally {
    suppressSync = previous;
  }
}

/**
 * Best-effort pub name for a pubKey. Prefers the live name from the tally store
 * (current session or any history entry at the same cell). Falls back to the
 * non-empty pubKey when we have never counted a beer there, because the backend
 * REQUIRES a non-blank name (geohash-8 collision guard, spec §4.2): an empty name
 * makes the PUT 400, which the queue classifies as a permanent error and DROPS the
 * vote forever. The pubKey is always present and non-empty, so it is a safe
 * stop-the-drop placeholder; it weakens the names_match collision guard only when
 * we genuinely don't know the name, which is strictly better than losing the vote.
 */
function pubNameForKey(pubKey: string): string {
  const cacheKey = cacheKeyFromPubIdentityKey(pubKey);
  const { current, history } = useTallyStore.getState();
  if (current?.pubKey === cacheKey && current.pubName) return current.pubName;
  const match = history.find((session) => session.pubKey === cacheKey);
  return match?.pubName || nameFromPubIdentityKey(pubKey) || cacheKey;
}

/**
 * Build the wire payload for ONE vote (set or retract), with an explicit name.
 * Exported so the sheet's live (online) submit path can PUT the exact same body
 * the queue would — same geohash-derived lat/lng, same taxonomy version — and
 * read back the XP envelope. `value: null` is a retraction tombstone. The pub
 * name is required non-blank by the backend (geohash-8 collision guard); callers
 * pass the live pub name (the sheet always has it).
 */
export function buildAmenityVoteWire(params: {
  pubKey: string;
  pubName: string;
  amenityKey: AmenityKey;
  value: 'yes' | 'no' | null;
  clientUpdatedAt: string;
}): WireAmenityVote {
  const { lat, lng } = decodeGeohash8(params.pubKey);
  return {
    name: params.pubName || params.pubKey,
    lat,
    lng,
    amenity_key: params.amenityKey,
    value: params.value,
    taxonomy_version: CURRENT_TAXONOMY_VERSION,
    client_updated_at: params.clientUpdatedAt,
  };
}

/** Build the upsert wire payload for a single local vote. */
function buildUpsertPayload(
  pubKey: string,
  amenityKey: AmenityKey,
  entry: AmenityVoteEntry,
): WireAmenityVote {
  const cacheKey = cacheKeyFromPubIdentityKey(pubKey);
  const { lat, lng } = decodeGeohash8(cacheKey);
  return {
    name: pubNameForKey(pubKey),
    lat,
    lng,
    amenity_key: amenityKey,
    value: entry.vote,
    taxonomy_version: CURRENT_TAXONOMY_VERSION,
    client_updated_at: entry.updatedAt,
  };
}

/** Build a timestamped value:null tombstone for an LWW-safe retraction. */
function buildDeletePayload(pubKey: string, amenityKey: AmenityKey): WireAmenityVote {
  const cacheKey = cacheKeyFromPubIdentityKey(pubKey);
  const { lat, lng } = decodeGeohash8(cacheKey);
  return {
    name: pubNameForKey(pubKey),
    lat,
    lng,
    amenity_key: amenityKey,
    value: null,
    taxonomy_version: CURRENT_TAXONOMY_VERSION,
    client_updated_at: new Date().toISOString(),
  };
}

/** Enqueue an upsert for a single local vote. */
function enqueueUpsert(pubKey: string, amenityKey: AmenityKey, entry: AmenityVoteEntry): void {
  const item: AmenityQueueItem = {
    op: 'upsert',
    pubKey,
    amenityKey,
    payload: buildUpsertPayload(pubKey, amenityKey, entry),
  };
  void enqueueAmenityOp(item);
}

/** Enqueue a delete (tombstone) for a removed vote. */
function enqueueDelete(pubKey: string, amenityKey: AmenityKey): void {
  void enqueueAmenityOp({
    op: 'delete',
    pubKey,
    amenityKey,
    payload: buildDeletePayload(pubKey, amenityKey),
  });
}

/** Diff two of a pub's vote maps and enqueue per-amenity upserts/deletes. */
function diffPub(pubKey: string, prevPub: PubAmenityVotes, nextPub: PubAmenityVotes): void {
  // Upserts: amenities present in next whose entry object actually changed.
  for (const [amenityKey, entry] of Object.entries(nextPub) as [AmenityKey, AmenityVoteEntry][]) {
    if (!entry) continue;
    if (prevPub[amenityKey] !== entry) enqueueUpsert(pubKey, amenityKey, entry);
  }
  // Deletes: amenities that existed before and are gone now.
  for (const amenityKey of Object.keys(prevPub) as AmenityKey[]) {
    if (!(amenityKey in nextPub)) enqueueDelete(pubKey, amenityKey);
  }
}

/**
 * Subscribe to the store and push every change. Returns the unsubscribe fn (kept
 * for symmetry / tests); the app installs this once for the process lifetime.
 */
export function installPubAmenitiesSync(): () => void {
  let prev = usePubAmenitiesStore.getState().votes;

  return usePubAmenitiesStore.subscribe((state) => {
    const next = state.votes;
    if (next === prev) return;
    // A pull-driven hydrate must not echo back out as a push.
    if (suppressSync) {
      prev = next;
      return;
    }

    const prevSnapshot = prev;
    prev = next;

    const EMPTY: PubAmenityVotes = {};
    // Pubs present (or changed) in next.
    for (const [pubKey, nextPub] of Object.entries(next)) {
      const prevPub = prevSnapshot[pubKey];
      if (prevPub === nextPub) continue;
      diffPub(pubKey, prevPub ?? EMPTY, nextPub);
    }
    // Pubs that existed before and are gone now → delete each of their amenities.
    for (const [pubKey, prevPub] of Object.entries(prevSnapshot)) {
      if (!(pubKey in next)) diffPub(pubKey, prevPub, EMPTY);
    }
  });
}

/**
 * Pull + merge the server's own votes, then push anything the server is missing or
 * has an older copy of, and flush the queue. Best-effort, never throws.
 *
 * Merge correctness:
 *   - Apply queued tombstones before reading; skip any pair with a pending delete
 *     so a cleared vote does not reappear.
 *   - Drop unknown amenity keys (forward-compat).
 *   - hydrateVotes does the actual per-(pubKey, amenityKey) LWW; we run it under
 *     suppressSync so the merged-in entries are not echoed back as upserts.
 */
/** Same pull gate as pubRatingsSync: local edits push at write time, so the
 * whole-collection pull is a repair pass that need not run on every foreground.
 * The queue flush above the gate always runs. */
const PULL_FRESH_MS = 5 * 60 * 1000;
let lastPulledAt = 0;
// Per-account: an account switch (including the anonymous → claim merge, which
// deliberately does NOT clear private stores) must pull for the new owner.
let lastPulledAccountId: string | null = null;

/** Account boundaries (logout, login, delete) clear the store — the next
 * restore must pull immediately for the new owner, not wait out the gate. */
export function resetPubAmenitiesPullGate(): void {
  lastPulledAt = 0;
  lastPulledAccountId = null;
}

export const resetPubAmenitiesPullGateForTests = resetPubAmenitiesPullGate;

export async function restorePubAmenities(signal?: AbortSignal): Promise<void> {
  await flushPubAmenitiesQueue();
  const accountId = (await ensureAccount(signal))?.accountId ?? null;
  if (
    accountId != null &&
    accountId === lastPulledAccountId &&
    Date.now() - lastPulledAt < PULL_FRESH_MS
  ) {
    return;
  }
  const pendingDeletes = await getQueuedAmenityDeletes();
  const serverVotes = await fetchMyAmenityVotes(signal);
  if (serverVotes === null) {
    return;
  }

  // Map wire → entries, keyed by (pubIdentityKey, amenityKey). Track the live
  // server copy so we can decide which local votes to push afterwards.
  const serverByPair = new Map<string, AmenityVoteEntry>();
  const merged: HydrateAmenityRow[] = [];
  for (const wire of serverVotes) {
    if (!isKnownAmenityKey(wire.amenity_key)) continue;
    const identityKey =
      wire.pub_identity_key || pubIdentityKey(wire.cache_key, wire.name ?? null);
    const pair = `${identityKey} ${wire.amenity_key}`;
    if (pendingDeletes.has(pair)) continue;
    if (wire.value == null) {
      merged.push({
        pubKey: identityKey,
        amenityKey: wire.amenity_key,
        entry: { tombstone: true, updatedAt: wire.client_updated_at },
      });
      continue;
    }
    const entry: AmenityVoteEntry = { vote: wire.value, updatedAt: wire.client_updated_at };
    serverByPair.set(pair, entry);
    merged.push({ pubKey: identityKey, amenityKey: wire.amenity_key, entry });
  }

  // Merge server → local (LWW), suppressing the push echo for the write.
  runWithoutPubAmenitiesSync(() => {
    usePubAmenitiesStore.getState().hydrateVotes(merged);
  });

  // Push local votes the server is missing, or where the local copy is newer.
  const localVotes = usePubAmenitiesStore.getState().votes;
  for (const [pubKey, pubVotes] of Object.entries(localVotes)) {
    for (const [amenityKey, entry] of Object.entries(pubVotes) as [AmenityKey, AmenityVoteEntry][]) {
      if (!entry) continue;
      const pair = `${pubKey} ${amenityKey}`;
      if (pendingDeletes.has(pair)) continue;
      const server = serverByPair.get(pair);
      if (!server) {
        enqueueUpsert(pubKey, amenityKey, entry);
        continue;
      }
      const localMs = Date.parse(entry.updatedAt);
      const serverMs = Date.parse(server.updatedAt);
      if (Number.isFinite(localMs) && localMs > serverMs) {
        enqueueUpsert(pubKey, amenityKey, entry);
      }
    }
  }

  await flushPubAmenitiesQueue();
  // Stamp only after the whole pass succeeded, so a failed merge/push retries
  // on the next foreground instead of waiting out the gate.
  lastPulledAt = Date.now();
  lastPulledAccountId = accountId;
}
