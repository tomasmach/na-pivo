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

import { uploadBeerPhoto, type BeerPhotoVisibility } from './beerPhotosClient';
import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import type { QueueSyncResult } from './apiFetch';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';

const STORAGE_KEY = 'na-pivo-beer-photos-queue';
/** Durable photo directory (inside documentDirectory, survives cache eviction). */
const PHOTOS_DIRECTORY = 'beer-photos';
/** Hard cap — only bites with a very long offline backlog. */
const MAX_QUEUE_LENGTH = 100;

/** One pending photo upload, keyed (and deduped) by clientId. */
export interface BeerPhotoUploadOp {
  clientId: string;
  /** Durable local uri (from persistBeerPhotoLocally). */
  localUri: string;
  caption: string;
  pubCacheKey?: string;
  pubName?: string;
  pubCity?: string;
  visibility: BeerPhotoVisibility;
  /** ISO-8601 timestamp of when the photo was taken. */
  takenAt: string;
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
    (op.visibility === 'private' || op.visibility === 'friends')
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<BeerPhotoUploadOp>(
  STORAGE_KEY,
  isQueueItem,
);

/** Serializes only AsyncStorage mutations; network delivery runs outside. */
const runMutation = createQueueLock();

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
  try {
    const dir = photosDirectory();
    dir.create({ intermediates: true, idempotent: true });
    const destination = new File(dir, `${clientId}.jpg`);
    if (destination.exists) destination.delete();
    await new File(pickedUri).copy(destination);
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

/** Best-effort wipe of the whole durable diary directory (account boundary). */
export function clearBeerPhotoLocalFiles(): void {
  try {
    const dir = photosDirectory();
    if (dir.exists) dir.delete();
  } catch {
    // Same trade-off as above.
  }
}

async function deliver(op: BeerPhotoUploadOp, signal: AbortSignal): Promise<QueueSyncResult> {
  const result = await uploadBeerPhoto(
    op.localUri,
    {
      clientId: op.clientId,
      caption: op.caption,
      pubCacheKey: op.pubCacheKey,
      pubName: op.pubName,
      pubCity: op.pubCity,
      visibility: op.visibility,
      takenAt: op.takenAt,
    },
    signal,
  );
  if (result.status === 'ok') {
    // Store FIRST (the UI flips to the remote imageUrl), only then delete the
    // local file — never the other way around, or the diary shows a dead uri.
    useBeerPhotosStore.getState().markSynced(op.clientId, result.photo);
    deleteBeerPhotoLocalFile(op.clientId);
    return 'ok';
  }
  if (result.status === 'permanent-error') {
    // Keep the local file: the photo stays visible (and retryable) in the
    // diary. The code drives the specific Czech error copy on the tile/detail.
    useBeerPhotosStore.getState().markFailed(op.clientId, result.code);
    return 'permanent-error';
  }
  return 'retry';
}

/** Stable content signature — object identity is lost across the JSON round-trip. */
function signature(op: BeerPhotoUploadOp): string {
  return JSON.stringify(op);
}

/**
 * Grace window before a queue-less 'pending' store entry is declared orphaned.
 * enqueueBeerPhoto writes the store entry BEFORE the queue op, so a concurrent
 * flush may briefly see a fresh pending photo with no op — only entries older
 * than this are reconciled to 'failed'.
 */
const ORPHANED_PENDING_MIN_AGE_MS = 60_000;

/**
 * Crash-window repair: a photo stuck 'pending' in the store with NO matching
 * queue op (crash between addPendingPhoto and saveQueue, or an overflow drop
 * that raced persistence) would spin forever — no flush will ever settle it.
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
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) {
    reconcileOrphanedPending([]);
    return;
  }

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const op of queue) {
    // Stop before the next upload once an account-boundary clear has aborted
    // us, so a previous account's photos are never uploaded under the session
    // that replaces it.
    if (signal.aborted) break;
    attempted.set(op.clientId, signature(op));
    const result = await deliver(op, signal);
    if (result !== 'retry') settled.add(op.clientId);
  }

  const remaining = await runMutation(async () => {
    const current = await loadQueue();
    const kept = current.filter((op) => {
      const sig = attempted.get(op.clientId);
      if (sig === undefined || sig !== signature(op)) return true;
      return !settled.has(op.clientId);
    });
    await saveQueue(kept);
    return kept;
  });

  // Skip the repair when aborted (account boundary) — the store may already
  // belong to the account that replaces this one.
  if (!signal.aborted) reconcileOrphanedPending(remaining);
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

/**
 * Record one photo in the local diary (optimistic pending entry), persist the
 * upload op, then immediately try to flush. `op.localUri` must already be
 * durable (persistBeerPhotoLocally). Never throws.
 */
export async function enqueueBeerPhoto(op: BeerPhotoUploadOp): Promise<void> {
  useBeerPhotosStore.getState().addPendingPhoto(op);
  const dropped = await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => existing.clientId !== op.clientId);
    deduped.push(op);
    const overflow = deduped.slice(0, Math.max(0, deduped.length - MAX_QUEUE_LENGTH));
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
    return overflow;
  });
  // Overflow-dropped ops will never flush — mark them failed (local file KEPT,
  // so the detail screen's retry can re-enqueue) instead of leaving the tiles
  // stuck on "pending" forever.
  for (const droppedOp of dropped) {
    useBeerPhotosStore.getState().markFailed(droppedOp.clientId, 'queue_overflow');
  }
  await flushBeerPhotosQueue();
}

/**
 * Retries all pending photo uploads. Call on app launch and on returning to
 * the foreground — both fire-and-forget. Never throws; trailing-edge coalesced.
 */
export function flushBeerPhotosQueue(): Promise<void> {
  return _flush();
}

/**
 * Cancel ONE queued upload (the "delete a still-pending photo" flow). Removes
 * the op from the queue so future flushes skip it. Best-effort against an
 * in-flight flush: if delivery already started the upload may still land, but
 * the caller also drops the store entry, so the next server reconcile is the
 * worst case — never a crash or a dead UI entry.
 */
export function removeQueuedBeerPhoto(clientId: string): Promise<void> {
  return runMutation(async () => {
    const queue = await loadQueue();
    await saveQueue(queue.filter((op) => op.clientId !== clientId));
  });
}

/**
 * Drop all pending uploads without attempting delivery (account boundary).
 * Aborts an in-flight flush first — its network loop runs outside runMutation,
 * so without this it could keep uploading the previous account's photos under
 * the session that replaces it.
 */
export function clearBeerPhotosQueue(): Promise<void> {
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}
