/**
 * Persistent retry queue for pubs missing from the nearby search.
 *
 * Adding a pub is a public community write, so the payload is stored before the
 * first network attempt and retried on launch/foreground. The backend upserts on
 * (account, client_id), so the queue dedupes on client_id: a retry of the same
 * submit replaces its earlier copy, while two distinct submits (even at the same
 * spot) both stay queued.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { submitAddedPub, type AddedPubEntry, type AddedPubResponse } from './addedPubsClient';
import { clearPubsSnapshot, pubIdForCoords, removeLocalPub, upsertLocalPub } from './pubs';

const STORAGE_KEY = 'na-pivo-added-pubs-queue';
const MAX_QUEUE_LENGTH = 30;

function isAddedPubEntry(entry: unknown): entry is AddedPubEntry {
  const e = entry as AddedPubEntry;
  return (
    !!e &&
    typeof e.client_id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.lat === 'number' &&
    typeof e.lng === 'number' &&
    (e.city === undefined || typeof e.city === 'string') &&
    (e.address === undefined || typeof e.address === 'string')
  );
}

async function loadQueue(): Promise<AddedPubEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAddedPubEntry);
  } catch {
    return [];
  }
}

async function saveQueue(queue: AddedPubEntry[]): Promise<void> {
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

  const remaining: AddedPubEntry[] = [];
  for (const entry of queue) {
    const result = await submitAddedPub(entry);
    if (result) {
      applySubmittedPubResult(entry, result);
      await clearPubsSnapshot();
    } else {
      remaining.push(entry);
    }
  }
  await saveQueue(remaining);
}

function pubFromAddedEntry(entry: AddedPubEntry) {
  return {
    id: pubIdForCoords(entry.lat, entry.lng),
    name: entry.name,
    lat: entry.lat,
    lng: entry.lng,
    ...(entry.city ? { city: entry.city } : {}),
    ...(entry.address ? { address: entry.address } : {}),
    venueKind: 'pub' as const,
  };
}

function applySubmittedPubResult(entry: AddedPubEntry, result: AddedPubResponse): void {
  const previousId = pubIdForCoords(entry.lat, entry.lng);
  const nextPub = {
    id: pubIdForCoords(result.lat, result.lng),
    name: result.name,
    lat: result.lat,
    lng: result.lng,
    ...(result.city ? { city: result.city } : {}),
    ...(result.address ? { address: result.address } : {}),
    venueKind: 'pub' as const,
  };

  if (nextPub.id !== previousId) {
    removeLocalPub(previousId);
  }
  upsertLocalPub(nextPub);
}

export function enqueueAddedPub(entry: AddedPubEntry): Promise<boolean> {
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

export function flushAddedPubsQueue(): Promise<void> {
  return enqueueTask(flushLocked);
}

export function restoreQueuedAddedPubs(): Promise<number> {
  return enqueueTask(async () => {
    const queue = await loadQueue();
    for (const entry of queue) {
      upsertLocalPub(pubFromAddedEntry(entry));
    }
    return queue.length;
  });
}
