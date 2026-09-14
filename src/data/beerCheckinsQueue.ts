import {
  clearBeerCheckInReaction,
  reactToBeerCheckIn,
  submitBeerCheckIn,
  type BeerCheckInInput,
} from './beerCheckinsClient';
import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import { preserveDurableQueue } from './durableQueuePolicy';
import { runPrivateAccountMutation } from './privateAccountBoundary';
import { classifyQueueHttpStatus, type QueueSyncResult } from './apiFetch';

const STORAGE_KEY = 'na-pivo-beer-checkins-queue';
const ACTION_TICKETS_STORAGE_KEY = 'na-pivo-beer-checkin-action-tickets';
const MAX_QUEUE_LENGTH = 300;
const MAX_ACTION_TICKETS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type BeerCheckInEnqueueResult = 'queued' | 'storage-error';

export interface BeerCheckInActionTicket {
  key: string;
  visitClientId: string | null;
  clientIds: string[];
  checkedInAt: string;
  endedAt?: string | null;
  createdAt: number;
}

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
        typeof item.payload?.clientId === 'string' && UUID_PATTERN.test(item.payload.clientId) &&
        typeof item.payload?.beerName === 'string' &&
        (item.payload.visitClientId == null || UUID_PATTERN.test(item.payload.visitClientId)) &&
        (item.payload.visibility === 'private' || item.payload.visibility === 'friends')
      );
    case 'cheer':
    case 'cheer-clear':
      return typeof item.checkInId === 'string' && UUID_PATTERN.test(item.checkInId);
    default:
      return false;
  }
}

function isActionTicket(value: unknown): value is BeerCheckInActionTicket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ticket = value as Partial<BeerCheckInActionTicket>;
  return (
    typeof ticket.key === 'string' &&
    ticket.key.length > 0 &&
    ticket.key.length <= 4_000 &&
    (ticket.visitClientId === null ||
      (typeof ticket.visitClientId === 'string' && UUID_PATTERN.test(ticket.visitClientId))) &&
    Array.isArray(ticket.clientIds) &&
    ticket.clientIds.length > 0 &&
    ticket.clientIds.length <= 100 &&
    ticket.clientIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id)) &&
    typeof ticket.checkedInAt === 'string' &&
    Number.isFinite(Date.parse(ticket.checkedInAt)) &&
    (ticket.endedAt === undefined ||
      ticket.endedAt === null ||
      (typeof ticket.endedAt === 'string' && Number.isFinite(Date.parse(ticket.endedAt)))) &&
    typeof ticket.createdAt === 'number' &&
    Number.isFinite(ticket.createdAt)
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<BeerCheckInQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);
const { load: loadActionTickets, save: saveActionTickets } =
  createQueueStorage<BeerCheckInActionTicket>(ACTION_TICKETS_STORAGE_KEY, isActionTicket);
const runMutation = createQueueLock();

function classifyAction(result: { ok: true } | { ok: false; code: string }): QueueSyncResult {
  if (result.ok) return 'ok';
  if (result.code === 'offline' || result.code === 'account' || result.code === 'network' || result.code === 'auth') {
    return 'retry';
  }
  const httpMatch = /^http_(\d{3})$/.exec(result.code);
  if (httpMatch) {
    return classifyQueueHttpStatus(Number(httpMatch[1]));
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

export async function enqueueBeerCheckInOp(
  item: BeerCheckInQueueItem,
): Promise<BeerCheckInEnqueueResult> {
  return enqueueBeerCheckInBatch([item]);
}

/** Persist a whole user action before attempting any delivery. Historical
 * evenings can contain several beers; saving them one-by-one let the first
 * reach the server while a later storage write failed, leaving a ghost partial
 * evening. One queue mutation makes the batch all-or-nothing locally. */
export async function enqueueBeerCheckInBatch(
  items: readonly BeerCheckInQueueItem[],
): Promise<BeerCheckInEnqueueResult> {
  if (items.length === 0) return 'queued';
  return runPrivateAccountMutation(async () => {
    const persisted = await runMutation(async () => {
      let next = await loadQueue();
      for (const item of items) {
        const key = dedupKey(item);
        next = next.filter((existing) => dedupKey(existing) !== key);
        next.push(item);
      }
      return saveQueue(preserveDurableQueue(next, MAX_QUEUE_LENGTH));
    });
    if (!persisted) return 'storage-error';
    await flushBeerCheckinsQueue();
    return 'queued';
  });
}

export function loadBeerCheckInActionTicket(
  key: string,
): Promise<BeerCheckInActionTicket | null> {
  return runMutation(async () => {
    const tickets = await loadActionTickets();
    return tickets.find((ticket) => ticket.key === key) ?? null;
  });
}

export function getOrCreateBeerCheckInActionTicket(
  key: string,
  create: () => BeerCheckInActionTicket,
): Promise<BeerCheckInActionTicket | null> {
  return runMutation(async () => {
    const tickets = await loadActionTickets();
    const existing = tickets.find((ticket) => ticket.key === key);
    if (existing) return existing;
    const ticket = create();
    const next = [...tickets, ticket].slice(-MAX_ACTION_TICKETS);
    return (await saveActionTickets(next)) ? ticket : null;
  });
}

export function saveBeerCheckInActionTicket(
  ticket: BeerCheckInActionTicket,
): Promise<boolean> {
  return runMutation(async () => {
    const tickets = (await loadActionTickets()).filter((current) => current.key !== ticket.key);
    tickets.push(ticket);
    return saveActionTickets(tickets.slice(-MAX_ACTION_TICKETS));
  });
}

export function removeBeerCheckInActionTicket(key: string): Promise<boolean> {
  return runMutation(async () => {
    const tickets = await loadActionTickets();
    const remaining = tickets.filter((ticket) => ticket.key !== key);
    if (remaining.length === tickets.length) return true;
    return saveActionTickets(remaining);
  });
}

export function flushBeerCheckinsQueue(): Promise<void> {
  return _flush();
}

export function clearBeerCheckinsQueue(): Promise<void> {
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
    await saveActionTickets([]);
  }, { allowDuringPrivateTransition: true });
}

export async function getPendingBeerCheckIns(): Promise<BeerCheckInInput[]> {
  const queue = await runMutation(loadQueue);
  return queue.filter((item) => item.op === 'checkin').map((item) => item.payload);
}
