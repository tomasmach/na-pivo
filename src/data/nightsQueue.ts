import {
  clearNightReaction,
  isRetriableNightError,
  publishNight,
  reactToNight,
  unpublishNight,
  type NightActionError,
  type NightPublishPayload,
} from './nightsClient';
import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import type { QueueSyncResult } from './apiFetch';

const STORAGE_KEY = 'na-pivo-nights-queue';
const MAX_QUEUE_LENGTH = 300;

export type NightQueueItem =
  | { op: 'publish'; payload: NightPublishPayload }
  | { op: 'unpublish'; clientId: string }
  | { op: 'round'; nightId: string }
  | { op: 'round-clear'; nightId: string };

function dedupKey(item: NightQueueItem): string {
  switch (item.op) {
    case 'publish':
      return `night:${item.payload.clientId}`;
    case 'unpublish':
      return `night:${item.clientId}`;
    case 'round':
    case 'round-clear':
      return `round:${item.nightId}`;
  }
}

function isQueueItem(value: unknown): value is NightQueueItem {
  const item = value as NightQueueItem;
  if (!item || typeof item.op !== 'string') return false;
  switch (item.op) {
    case 'publish':
      return (
        typeof item.payload?.clientId === 'string' &&
        typeof item.payload?.drinkingDay === 'string' &&
        typeof item.payload?.startedAt === 'string' &&
        typeof item.payload?.endedAt === 'string' &&
        typeof item.payload?.beerCount === 'number' &&
        typeof item.payload?.wineCount === 'number' &&
        typeof item.payload?.softDrinkCount === 'number' &&
        typeof item.payload?.shotCount === 'number' &&
        Array.isArray(item.payload?.pubNames) &&
        item.payload.pubNames.every((name) => typeof name === 'string') &&
        (item.payload.city === undefined || typeof item.payload.city === 'string') &&
        (item.payload.durationMinutes === undefined ||
          typeof item.payload.durationMinutes === 'number') &&
        (item.payload.visibility === 'friends' || item.payload.visibility === 'public') &&
        typeof item.payload.updatedAt === 'string'
      );
    case 'unpublish':
      return typeof item.clientId === 'string';
    case 'round':
    case 'round-clear':
      return typeof item.nightId === 'string';
    default:
      return false;
  }
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<NightQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);
const runMutation = createQueueLock();

function classifyAction(result: { ok: true } | NightActionError): QueueSyncResult {
  if (result.ok) return 'ok';
  return isRetriableNightError(result) ? 'retry' : 'permanent-error';
}

async function deliver(item: NightQueueItem): Promise<QueueSyncResult> {
  switch (item.op) {
    case 'publish':
      return classifyAction(await publishNight(item.payload));
    case 'unpublish':
      return classifyAction(await unpublishNight(item.clientId));
    case 'round':
      return classifyAction(await reactToNight(item.nightId));
    case 'round-clear':
      return classifyAction(await clearNightReaction(item.nightId));
  }
}

function signature(item: NightQueueItem): string {
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

export async function enqueueNightOp(item: NightQueueItem): Promise<void> {
  const key = dedupKey(item);
  await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => dedupKey(existing) !== key);
    deduped.push(item);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  await flushNightsQueue();
}

export function flushNightsQueue(): Promise<void> {
  return _flush();
}

export function clearNightsQueue(): Promise<void> {
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}
