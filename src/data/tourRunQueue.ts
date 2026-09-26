/**
 * Offline queue for joint runs of public tours. A pub cellar has no signal, so
 * registering a run, joining it, leaving and the "walked half" flag wait here
 * and go out in order per run. 400/422 drop (never valid); a join or flag for a
 * run the server does not know yet (404) waits for the organizer's own queue.
 */

import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import { putTourRun, putTourRunMember, type TourCrewRun } from './toursClient';

const STORAGE_KEY = 'na-pivo-tour-run-queue';
const MAX_AGE_MS = 7 * 86400000;
const UNKNOWN_RUN_MAX_AGE_MS = 48 * 3600000;

export type TourRunOp = 'register' | 'end' | 'join' | 'leave' | 'complete' | 'uncount';
export interface TourRunQueueItem {
  runId: string;
  publicId: string;
  op: TourRunOp;
  createdAt: string;
  /** A registration names the stops the organizer walks, so the server can refuse an outdated route. */
  stopIds?: string[];
}
/** `refused`: the server turned the join or the registration down (run over, full, blocked, route changed); nothing else will follow for it. */
export type TourRunDelivery = { run: TourCrewRun | null; refused: boolean };
type DeliveryListener = (item: TourRunQueueItem, delivery: TourRunDelivery) => void;
let listener: DeliveryListener | null = null;
/** The tours store learns about delivered items without this module importing it. */
export function setTourRunDeliveryListener(next: DeliveryListener | null): void {
  listener = next;
}

const OPS: TourRunOp[] = ['register', 'end', 'join', 'leave', 'complete', 'uncount'];
const MEMBER_STATE = { join: 'joined', leave: 'left', complete: 'completed', uncount: 'uncounted' } as const;
function isItem(value: unknown): value is TourRunQueueItem {
  const item = value as TourRunQueueItem;
  return !!item && typeof item.runId === 'string' && typeof item.publicId === 'string' && OPS.includes(item.op) &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) &&
    (item.stopIds === undefined || (Array.isArray(item.stopIds) && item.stopIds.every((id) => typeof id === 'string')));
}
const { load, save } = createQueueStorage<TourRunQueueItem>(STORAGE_KEY, isItem);
const locked = createQueueLock();

async function deliver(item: TourRunQueueItem): Promise<'ok' | 'drop' | 'retry'> {
  const age = Date.now() - Date.parse(item.createdAt);
  if (age > MAX_AGE_MS) return 'drop';
  const result = item.op === 'register' || item.op === 'end'
    ? await putTourRun(item.runId, item.publicId, item.op === 'end', item.op === 'register' ? item.stopIds : undefined)
    : await putTourRunMember(item.runId, MEMBER_STATE[item.op], item.publicId);
  if (result.stale) return 'retry';
  if (result.status >= 200 && result.status < 300) {
    // Only a join can be turned down; a successful leave also answers "not joined".
    listener?.(item, { run: result.run, refused: item.op === 'join' && result.refused === true });
    return 'ok';
  }
  if (result.status === 400 || result.status === 422) {
    listener?.(item, { run: null, refused: item.op === 'join' || item.op === 'register' });
    return 'drop';
  }
  if (result.status === 404 && age > UNKNOWN_RUN_MAX_AGE_MS) return 'drop';
  return 'retry';
}

const { flush, abortInFlight } = createCoalescingFlush(async (signal) => {
  const queue = await locked(load);
  const done = new Set<TourRunQueueItem>();
  const blockedRuns = new Set<string>();
  for (const item of queue) {
    if (signal.aborted) break;
    // Keep each run's order: a flag must not overtake its join.
    if (blockedRuns.has(item.runId)) continue;
    const outcome = await deliver(item);
    if (outcome === 'retry') blockedRuns.add(item.runId);
    else done.add(item);
  }
  await locked(async () => {
    const current = await load();
    await save(current.filter((item) => ![...done].some((d) => d.runId === item.runId && d.op === item.op && d.createdAt === item.createdAt)));
  });
});

/** Resolves true once the op is stored, so a caller confirms a step only when a closed app cannot lose it. */
export async function enqueueTourRunOp(item: Omit<TourRunQueueItem, 'createdAt'>): Promise<boolean> {
  let stored = false;
  await locked(async () => {
    // A new join replaces a waiting leave too, so a leave never ends up behind the join it undoes.
    const replaces = (op: TourRunOp) => op === item.op || (item.op === 'join' && op === 'leave');
    const queue = (await load()).filter((queued) => !(queued.runId === item.runId && replaces(queued.op)));
    const next = { ...item, createdAt: new Date().toISOString() };
    // A completion waiting from before needs the join first, or its 404 would hold the run's queue until the join window closes.
    const dependents = item.op === 'join' ? queue.filter((queued) => queued.runId === item.runId) : [];
    const updated = [...queue.filter((queued) => !dependents.includes(queued)), next, ...dependents];
    // A full queue refuses the new op rather than silently dropping an older one it still owes the server.
    stored = updated.length <= 100 && await save(updated);
  });
  void flush();
  return stored;
}

/** Takes back ops that have not left the phone yet, e.g. a completion after "Nezapočítávat mě". */
export async function dropTourRunOps(runId: string, ops?: TourRunOp[]): Promise<void> {
  await locked(async () => {
    await save((await load()).filter((queued) => !(queued.runId === runId && (!ops || ops.includes(queued.op)))));
  });
}

export async function pendingTourRunOps(runId: string): Promise<TourRunOp[]> {
  return (await load()).filter((item) => item.runId === runId).map((item) => item.op);
}

export const flushTourRunQueue = (): Promise<void> => flush();

/** Account boundary: never send one account's walks under the next one. */
export async function clearTourRunQueue(): Promise<void> {
  abortInFlight();
  await locked(() => save([]).then(() => undefined));
}
