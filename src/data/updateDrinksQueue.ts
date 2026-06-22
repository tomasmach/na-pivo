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

let _chain: Promise<unknown> = Promise.resolve();

function runLocked<T>(task: () => Promise<T>): Promise<T> {
  const next = _chain.then(task, task);
  _chain = next.catch(() => undefined);
  return next;
}

async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: DrinkUpdateEntry[] = [];
  for (const entry of queue) {
    const result = await updateDrinkName(entry.client_id, entry.beer_name);
    if (result === 'retry') remaining.push(entry);
  }
  await saveQueue(remaining);
}

export function enqueueDrinkUpdate(entry: DrinkUpdateEntry): Promise<void> {
  return runLocked(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((queued) => queued.client_id !== entry.client_id);
    deduped.push(entry);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
    await flushLocked();
  });
}

export function clearUpdateDrinksQueue(): Promise<void> {
  return runLocked(async () => {
    await saveQueue([]);
  });
}

export function flushUpdateDrinksQueue(): Promise<void> {
  return runLocked(flushLocked);
}
