/**
 * The offline queue for game events.
 *
 * A game happens in a pub, which is where the signal is worst, and it happens in
 * seconds — nobody is going to wait for a spinner before the next point lands.
 * So the UI folds an event in locally and hands it here, and this gets it to the
 * table eventually.
 *
 * What makes that safe is not this file, it is `clientId`: the server keys every
 * event on it, so an event delivered twice is stored once. This queue is
 * therefore allowed to be dumb — keep, retry, send again — without ever
 * double-scoring anybody.
 *
 * Ordering: entries keep the order they were enqueued, and each flush sends one
 * batch per game in that order. Order is a convenience, not a correctness
 * requirement — every reader of these events folds them into the same state
 * whichever way round they arrive (that is what `quizState` is tested for).
 *
 * Unlike the drinks queue, an event that cannot be delivered is not precious
 * forever: a game is over in ten minutes. Entries older than `MAX_AGE_MS` are
 * dropped rather than posted into a night that has long since ended.
 */

import {
  isRetriablePartyGamesError,
  sendPartyGameEvents,
  type PartyGameEventInput,
} from './partyGamesClient';
import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';

const STORAGE_KEY = 'na-pivo-party-games-queue';
const MAX_QUEUE_LENGTH = 200;
/** Six hours: longer than any evening, shorter than "forever". */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** The server's own batch ceiling. */
const MAX_BATCH = 50;

export interface PartyGameQueueItem {
  code: string;
  gameId: string;
  event: PartyGameEventInput;
  /** Enqueue time, used only to expire. */
  queuedAt: number;
}

function isQueueItem(value: unknown): value is PartyGameQueueItem {
  const item = value as PartyGameQueueItem;
  return (
    !!item &&
    typeof item.code === 'string' &&
    typeof item.gameId === 'string' &&
    typeof item.queuedAt === 'number' &&
    !!item.event &&
    typeof item.event.clientId === 'string' &&
    (item.event.kind === 'score' || item.event.kind === 'answer' || item.event.kind === 'finish')
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<PartyGameQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);
const runMutation = createQueueLock();

/** One request per (evening, game), in first-seen order. */
function batches(queue: PartyGameQueueItem[]): PartyGameQueueItem[][] {
  const byGame = new Map<string, PartyGameQueueItem[]>();
  for (const item of queue) {
    const key = `${item.code}|${item.gameId}`;
    const bucket = byGame.get(key);
    if (bucket) bucket.push(item);
    else byGame.set(key, [item]);
  }
  return [...byGame.values()].flatMap((items) => {
    const chunks: PartyGameQueueItem[][] = [];
    for (let index = 0; index < items.length; index += MAX_BATCH) {
      chunks.push(items.slice(index, index + MAX_BATCH));
    }
    return chunks;
  });
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  const cutoff = Date.now() - MAX_AGE_MS;
  const settled = new Set<string>();
  const fresh = queue.filter((item) => {
    if (item.queuedAt >= cutoff) return true;
    settled.add(item.event.clientId);
    return false;
  });

  for (const batch of batches(fresh)) {
    if (signal.aborted) break;
    const first = batch[0];
    const result = await sendPartyGameEvents(
      first.code,
      first.gameId,
      batch.map((item) => item.event),
    );
    // Anything but a retriable failure is done with: delivered, or a payload
    // this server will never accept. Both cases leave the queue.
    if (result.ok || !isRetriablePartyGamesError(result)) {
      for (const item of batch) settled.add(item.event.clientId);
    }
  }

  await runMutation(async () => {
    const current = await loadQueue();
    await saveQueue(current.filter((item) => !settled.has(item.event.clientId)));
  });
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

export async function enqueuePartyGameEvent(
  code: string,
  gameId: string,
  event: PartyGameEventInput,
): Promise<void> {
  await runMutation(async () => {
    const queue = await loadQueue();
    // Same clientId twice is the same event — a double tap, or a caller that
    // retried on its own. Keep one.
    const deduped = queue.filter((existing) => existing.event.clientId !== event.clientId);
    deduped.push({ code, gameId, event, queuedAt: Date.now() });
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  await flushPartyGamesQueue();
}

export function flushPartyGamesQueue(): Promise<void> {
  return _flush();
}

export function clearPartyGamesQueue(): Promise<void> {
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  });
}
