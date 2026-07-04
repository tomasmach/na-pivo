import {
  clearBeerCheckInReaction,
  reactToBeerCheckIn,
  submitBeerCheckIn,
  type BeerCheckInInput,
} from './beerCheckinsClient';
import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import type { QueueSyncResult } from './apiFetch';

const STORAGE_KEY = 'na-pivo-beer-checkins-queue';
const MAX_QUEUE_LENGTH = 300;

export type BeerCheckInQueueItem =
  | { op: 'checkin'; payload: BeerCheckInInput }
  | { op: 'cheer'; checkInId: string }
  | { op: 'cheer-clear'; checkInId: string };

function dedupKey(item: BeerCheckInQueueItem): string {
  switch (item.op) {
    case 'checkin':
      return `checkin:${item.payload.clientId}`;
    case 'cheer':
    case 'cheer-clear':
      return `cheer:${item.checkInId}`;
  }
}

function isQueueItem(value: unknown): value is BeerCheckInQueueItem {
  const item = value as BeerCheckInQueueItem;
  if (!item || typeof item.op !== 'string') return false;
  switch (item.op) {
    case 'checkin':
      return (
        typeof item.payload?.clientId === 'string' &&
        typeof item.payload?.beerName === 'string' &&
        (item.payload.visibility === 'private' || item.payload.visibility === 'friends')
      );
    case 'cheer':
    case 'cheer-clear':
      return typeof item.checkInId === 'string';
    default:
      return false;
  }
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<BeerCheckInQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);
const runMutation = createQueueLock();

function classifyAction(result: { ok: true } | { ok: false; code: string }): QueueSyncResult {
  if (result.ok) return 'ok';
  if (result.code === 'offline' || result.code === 'account' || result.code === 'network' || result.code === 'auth') {
    return 'retry';
  }
  const httpMatch = /^http_(\d{3})$/.exec(result.code);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 401 || status === 429 || status >= 500) return 'retry';
  }
  return 'permanent-error';
}

async function deliver(item: BeerCheckInQueueItem): Promise<QueueSyncResult> {
  switch (item.op) {
    case 'checkin':
      return submitBeerCheckIn(item.payload);
    case 'cheer':
      return classifyAction(await reactToBeerCheckIn(item.checkInId, 'cheers'));
    case 'cheer-clear':
      return classifyAction(await clearBeerCheckInReaction(item.checkInId));
  }
}

function signature(item: BeerCheckInQueueItem): string {
  return JSON.stringify(item);
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const item of queue) {
    if (signal.aborted) break;
    const key = dedupKey(item);
    attempted.set(key, signature(item));
    const result = await deliver(item);
    if (result !== 'retry') settled.add(key);
  }

  await runMutation(async () => {
    const current = await loadQueue();
    const remaining = current.filter((item) => {
      const key = dedupKey(item);
      const sig = attempted.get(key);
      if (sig === undefined || sig !== signature(item)) return true;
      return !settled.has(key);
    });
    await saveQueue(remaining);
  });
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

export async function enqueueBeerCheckInOp(item: BeerCheckInQueueItem): Promise<void> {
  const key = dedupKey(item);
  await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => dedupKey(existing) !== key);
    deduped.push(item);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  await flushBeerCheckinsQueue();
}

export function flushBeerCheckinsQueue(): Promise<void> {
  return _flush();
}

export function clearBeerCheckinsQueue(): Promise<void> {
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}
