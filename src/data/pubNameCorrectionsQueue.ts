/**
 * Persistent retry queue for pub display-name corrections.
 *
 * Name fixes are public community writes. Store before sending, retry on
 * launch/foreground, and dedupe by client_id so one offline submit remains one
 * backend correction.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  submitPubNameCorrection,
  type PubNameCorrectionEntry,
} from './pubNameCorrectionsClient';
import { clearPubsSnapshot } from './pubs';

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

async function loadQueue(): Promise<PubNameCorrectionEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPubNameCorrectionEntry);
  } catch {
    return [];
  }
}

async function saveQueue(queue: PubNameCorrectionEntry[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Storage failure leaves the previous snapshot in place.
  }
}

let _chain: Promise<unknown> = Promise.resolve();

function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
  const next = _chain.then(task, task);
  _chain = next.catch(() => undefined);
  return next;
}

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
