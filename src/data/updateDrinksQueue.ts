/**
 * Persistent retry queue for drink name UPDATES.
 *
 * A corrected beer name should apply locally immediately and eventually reach
 * the backend. Updates are keyed by client_id and deduped last-write-wins so a
 * user can fix the same typo twice while offline without building a backlog.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { updateDrinkName } from './drinksClient';

const STORAGE_KEY = 'na-pivo-update-drinks-queue';
const MAX_QUEUE_LENGTH = 200;

export interface DrinkUpdateEntry {
  client_id: string;
  beer_name: string;
}

function isDrinkUpdateEntry(entry: unknown): entry is DrinkUpdateEntry {
  const e = entry as DrinkUpdateEntry;
  return !!e && typeof e.client_id === 'string' && typeof e.beer_name === 'string' && e.beer_name.length > 0;
}

async function loadQueue(): Promise<DrinkUpdateEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDrinkUpdateEntry);
  } catch {
    return [];
  }
}

async function saveQueue(queue: DrinkUpdateEntry[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Storage failure leaves the previous snapshot in place. Local state already
    // reflects the edit, so a later manual edit can enqueue it again.
  }
}

/** Serializes only AsyncStorage mutations. Network delivery deliberately runs
 *  outside this lock so a slow/offline flush cannot block a fresh edit from
 *  being persisted immediately. */
let _mutationChain: Promise<unknown> = Promise.resolve();
let _flushPromise: Promise<void> | null = null;
/** A single coalesced trailing flush: when flushUpdateDrinksQueue() is called
 *  while a flush is already in flight, exactly one more flush is queued to run
 *  after it, so an update enqueued mid-flight is attempted without waiting for
 *  the next launch. Multiple mid-flush callers collapse onto this same promise. */
let _flushAgain: Promise<void> | null = null;

function runMutation<T>(task: () => Promise<T>): Promise<T> {
  const next = _mutationChain.then(task, task);
  _mutationChain = next.catch(() => undefined);
  return next;
}

function signature(entry: DrinkUpdateEntry): string {
  return JSON.stringify(entry);
}

async function flushUnlocked(): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const entry of queue) {
    attempted.set(entry.client_id, signature(entry));
    const result = await updateDrinkName(entry.client_id, entry.beer_name);
    if (result !== 'retry') settled.add(entry.client_id);
  }

  await runMutation(async () => {
    const current = await loadQueue();
    const remaining = current.filter((entry) => {
      const sig = attempted.get(entry.client_id);
      if (sig === undefined || sig !== signature(entry)) return true;
      return !settled.has(entry.client_id);
    });
    await saveQueue(remaining);
  });
}

export async function enqueueDrinkUpdate(entry: DrinkUpdateEntry): Promise<void> {
  await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((queued) => queued.client_id !== entry.client_id);
    deduped.push(entry);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  await flushUpdateDrinksQueue();
}

export function removeQueuedDrinkUpdate(clientId: string): Promise<boolean> {
  return runMutation(async () => {
    const queue = await loadQueue();
    const filtered = queue.filter((entry) => entry.client_id !== clientId);
    if (filtered.length === queue.length) return false;
    await saveQueue(filtered);
    return true;
  });
}

export function clearUpdateDrinksQueue(): Promise<void> {
  return runMutation(async () => {
    await saveQueue([]);
  });
}

/**
 * Retries all pending updates. Never throws.
 *
 * Trailing-edge coalescing: only one flush runs at a time (never two
 * concurrently, preserving the no-duplicate-send guarantee), but a call made
 * while a flush is in flight schedules exactly one more flush to run after it.
 * That trailing flush re-snapshots the queue, so an update enqueued mid-flight
 * is delivered without waiting for the next launch. The returned promise
 * resolves only after that trailing flush completes.
 */
export function flushUpdateDrinksQueue(): Promise<void> {
  if (_flushPromise) {
    if (!_flushAgain) {
      _flushAgain = _flushPromise.then(() => {
        _flushAgain = null;
        return flushUpdateDrinksQueue();
      });
    }
    return _flushAgain;
  }
  _flushPromise = flushUnlocked().finally(() => {
    _flushPromise = null;
  });
  return _flushPromise;
}
