/**
 * Persistent retry queue for pub display-name corrections.
 *
 * Name fixes are public community writes. Store before sending, retry on
 * launch/foreground, and dedupe by client_id so one offline submit remains one
 * backend correction.
 */

import {
  submitPubNameCorrection,
  type PubNameCorrectionEntry,
} from './pubNameCorrectionsClient';
import { clearPubsSnapshot } from './pubs';
import { createCoalescingFlush, createQueueStorage, createQueueLock } from './createQueue';
import { preserveDurableQueue } from './durableQueuePolicy';
import { runPrivateAccountMutation } from './privateAccountBoundary';

const STORAGE_KEY = 'na-pivo-pub-name-corrections-queue';
const MAX_QUEUE_LENGTH = 30;

function isPubNameCorrectionEntry(entry: unknown): entry is PubNameCorrectionEntry {
  const e = entry as PubNameCorrectionEntry;
  return (
    !!e &&
    typeof e.client_id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.suggested_name === 'string' &&
    typeof e.lat === 'number' &&
    typeof e.lng === 'number' &&
    (e.city === undefined || typeof e.city === 'string') &&
    (e.address === undefined || typeof e.address === 'string') &&
    (e.external_id === undefined || typeof e.external_id === 'string')
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<PubNameCorrectionEntry>(
  STORAGE_KEY,
  isPubNameCorrectionEntry,
);

const storageTask = createQueueLock();

export type PubNameCorrectionQueueResult =
  | 'synced'
  | 'queued'
  | 'rejected'
  | 'storage-error';

export type PersistedPubNameCorrection =
  | { persisted: false }
  | { persisted: true; sync: Promise<PubNameCorrectionQueueResult> };

async function deliverQueue(signal: AbortSignal): Promise<void> {
  const queue = await storageTask(loadQueue);
  if (queue.length === 0) return;

  const deliveredIds = new Set<string>();
  for (const entry of queue) {
    if (signal.aborted) return;
    const result = await submitPubNameCorrection(entry, signal);
    if (result === 'ok') {
      await clearPubsSnapshot().catch(() => undefined);
      deliveredIds.add(entry.client_id);
    } else if (result === 'permanent-error') {
      deliveredIds.add(entry.client_id);
    }
  }
  if (deliveredIds.size === 0) return;
  await storageTask(async () => {
    const latest = await loadQueue();
    await saveQueue(latest.filter((entry) => !deliveredIds.has(entry.client_id)));
  });
}

const correctionDelivery = createCoalescingFlush(deliverQueue);

export function enqueuePubNameCorrection(entry: PubNameCorrectionEntry): Promise<boolean> {
  return storageTask(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((queued) => queued.client_id !== entry.client_id);
    deduped.push(entry);
    const persisted = await saveQueue(preserveDurableQueue(deduped, MAX_QUEUE_LENGTH));
    if (!persisted) throw new Error('Could not persist pub name correction');

    return true;
  }).then(async (persisted) => {
    if (!persisted) return false;
    await correctionDelivery.flush();
    const after = await storageTask(loadQueue);
    return !after.some((queued) => queued.client_id === entry.client_id);
  });
}

async function syncOne(
  entry: PubNameCorrectionEntry,
  signal: AbortSignal,
): Promise<PubNameCorrectionQueueResult> {
  const result = await submitPubNameCorrection(entry, signal);
  if (result === 'retry') return 'queued';

  await storageTask(async () => {
    const latest = await loadQueue();
    await saveQueue(latest.filter((queued) => queued.client_id !== entry.client_id));
  });
  if (result === 'ok') {
    await clearPubsSnapshot().catch(() => undefined);
    return 'synced';
  }
  return 'rejected';
}

/**
 * Stores an interactive rename first and returns immediately. Its own network
 * attempt runs next, ahead of an old backlog, so the form never waits through
 * several eight-second retry timeouts. The caller may observe `sync` to roll
 * back a permanent rejection without blocking the sheet.
 */
export async function persistPubNameCorrection(
  entry: PubNameCorrectionEntry,
): Promise<PersistedPubNameCorrection> {
  const persisted = await storageTask(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((queued) => queued.client_id !== entry.client_id);
    deduped.push(entry);
    return saveQueue(preserveDurableQueue(deduped, MAX_QUEUE_LENGTH));
  });
  if (!persisted) return { persisted: false };
  const sync = runPrivateAccountMutation((scope) => syncOne(entry, scope.signal))
    .catch(() => 'queued' as const);
  return { persisted: true, sync };
}

export function flushPubNameCorrectionsQueue(): Promise<void> {
  return correctionDelivery.flush();
}

export function clearPubNameCorrectionsQueue(): Promise<void> {
  correctionDelivery.abortInFlight();
  return storageTask(async () => {
    await saveQueue([]);
  }, { allowDuringPrivateTransition: true });
}
