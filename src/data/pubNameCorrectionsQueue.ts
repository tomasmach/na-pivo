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
import { createQueueStorage, createQueueLock } from './createQueue';

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

const enqueueTask = createQueueLock();

async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: PubNameCorrectionEntry[] = [];
  for (const entry of queue) {
    const result = await submitPubNameCorrection(entry);
    if (result === 'ok') {
      await clearPubsSnapshot();
    } else if (result === 'retry') {
      remaining.push(entry);
    }
  }
  await saveQueue(remaining);
}

export function enqueuePubNameCorrection(entry: PubNameCorrectionEntry): Promise<boolean> {
  return enqueueTask(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((queued) => queued.client_id !== entry.client_id);
    deduped.push(entry);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));

    await flushLocked();
    const after = await loadQueue();
    return !after.some((queued) => queued.client_id === entry.client_id);
  });
}

export function flushPubNameCorrectionsQueue(): Promise<void> {
  return enqueueTask(flushLocked);
}

export function clearPubNameCorrectionsQueue(): Promise<void> {
  return enqueueTask(async () => {
    await saveQueue([]);
  });
}
