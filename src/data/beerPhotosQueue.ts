/**
 * Persistent retry queue for beer-photo diary uploads.
 *
 * A photo captured offline (or whose first upload failed) must not be lost, so
 * every upload op is persisted to AsyncStorage BEFORE the first send and
 * retried on each app launch / foreground — mirroring visitsQueue, including
 * the account-boundary abort.
 *
 * The picked image lives in the image-picker CACHE, which the OS may evict, so
 * the caller first copies it into a durable location via
 * persistBeerPhotoLocally() (<documentDirectory>/beer-photos/<clientId>.jpg)
 * and enqueues THAT uri. The durable file is deleted only after a successful
 * upload — and only AFTER the store swapped in the remote imageUrl, so the UI
 * never points at a dead file.
 *
 * Flush keep/drop rule (shared mobile retry contract):
 *   - 'ok' (2xx)              → markSynced in the store, delete the local file,
 *                               drop from queue.
 *   - 'permanent-error' (4xx) → markFailed in the store (photo stays visible
 *                               locally), drop from queue.
 *   - 'retry'                 → keep for the next flush.
 *
 * Dedup: one op per clientId, last write wins (uploads are idempotent by
 * client_id server-side, so a duplicate delivery is harmless anyway).
 */

import { Directory, File, Paths } from 'expo-file-system';

import {
  deleteBeerPhotoByClientId,
  uploadBeerPhoto,
  type BeerPhoto,
  type BeerPhotoVisibility,
} from './beerPhotosClient';
import {
  cancelBeerPhotoDeletionSuppression,
  completeBeerPhotoDeletionTombstone,
  isBeerPhotoDeletionPending,
  isBeerPhotoDeletionTombstoned,
  loadBeerPhotoDeletionTombstones,
  queueBeerPhotoDeletionTombstone,
  suppressBeerPhotoDeletion,
} from './beerPhotoDeletionTombstones';
import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import {
  beerPhotoSessionGeneration,
  invalidateBeerPhotoSessionGeneration,
  isBeerPhotoSessionFrozen,
  subscribeBeerPhotoSessionBoundary,
} from './beerPhotoSessionBoundary';
import type { QueueSyncResult } from './apiFetch';
import { enterPhotoContest } from './photoContestClient';
import { ensureAccount } from './account';
import {
  forgetAllBeerPhotoDeletionSessions,
  forgetBeerPhotoDeletionSession,
  getBeerPhotoDeletionSession,
  getPreferredBeerPhotoDeletionSession,
  rememberBeerPhotoDeletionSession,
} from './beerPhotoDeletionSync';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';

const STORAGE_KEY = 'na-pivo-beer-photos-queue';
/** Durable photo directory (inside documentDirectory, survives cache eviction). */
const PHOTOS_DIRECTORY = 'beer-photos';
/** Hard cap — only bites with a very long offline backlog. */
const MAX_QUEUE_LENGTH = 100;
/** Per-photo aborts; unlike the account abort, deleting c1 must not stop c2. */
const inFlightDeliveryControllers = new Map<string, AbortController>();
const orphanReleaseAuthorizations = new Map<
  string,
  { signature: string; pendingCode: string }
>();

/** One pending photo upload, keyed (and deduped) by clientId. */
export interface BeerPhotoUploadOp {
  clientId: string;
  /** Durable local uri (from persistBeerPhotoLocally). */
  localUri: string;
  caption: string;
  pubCacheKey?: string;
  pubName?: string;
  pubCity?: string;
  partyCode?: string;
  /**
   * Reserved table code awaiting create confirmation. While present the upload
   * stays durable but is not delivered, because the backend cannot attach a
   * photo to a table that does not exist yet.
   */
  pendingPartyCode?: string;
  /**
   * Non-destructive durable checkpoint for a confirmed-none recovery. The
   * reserved code remains intact, and flush additionally requires a live
   * launch authorization before delivering the photo without a table.
   */
  orphanReleaseCandidate?: true;
  /** Local-only association; deliberately never leaves the phone. */
  partyDrinkingDay?: string;
  visibility: BeerPhotoVisibility;
  /** ISO-8601 timestamp of when the photo was taken. */
  takenAt: string;
  /**
   * Durable intent to enter the photo in FotoPivař after upload. Keeping this
   * on the upload op makes "save + enter" work offline and across app restarts.
   */
  enterContest?: boolean;
  /**
   * Durable checkpoint written AFTER a successful upload but BEFORE the contest
   * POST is attempted. It carries the stable server photo, so after a crash or
   * restart the flush can finish (or retry) the contest entry without
   * uploading the file again. Optional — legacy stored ops predate it.
   */
  contestCheckpoint?: { photo: BeerPhoto };
}

function hasValidContestCheckpoint(
  value: unknown,
  opClientId: string,
  enterContest: unknown,
): boolean {
  if (value === undefined) return true;
  // A checkpoint without the durable contest intent makes no sense.
  if (enterContest !== true) return false;
  const photo = (value as { photo?: unknown } | null)?.photo;
  if (typeof photo !== 'object' || photo === null) return false;
  const p = photo as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    p.clientId === opClientId &&
    typeof p.imageUrl === 'string' &&
    typeof p.caption === 'string' &&
    typeof p.pubCacheKey === 'string' &&
    typeof p.pubName === 'string' &&
    typeof p.pubCity === 'string' &&
    typeof p.takenAt === 'string' &&
    typeof p.createdAt === 'string' &&
    (p.visibility === 'private' || p.visibility === 'friends') &&
    typeof p.inContest === 'boolean'
  );
}

function isQueueItem(value: unknown): value is BeerPhotoUploadOp {
  const op = value as BeerPhotoUploadOp;
  return (
    !!op &&
    typeof op.clientId === 'string' &&
    op.clientId.length > 0 &&
    typeof op.localUri === 'string' &&
    typeof op.caption === 'string' &&
    typeof op.takenAt === 'string' &&
    (op.visibility === 'private' || op.visibility === 'friends') &&
    (op.partyCode === undefined || typeof op.partyCode === 'string') &&
    (op.pendingPartyCode === undefined || typeof op.pendingPartyCode === 'string') &&
    (op.orphanReleaseCandidate === undefined || op.orphanReleaseCandidate === true) &&
    (op.partyDrinkingDay === undefined || typeof op.partyDrinkingDay === 'string') &&
    (op.enterContest === undefined || typeof op.enterContest === 'boolean') &&
    hasValidContestCheckpoint(op.contestCheckpoint, op.clientId, op.enterContest)
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<BeerPhotoUploadOp>(
  STORAGE_KEY,
  isQueueItem,
);

/** Serializes only AsyncStorage mutations; network delivery runs outside. */
const runMutation = createQueueLock({ protectPrivateAccount: false });

function photosDirectory(): Directory {
  return new Directory(Paths.document, PHOTOS_DIRECTORY);
}

/**
 * Copy a freshly-picked (cache) image into the durable diary directory:
 * <documentDirectory>/beer-photos/<clientId>.jpg. Returns the durable uri, or
 * falls back to the original uri when the copy fails (best-effort — the upload
 * then races OS cache eviction, which still beats dropping the photo).
 */
export async function persistBeerPhotoLocally(
  pickedUri: string,
  clientId: string,
): Promise<string> {
  if (isBeerPhotoSessionFrozen()) return pickedUri;
  const expectedBoundaryGeneration = beerPhotoSessionGeneration();
  try {
    const dir = photosDirectory();
    dir.create({ intermediates: true, idempotent: true });
    const destination = new File(dir, `${clientId}.jpg`);
    if (destination.exists) destination.delete();
    await new File(pickedUri).copy(destination);
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) {
      if (destination.exists) destination.delete();
      return pickedUri;
    }
    return destination.uri;
  } catch {
    return pickedUri;
  }
}

/** Best-effort delete of one durable diary file. Never throws. */
export function deleteBeerPhotoLocalFile(clientId: string): void {
  try {
    const file = new File(photosDirectory(), `${clientId}.jpg`);
    if (file.exists) file.delete();
  } catch {
    // Leaking one orphaned JPEG beats crashing a flush.
  }
}

/**
 * Wipe the whole durable diary directory at an account boundary.
 *
 * The boolean is intentionally observable by the strict session-boundary
 * coordinator. A leftover JPEG is private account data just like an
 * AsyncStorage row, so a credential transition must not silently cross the
 * boundary when the filesystem refused the delete.
 */
export function clearBeerPhotoLocalFiles(): boolean {
  try {
    const dir = photosDirectory();
    if (dir.exists) dir.delete();
    return !dir.exists;
  } catch {
    return false;
  }
}

function shouldRetryContestEntry(code: string): boolean {
  return (
    code === 'network' ||
    code === 'offline' ||
    code === 'account' ||
    code === 'auth' ||
    code === 'http_408' ||
    // UGC consent/policy gates are transient: the user just needs to accept
    // the updated terms, then the same photo can enter the contest.
    code === 'http_428' ||
    code === 'ugc_consent_required' ||
    code === 'ugc_policy_update_required' ||
    code === 'http_429' ||
    /^http_5\d\d$/.test(code)
  );
}

/** Best-effort cleanup when Expo reports success after its native abort. */
async function deleteLateUploadedTombstone(clientId: string): Promise<void> {
  const captured = getBeerPhotoDeletionSession(clientId);
  if (!captured) return;
  const current = await ensureAccount();
  const session = getPreferredBeerPhotoDeletionSession(
    clientId,
    captured.accountId,
    current,
  );
  if (session) await deleteBeerPhotoByClientId(clientId, undefined, session);
}

function withContestCheckpoint(
  op: BeerPhotoUploadOp,
  photo: BeerPhoto,
): BeerPhotoUploadOp {
  return { ...op, contestCheckpoint: { photo } };
}

/**
 * Atomically stamp the contest checkpoint onto the exact op being delivered.
 * Refuses (returns false) when the session boundary moved, the photo was
 * tombstoned, or a newer same-client op replaced the delivered one — the
 * replacement must never be touched by a stale delivery.
 */
async function persistContestCheckpoint(
  deliveredOp: BeerPhotoUploadOp,
  checkpointedOp: BeerPhotoUploadOp,
  expectedBoundaryGeneration: number,
): Promise<boolean> {
  return runMutation(async () => {
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
      isBeerPhotoDeletionTombstoned(deliveredOp.clientId)
    ) return false;
    const queue = await loadQueue();
    const index = queue.findIndex((item) => item.clientId === deliveredOp.clientId);
    if (index === -1 || signature(queue[index]) !== signature(deliveredOp)) {
      return false;
    }
    const rewritten = [...queue];
    rewritten[index] = checkpointedOp;
    return saveQueue(rewritten);
  });
}

/**
 * Atomically finalize a delivered upload: under the queue lock, revalidate that
 * the exact checkpointed op is still the current same-client queue item, the
 * session generation matches, and nothing is frozen or tombstoned — only then
 * await the synced-store persistence checkpoint. The local file is deleted
 * only after both that checkpoint and the trailing queue removal are durable,
 * so either failed AsyncStorage write leaves a fully retryable op. A queued
 * newer replacement can never be finalized by a stale delivery.
 */
async function finalizeSyncedUpload(
  checkpointedOp: BeerPhotoUploadOp,
  photo: BeerPhoto,
  expectedBoundaryGeneration: number,
): Promise<boolean> {
  return runMutation(async () => {
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
      isBeerPhotoDeletionTombstoned(checkpointedOp.clientId)
    ) return false;
    const queue = await loadQueue();
    const index = queue.findIndex(
      (item) => item.clientId === checkpointedOp.clientId,
    );
    if (index === -1 || signature(queue[index]) !== signature(checkpointedOp)) {
      return false;
    }
    let syncedPersisted: boolean;
    try {
      syncedPersisted = await useBeerPhotosStore
        .getState()
        .markSynced(checkpointedOp.clientId, photo);
    } catch {
      return false;
    }
    return (
      syncedPersisted &&
      !isBeerPhotoSessionFrozen() &&
      expectedBoundaryGeneration === beerPhotoSessionGeneration() &&
      !isBeerPhotoDeletionTombstoned(checkpointedOp.clientId)
    );
  });
}

/**
 * Atomically finalize a permanently-rejected upload under the queue lock with
 * the same exact-op/session/tombstone guards as finalizeSyncedUpload: a stale
 * delivery that lost its queue slot to a newer same-client replacement must
 * never flip the replacement's optimistic row to failed.
 */
async function finalizeFailedUpload(
  deliveredOp: BeerPhotoUploadOp,
  code: string | undefined,
  expectedBoundaryGeneration: number,
): Promise<boolean> {
  return runMutation(async () => {
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
      isBeerPhotoDeletionTombstoned(deliveredOp.clientId)
    ) return false;
    const queue = await loadQueue();
    const index = queue.findIndex((item) => item.clientId === deliveredOp.clientId);
    if (index === -1 || signature(queue[index]) !== signature(deliveredOp)) {
      return false;
    }
    useBeerPhotosStore.getState().markFailed(deliveredOp.clientId, code);
    return true;
  });
}

/** Delivery outcome plus the durable signature after deliver's own writes. */
interface DeliveryResult {
  status: QueueSyncResult;
  /** Delete the durable local image only after this op is durably removed. */
  deleteLocalFileAfterSettlement?: boolean;
  /**
   * Signature of the queued op as this delivery left it on disk — set once a
   * checkpoint has been stamped, so the flush can settle exactly that op.
   */
  durableSignature?: string;
}

async function deliver(
  op: BeerPhotoUploadOp,
  signal: AbortSignal,
  expectedBoundaryGeneration: number,
): Promise<DeliveryResult> {
  if (isBeerPhotoDeletionTombstoned(op.clientId)) {
    return { status: isBeerPhotoDeletionPending(op.clientId) ? 'ok' : 'retry' };
  }

  const controller = new AbortController();
  const abortForAccountBoundary = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', abortForAccountBoundary, { once: true });
  inFlightDeliveryControllers.set(op.clientId, controller);

  try {
    let photo: BeerPhoto;
    if (op.contestCheckpoint) {
      // Resume path: the upload already committed server-side (durable
      // checkpoint). Never upload again — only finish the contest intent.
      photo = op.contestCheckpoint.photo;
    } else {
      const result = await uploadBeerPhoto(
        op.localUri,
        {
          clientId: op.clientId,
          caption: op.caption,
          pubCacheKey: op.pubCacheKey,
          pubName: op.pubName,
          pubCity: op.pubCity,
          partyCode: op.partyCode,
          visibility: op.visibility,
          takenAt: op.takenAt,
        },
        controller.signal,
      );
      // A native upload can resolve successfully after its AbortSignal fired.
      // A durable deletion marker always wins and the by-client DELETE creates
      // a server tombstone that also beats a POST still processing on the server.
      if (isBeerPhotoDeletionTombstoned(op.clientId)) {
        if (
          result.status === 'ok' &&
          !signal.aborted &&
          expectedBoundaryGeneration === beerPhotoSessionGeneration()
        ) {
          await deleteLateUploadedTombstone(op.clientId);
        }
        return { status: isBeerPhotoDeletionPending(op.clientId) ? 'ok' : 'retry' };
      }
      // Account replacement is different from user deletion: never mutate the
      // new account's store, file set, or server rows with a late old result.
      if (
        signal.aborted ||
        isBeerPhotoSessionFrozen() ||
        expectedBoundaryGeneration !== beerPhotoSessionGeneration()
      ) {
        return { status: 'retry' };
      }
      if (result.status === 'permanent-error') {
        // Keep the local file: the photo stays visible (and retryable) in the
        // diary. The code drives the specific Czech error copy on the tile/detail.
        // Guarded like finalizeSyncedUpload — a stale rejection must never land
        // on a newer same-client replacement.
        await finalizeFailedUpload(op, result.code, expectedBoundaryGeneration);
        return { status: 'permanent-error' };
      }
      if (result.status !== 'ok') return { status: 'retry' };
      photo = result.photo;
      // A conflicting NONEMPTY echo means the server committed a DIFFERENT
      // photo under this client_id. Accepting it would put a foreign image in
      // the local diary and delete the local original — reject the delivery
      // instead: guarded permanent failure with a stable internal code, local
      // file retained so the detail screen's retry can re-enqueue it.
      if (photo.clientId && photo.clientId !== op.clientId) {
        await finalizeFailedUpload(
          op,
          'photo_identity_mismatch',
          expectedBoundaryGeneration,
        );
        return { status: 'permanent-error' };
      }
      // The backend echoes client_id back. A missing echo must not poison the
      // durable contest checkpoint (it validates against the op's clientId, and
      // an invalid checkpoint gets the whole op dropped on the next load) —
      // fill it from the op. A conflicting NONEMPTY echo is never rewritten.
      if (!photo.clientId) photo = { ...photo, clientId: op.clientId };
    }

    let checkpointedOp = op;
    if (op.enterContest && photo.id && photo.clientId === op.clientId) {
      if (!op.contestCheckpoint) {
        // Durable checkpoint BEFORE the contest POST: a crash from here on can
        // never force another upload after restart. If it cannot be made
        // durable, do not finalize — the next flush re-uploads (idempotent).
        checkpointedOp = withContestCheckpoint(op, photo);
        const persisted = await persistContestCheckpoint(
          op,
          checkpointedOp,
          expectedBoundaryGeneration,
        );
        if (!persisted) return { status: 'retry' };
        if (isBeerPhotoDeletionTombstoned(op.clientId)) {
          await deleteLateUploadedTombstone(op.clientId);
          return {
            status: isBeerPhotoDeletionPending(op.clientId) ? 'ok' : 'retry',
            durableSignature: signature(checkpointedOp),
          };
        }
        if (
          signal.aborted ||
          isBeerPhotoSessionFrozen() ||
          expectedBoundaryGeneration !== beerPhotoSessionGeneration()
        ) {
          return { status: 'retry', durableSignature: signature(checkpointedOp) };
        }
      }
      const contestResult = await enterPhotoContest(photo.id, controller.signal);
      const durableSignature = signature(checkpointedOp);
      if (isBeerPhotoDeletionTombstoned(op.clientId)) {
        await deleteLateUploadedTombstone(op.clientId);
        return {
          status: isBeerPhotoDeletionPending(op.clientId) ? 'ok' : 'retry',
          durableSignature,
        };
      }
      if (
        signal.aborted ||
        isBeerPhotoSessionFrozen() ||
        expectedBoundaryGeneration !== beerPhotoSessionGeneration()
      ) {
        return { status: 'retry', durableSignature };
      }
      if (!contestResult.ok && shouldRetryContestEntry(contestResult.code)) {
        // Keep both the durable file and queue op with its checkpoint. The next
        // flush resumes the contest with the same stable photo id, no re-upload.
        return { status: 'retry', durableSignature };
      }
      if (contestResult.ok) {
        photo = { ...photo, inContest: true };
      }
      // A hard contest rejection (most commonly a missing nickname) must not
      // turn a successfully uploaded diary photo into a failed photo. Finalize
      // the upload normally; the UI explains that contest entry did not land.
      if (
        await finalizeSyncedUpload(checkpointedOp, photo, expectedBoundaryGeneration)
      ) {
        return {
          status: 'ok',
          durableSignature,
          deleteLocalFileAfterSettlement: true,
        };
      }
      // Lost the queue slot (replaced/removed mid-delivery): retry with the
      // durable signature — the trailing flush settles whichever op is current.
      return { status: 'retry', durableSignature };
    }
    // Check once more immediately before the store write. JavaScript cannot
    // interleave the synchronous markSynced after this guard.
    if (isBeerPhotoDeletionTombstoned(op.clientId)) {
      await deleteLateUploadedTombstone(op.clientId);
      return {
        status: isBeerPhotoDeletionPending(op.clientId) ? 'ok' : 'retry',
        durableSignature: signature(checkpointedOp),
      };
    }
    // Store FIRST (the UI flips to the remote imageUrl), only then delete the
    // local file — never the other way around, or the diary shows a dead uri.
    // Finalized under the exact-op guard: a stale delivery that lost its queue
    // slot to a newer same-client replacement must not mutate the replacement's
    // store row nor delete its (now newer) durable file.
    if (
      await finalizeSyncedUpload(checkpointedOp, photo, expectedBoundaryGeneration)
    ) {
      return {
        status: 'ok',
        durableSignature: signature(checkpointedOp),
        deleteLocalFileAfterSettlement: true,
      };
    }
    return { status: 'retry', durableSignature: signature(checkpointedOp) };
  } finally {
    signal.removeEventListener('abort', abortForAccountBoundary);
    if (inFlightDeliveryControllers.get(op.clientId) === controller) {
      inFlightDeliveryControllers.delete(op.clientId);
    }
  }
}

/** Stable content signature — object identity is lost across the JSON round-trip. */
function signature(op: BeerPhotoUploadOp): string {
  return JSON.stringify(op);
}

function hasOrphanReleaseAuthorization(op: BeerPhotoUploadOp): boolean {
  if (!op.pendingPartyCode || op.orphanReleaseCandidate !== true) return false;
  const authorization = orphanReleaseAuthorizations.get(op.clientId);
  if (
    !authorization ||
    authorization.signature !== signature(op) ||
    authorization.pendingCode !== op.pendingPartyCode.toUpperCase()
  ) {
    if (authorization) orphanReleaseAuthorizations.delete(op.clientId);
    return false;
  }
  return true;
}

/**
 * Grace window before a queue-less 'pending' store entry is declared orphaned.
 * Older app versions wrote the store entry before the queue op, so a crash (or
 * a failed AsyncStorage write) could leave a pending photo with no durable op.
 * Keep the grace window for those already-persisted store snapshots.
 */
const ORPHANED_PENDING_MIN_AGE_MS = 60_000;

/**
 * Compatibility repair: an older snapshot stuck 'pending' in the store with NO
 * matching queue op (from the former store-before-queue ordering or an overflow
 * drop that raced persistence) would spin forever — no flush will ever settle it.
 * Flip such entries to 'failed' so the diary shows the honest state and the
 * detail screen's retry (re-enqueue of the kept local file) works.
 */
function reconcileOrphanedPending(queue: BeerPhotoUploadOp[]): void {
  const store = useBeerPhotosStore.getState();
  const photos = store.photos ?? [];
  if (photos.length === 0) return;
  const queued = new Set(queue.map((op) => op.clientId));
  const now = Date.now();
  for (const photo of photos) {
    if (photo.syncState !== 'pending' || queued.has(photo.clientId)) continue;
    const bornMs = Date.parse(photo.createdAt || photo.takenAt);
    if (Number.isFinite(bornMs) && now - bornMs < ORPHANED_PENDING_MIN_AGE_MS) continue;
    store.markFailed(photo.clientId);
  }
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  if (isBeerPhotoSessionFrozen()) return;
  const expectedBoundaryGeneration = beerPhotoSessionGeneration();
  const [currentSession, tombstoneLoad] = await Promise.all([
    ensureAccount(signal),
    loadBeerPhotoDeletionTombstones(),
  ]);
  if (
    signal.aborted ||
    isBeerPhotoSessionFrozen() ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
    !tombstoneLoad.ok
  ) return;
  const tombstones = tombstoneLoad.tombstones;

  // A crash can happen after persisting the tombstone but before removing the
  // old upload op/store row. Repair all three before any network delivery.
  const applicableTombstones = tombstones.filter((tombstone) => {
    const captured = getBeerPhotoDeletionSession(tombstone.clientId);
    return (
      captured?.accountId === tombstone.accountId ||
      currentSession?.accountId === tombstone.accountId
    );
  });
  const tombstonedClientIds = new Set(
    applicableTombstones.map((tombstone) => tombstone.clientId),
  );
  for (const { clientId } of applicableTombstones) {
    useBeerPhotosStore.getState().removePhoto(clientId);
  }
  const queueRemoval = await runMutation(async () => {
    const current = await loadQueue();
    const filtered = current.filter((op) => !tombstonedClientIds.has(op.clientId));
    if (filtered.length === current.length) {
      return { persisted: true, queue: current };
    }
    const persisted = await saveQueue(filtered);
    return { persisted, queue: persisted ? filtered : current };
  });
  if (
    signal.aborted ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration()
  ) return;
  // The deletion marker is durable, but the queued upload is still a second
  // durable instruction for the same photo. Do not acknowledge either side of
  // the delete until that exact clientId is absent from the queue on disk.
  if (!queueRemoval.persisted) return;
  const queue = queueRemoval.queue;

  for (const tombstone of applicableTombstones) {
    if (
      signal.aborted ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) return;
    const session = getPreferredBeerPhotoDeletionSession(
      tombstone.clientId,
      tombstone.accountId,
      currentSession,
    );
    if (
      session?.accountId === tombstone.accountId &&
      await deleteBeerPhotoByClientId(tombstone.clientId, signal, session)
    ) {
      deleteBeerPhotoLocalFile(tombstone.clientId);
      const completed = await completeBeerPhotoDeletionTombstone(
        tombstone.clientId,
        tombstone.accountId,
      );
      if (completed) forgetBeerPhotoDeletionSession(tombstone.clientId);
    }
  }
  if (queue.length === 0) {
    reconcileOrphanedPending([]);
    return;
  }

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  const deleteLocalFileAfterSettlement = new Set<string>();
  /** Signature each delivery left on disk (set once a checkpoint is stamped). */
  const deliveredSignatures = new Map<string, string>();
  for (const op of queue) {
    // Stop before the next upload once an account-boundary clear has aborted
    // us, so a previous account's photos are never uploaded under the session
    // that replaces it.
    if (
      signal.aborted ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) break;
    // A table code reserved by an in-flight create is local intent, not a
    // backend foreign key yet. Keep the op queued until the evening store
    // confirms or rejects that create.
    if (op.pendingPartyCode && !hasOrphanReleaseAuthorization(op)) continue;
    attempted.set(op.clientId, signature(op));
    const outcome = await deliver(op, signal, expectedBoundaryGeneration);
    if (outcome.durableSignature) {
      deliveredSignatures.set(op.clientId, outcome.durableSignature);
    }
    if (outcome.deleteLocalFileAfterSettlement) {
      deleteLocalFileAfterSettlement.add(op.clientId);
    }
    if (outcome.status !== 'retry') settled.add(op.clientId);
  }

  const remaining = await runMutation(async () => {
    if (expectedBoundaryGeneration !== beerPhotoSessionGeneration()) return [];
    const current = await loadQueue();
    const kept = current.filter((op) => {
      const attemptedSignature = attempted.get(op.clientId);
      if (attemptedSignature === undefined) return true;
      // The checkpoint stamped mid-delivery changes the durable signature —
      // match either the pre-delivery op or exactly what this delivery wrote.
      // Anything else is a newer replacement and must never be touched here.
      const currentSignature = signature(op);
      const isSameAttempt =
        currentSignature === attemptedSignature ||
        currentSignature === deliveredSignatures.get(op.clientId);
      if (!isSameAttempt) return true;
      return !settled.has(op.clientId);
    });
    const persisted = await saveQueue(kept);
    if (!persisted) return current;
    // This is the commit point for deleting a durable image: the exact upload
    // op is no longer on disk, so a process restart cannot retry it.
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) return kept;
    for (const op of current) {
      if (!deleteLocalFileAfterSettlement.has(op.clientId)) continue;
      const currentSignature = signature(op);
      const attemptedSignature = attempted.get(op.clientId);
      if (
        currentSignature === attemptedSignature ||
        currentSignature === deliveredSignatures.get(op.clientId)
      ) {
        deleteBeerPhotoLocalFile(op.clientId);
      }
    }
    return kept;
  });

  if (
    signal.aborted ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration()
  ) return;

  const remainingSignatures = new Map(
    remaining.map((op) => [op.clientId, signature(op)]),
  );
  const remainingPendingCodes = new Set(
    remaining.flatMap((op) =>
      op.pendingPartyCode ? [op.pendingPartyCode.toUpperCase()] : [],
    ),
  );
  const releasedPendingCodes = new Set<string>();
  for (const [clientId, authorization] of orphanReleaseAuthorizations) {
    const remainingSignature = remainingSignatures.get(clientId);
    if (remainingSignature === authorization.signature) continue;
    // A durable contest checkpoint legitimately changes the same attempted
    // op's signature. Carry the authorization forward for its retry.
    if (
      remainingSignature &&
      attempted.get(clientId) === authorization.signature &&
      deliveredSignatures.get(clientId) === remainingSignature
    ) {
      orphanReleaseAuthorizations.set(clientId, {
        ...authorization,
        signature: remainingSignature,
      });
      continue;
    }
    orphanReleaseAuthorizations.delete(clientId);
    if (!remainingPendingCodes.has(authorization.pendingCode)) {
      releasedPendingCodes.add(authorization.pendingCode);
    }
  }
  for (const code of releasedPendingCodes) {
    useBeerPhotosStore.getState().resolvePendingPartyAssociation(code, null);
  }

  // Skip the repair when aborted (account boundary) — the store may already
  // belong to the account that replaces this one.
  if (
    !signal.aborted &&
    expectedBoundaryGeneration === beerPhotoSessionGeneration()
  ) reconcileOrphanedPending(remaining);
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(
  flushUnlocked,
  { protectPrivateAccount: false },
);

subscribeBeerPhotoSessionBoundary(({ frozen }) => {
  if (frozen) {
    orphanReleaseAuthorizations.clear();
    for (const controller of inFlightDeliveryControllers.values()) controller.abort();
    abortInFlight();
    return;
  }
  // Resume retained anonymous-merge uploads only after SecureStore exposes B;
  // on an aborted transition this simply retries them under unchanged A.
  void _flush();
});

/**
 * Outcome of staging one photo for durable, offline-safe delivery. The outer
 * promise settles as soon as the AsyncStorage write has succeeded or failed;
 * network delivery continues in `completion` so the compose sheet never waits
 * on the network before closing.
 */
export interface BeerPhotoEnqueueResult {
  /** False means the queue write failed and the photo must not be confirmed. */
  persisted: boolean;
  /** Immediate upload attempt; an offline retry may remain queued afterwards. */
  completion: Promise<void>;
}

/**
 * Persist the upload op before exposing the optimistic diary row, then start an
 * immediate delivery attempt. `op.localUri` must already be durable (from
 * persistBeerPhotoLocally). Storage failures are returned to the caller and do
 * not create a queue-less photo that another surface could publish.
 */
export async function enqueueBeerPhoto(
  op: BeerPhotoUploadOp,
): Promise<BeerPhotoEnqueueResult> {
  if (
    isBeerPhotoSessionFrozen() ||
    isBeerPhotoDeletionTombstoned(op.clientId)
  ) {
    return { persisted: false, completion: Promise.resolve() };
  }
  const expectedBoundaryGeneration = beerPhotoSessionGeneration();
  const mutation = await runMutation(async () => {
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) {
      return {
        persisted: false,
        wrote: false,
        overflow: [],
        previousQueue: null,
        writtenQueue: null,
      };
    }
    const queue = await loadQueue();
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) {
      return {
        persisted: false,
        wrote: false,
        overflow: [],
        previousQueue: null,
        writtenQueue: null,
      };
    }
    const deduped = queue.filter((existing) => existing.clientId !== op.clientId);
    deduped.push(op);
    const overflow = deduped.slice(0, Math.max(0, deduped.length - MAX_QUEUE_LENGTH));
    const writtenQueue = deduped.slice(-MAX_QUEUE_LENGTH);
    const persisted = await saveQueue(writtenQueue);
    const boundaryMatches =
      !isBeerPhotoSessionFrozen() &&
      expectedBoundaryGeneration === beerPhotoSessionGeneration();
    return {
      persisted: persisted && boundaryMatches,
      wrote: persisted,
      overflow: persisted && boundaryMatches ? overflow : [],
      previousQueue: persisted ? queue : null,
      writtenQueue: persisted ? writtenQueue : null,
    };
  });
  // Check again immediately before touching the optimistic store / starting a
  // flush: clearBeerPhotosQueue may have begun after the locked write settled
  // but before this outer continuation resumed.
  if (
    !mutation.persisted ||
    isBeerPhotoSessionFrozen() ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
    isBeerPhotoDeletionTombstoned(op.clientId)
  ) {
    if (mutation.wrote) {
      await runMutation(async () => {
        const queue = await loadQueue();
        // Restore the exact prior snapshot only if our write is still the
        // latest one. An account clear may have acquired the lock first; its
        // empty queue must never be resurrected by this rollback.
        if (
          mutation.previousQueue &&
          mutation.writtenQueue &&
          JSON.stringify(queue) === JSON.stringify(mutation.writtenQueue)
        ) {
          await saveQueue(mutation.previousQueue);
        }
      });
    }
    return { persisted: false, completion: Promise.resolve() };
  }

  // The durable queue is now the source of truth. Only at this point may the
  // optimistic row become visible to FinishNightScreen or any other publisher.
  useBeerPhotosStore.getState().addPendingPhoto(op);

  // Overflow-dropped ops will never flush — mark them failed (local file KEPT,
  // so the detail screen's retry can re-enqueue) instead of leaving the tiles
  // stuck on "pending" forever.
  for (const droppedOp of mutation.overflow) {
    useBeerPhotosStore.getState().markFailed(droppedOp.clientId, 'queue_overflow');
  }
  return { persisted: true, completion: flushBeerPhotosQueue() };
}

/**
 * Retries all pending photo uploads. Call on app launch and on returning to
 * the foreground — both fire-and-forget. Never throws; trailing-edge coalesced.
 */
export function flushBeerPhotosQueue(): Promise<void> {
  if (isBeerPhotoSessionFrozen()) return Promise.resolve();
  return _flush();
}

/**
 * Resolve photos captured while a Party table POST was still in flight.
 *
 * The queue rewrite is durable before the optimistic store changes. Success
 * attaches the confirmed code and immediately flushes; failure releases the
 * photo as an ordinary unassociated diary upload instead of freezing it
 * forever. Matching is case-insensitive because join codes are spoken/typed.
 */
export async function resolveBeerPhotoPartyAssociation(
  pendingPartyCode: string,
  confirmedPartyCode: string | null,
  options: { authoritative?: boolean } = {},
): Promise<boolean> {
  if (isBeerPhotoSessionFrozen()) return false;
  const expectedBoundaryGeneration = beerPhotoSessionGeneration();
  const normalizedPending = pendingPartyCode.toUpperCase();
  const normalizedConfirmed = confirmedPartyCode?.toUpperCase() ?? null;
  const mutation = await runMutation(async () => {
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) return { persisted: false, changed: false };
    const queue = await loadQueue();
    if (
      options.authoritative === false &&
      queue.some(
        (op) =>
          op.pendingPartyCode?.toUpperCase() === normalizedPending &&
          op.orphanReleaseCandidate === true,
      )
    ) {
      // A cold restore is only a bounded cache hint. A durable confirmed-none
      // candidate is newer evidence and must survive until a live server
      // refresh either confirms this table or reauthorizes its release.
      return { persisted: true, changed: false };
    }
    let changed = false;
    const rewritten = queue.map((op) => {
      if (op.pendingPartyCode?.toUpperCase() !== normalizedPending) return op;
      changed = true;
      const {
        pendingPartyCode: _pendingPartyCode,
        partyCode: _partyCode,
        orphanReleaseCandidate: _orphanReleaseCandidate,
        ...rest
      } = op;
      return normalizedConfirmed
        ? { ...rest, partyCode: normalizedConfirmed }
        : rest;
    });
    if (!changed) return { persisted: true, changed: false };
    return { persisted: await saveQueue(rewritten), changed: true };
  });
  if (
    !mutation.persisted ||
    isBeerPhotoSessionFrozen() ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration()
  ) return false;
  if (mutation.changed) {
    for (const [clientId, authorization] of orphanReleaseAuthorizations) {
      if (authorization.pendingCode === normalizedPending) {
        orphanReleaseAuthorizations.delete(clientId);
      }
    }
    useBeerPhotosStore.getState().resolvePendingPartyAssociation(
      normalizedPending,
      normalizedConfirmed,
    );
  }
  await flushBeerPhotosQueue();
  return true;
}

/**
 * Recover photos left behind when the process died during table creation.
 *
 * A successful current-evening refresh resolves the reserved code normally.
 * When that same authoritative refresh confirms there is no active table,
 * every otherwise-unowned reservation is released as a normal diary upload.
 * `canRelease` closes the race with a new table starting while the durable
 * checkpoint is written. Once the final guard passes, the authoritative
 * no-table decision is committed for those exact ops; a later table cannot
 * retroactively reattach them. The reserved code is never removed here, so a
 * failed guard, storage failure or process crash needs no destructive rollback.
 */
export async function releaseOrphanedBeerPhotoPartyAssociations(
  canRelease: () => boolean = () => true,
  protectedPartyCode?: string,
): Promise<boolean> {
  if (isBeerPhotoSessionFrozen() || !canRelease()) return false;
  const expectedBoundaryGeneration = beerPhotoSessionGeneration();
  const protectedPending = protectedPartyCode?.trim().toUpperCase();
  const mutation = await runMutation(async () => {
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
      !canRelease()
    ) return { persisted: false, candidates: [], codes: [] };

    const previous = await loadQueue();
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
      !canRelease()
    ) return { persisted: false, candidates: [], codes: [] };

    const canMark = (op: BeerPhotoUploadOp) =>
      Boolean(
        op.pendingPartyCode &&
        op.pendingPartyCode.toUpperCase() !== protectedPending,
      );
    const codes = Array.from(
      new Set(
        previous.flatMap((op) =>
          canMark(op) ? [op.pendingPartyCode!.toUpperCase()] : [],
        ),
      ),
    );
    if (codes.length === 0) {
      return { persisted: true, candidates: [], codes };
    }
    const rewritten = previous.map((op) => {
      if (!canMark(op)) return op;
      return { ...op, orphanReleaseCandidate: true as const };
    });
    return {
      persisted: await saveQueue(rewritten),
      candidates: rewritten.flatMap((op) =>
        canMark(op)
          ? [{
              clientId: op.clientId,
              pendingCode: op.pendingPartyCode!.toUpperCase(),
              signature: signature(op),
            }]
          : [],
      ),
      codes,
    };
  });

  if (!mutation.persisted) return false;
  if (
    isBeerPhotoSessionFrozen() ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration() ||
    !canRelease()
  ) {
    for (const candidate of mutation.candidates) {
      orphanReleaseAuthorizations.delete(candidate.clientId);
    }
    return false;
  }

  for (const candidate of mutation.candidates) {
    orphanReleaseAuthorizations.set(candidate.clientId, {
      signature: candidate.signature,
      pendingCode: candidate.pendingCode,
    });
  }

  await flushBeerPhotosQueue();
  if (
    isBeerPhotoSessionFrozen() ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration()
  ) return false;
  return true;
}

/**
 * Cancel ONE queued or in-flight upload (the pending-photo delete flow).
 * Persists the deletion intent BEFORE dropping the upload op, aborts only this
 * photo's native request, and schedules server tombstone delivery. False means
 * either the deletion intent or removal of the conflicting durable upload op
 * could not be saved; callers must keep the photo and local file visible so an
 * explicit or launch retry can finish safely.
 */
export async function removeQueuedBeerPhoto(clientId: string): Promise<boolean> {
  if (isBeerPhotoSessionFrozen()) return false;
  const expectedBoundaryGeneration = beerPhotoSessionGeneration();
  suppressBeerPhotoDeletion(clientId);
  inFlightDeliveryControllers.get(clientId)?.abort();
  const session = await ensureAccount();
  if (
    !session ||
    isBeerPhotoSessionFrozen() ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration()
  ) {
    cancelBeerPhotoDeletionSuppression(clientId);
    return false;
  }
  rememberBeerPhotoDeletionSession(clientId, session);
  const tombstoneWrite = queueBeerPhotoDeletionTombstone(
    clientId,
    session.accountId,
  );
  const persisted = await tombstoneWrite;
  if (
    !persisted ||
    isBeerPhotoSessionFrozen() ||
    expectedBoundaryGeneration !== beerPhotoSessionGeneration()
  ) {
    forgetBeerPhotoDeletionSession(clientId);
    cancelBeerPhotoDeletionSuppression(clientId);
    return false;
  }

  const removed = await runMutation(async () => {
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) return false;
    const queue = await loadQueue();
    if (
      isBeerPhotoSessionFrozen() ||
      expectedBoundaryGeneration !== beerPhotoSessionGeneration()
    ) return false;
    const persisted = await saveQueue(
      queue.filter((op) => op.clientId !== clientId),
    );
    return (
      persisted &&
      !isBeerPhotoSessionFrozen() &&
      expectedBoundaryGeneration === beerPhotoSessionGeneration()
    );
  });
  if (!removed) return false;
  // If a flush is active this becomes its trailing edge, after the cancelled
  // delivery has resolved. Otherwise it immediately sends the server marker.
  void flushBeerPhotosQueue();
  return true;
}

/**
 * Drop all pending uploads without attempting delivery (account boundary).
 * Account-scoped deletion tombstones deliberately survive so they can never
 * be sent as the replacement account and can retry if their owner signs in.
 * Aborts an in-flight flush first — its network loop runs outside runMutation,
 * so without this it could keep uploading the previous account's photos under
 * the session that replaces it.
 */
export function clearBeerPhotosQueue(): Promise<void> {
  // Invalidate old enqueues synchronously, before this clear can yield while it
  // waits for the queue lock.
  invalidateBeerPhotoSessionGeneration();
  orphanReleaseAuthorizations.clear();
  for (const controller of inFlightDeliveryControllers.values()) controller.abort();
  forgetAllBeerPhotoDeletionSessions();
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}
