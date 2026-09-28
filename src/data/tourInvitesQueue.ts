/**
 * Offline queue for Parta invites to a tour. Inviting from a pub cellar waits
 * here and goes out on launch or foreground, one item per tour (a later invite
 * for the same tour adds its friends to the waiting one).
 *
 * An invite only ever uses the link the tour already has; the queue never makes
 * or remakes one, so revoking a link cannot be undone by a late flush. The tours
 * layer registers a check that the link is still there. Keep/drop: sent, refused
 * for good (400/422, invisible mode, a link gone or revoked, the tour full) drops;
 * offline, 5xx or a server without invites yet (404) retries until a week old.
 */

import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import { sendTourInvites } from './tourInvitesClient';

const STORAGE_KEY = 'na-pivo-tour-invites-queue';
const MAX_AGE_MS = 7 * 86400000;
const MAX_ITEMS = 50;
const MAX_RECIPIENTS = 50;

export interface TourInviteQueueItem {
  planId: string;
  recipientIds: string[];
  createdAt: string;
}

export type TourInvitePrepare = (planId: string) => Promise<'ok' | 'retry' | 'drop'>;
let prepare: TourInvitePrepare | null = null;
/** The tours layer says whether the tour still has its link; it never makes one for the queue. */
export function setTourInvitePreparer(next: TourInvitePrepare | null): void {
  prepare = next;
}

type Listener = (planId: string) => void;
const listeners = new Set<Listener>();
/** A screen showing the roster hears when a waiting invite went out. */
export function subscribeTourInviteDelivery(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isItem(value: unknown): value is TourInviteQueueItem {
  const item = value as TourInviteQueueItem;
  return !!item && typeof item.planId === 'string' && item.planId.length > 0 &&
    Array.isArray(item.recipientIds) && item.recipientIds.length > 0 && item.recipientIds.every((id) => typeof id === 'string' && id.length > 0) &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt));
}

const { load, save } = createQueueStorage<TourInviteQueueItem>(STORAGE_KEY, isItem);
const locked = createQueueLock();

async function deliver(item: TourInviteQueueItem): Promise<'ok' | 'drop' | 'retry'> {
  if (Date.now() - Date.parse(item.createdAt) > MAX_AGE_MS) return 'drop';
  if (!prepare) return 'retry';
  const ready = await prepare(item.planId);
  if (ready !== 'ok') return ready;
  const result = await sendTourInvites(item.planId, item.recipientIds);
  if (result.ok) return 'ok';
  // A server from before invites answers 404 until the backend with invites is out.
  if (result.error === 'unsupported') return 'retry';
  // A queued invite never makes a link: one revoked meanwhile, or a tour filled from another phone, ends it here.
  // The roster then simply does not list those friends.
  if (result.error === 'share_required' || result.error === 'limit') return 'drop';
  return result.retry ? 'retry' : 'drop';
}

const { flush, abortInFlight } = createCoalescingFlush(async (signal) => {
  const queue = await locked(load);
  const settled: TourInviteQueueItem[] = [];
  for (const item of queue) {
    if (signal.aborted) break;
    const outcome = await deliver(item);
    if (signal.aborted) break;
    if (outcome === 'retry') continue;
    settled.push(item);
    if (outcome === 'ok') listeners.forEach((listener) => listener(item.planId));
  }
  if (!settled.length) return;
  await locked(async () => {
    const same = (a: TourInviteQueueItem, b: TourInviteQueueItem) => a.planId === b.planId && a.createdAt === b.createdAt
      && a.recipientIds.join(',') === b.recipientIds.join(',');
    await save((await load()).filter((item) => !settled.some((done) => same(done, item))));
  });
});

/** Resolves true once the invite is stored, so the screen says "later" only when a closed app cannot lose it. */
export async function enqueueTourInvite(planId: string, recipientIds: string[]): Promise<boolean> {
  let stored = false;
  await locked(async () => {
    const queue = await load();
    const waiting = queue.find((item) => item.planId === planId);
    const merged = [...new Set([...(waiting?.recipientIds ?? []), ...recipientIds])];
    if (!merged.length || merged.length > MAX_RECIPIENTS) return;
    const rest = queue.filter((item) => item.planId !== planId);
    if (rest.length >= MAX_ITEMS) return;
    // A fresh timestamp: the newest tap restarts the week it may wait.
    stored = await save([...rest, { planId, recipientIds: merged, createdAt: new Date().toISOString() }]);
  });
  return stored;
}

/** Revoking a link means nobody new should get into the tour: what still waits for signal goes. */
export async function dropTourInvites(planId: string): Promise<void> {
  await locked(async () => { await save((await load()).filter((item) => item.planId !== planId)); });
}

/** Friends still waiting for signal, so the sheet shows them as invited. */
export async function queuedTourInvitees(planId: string): Promise<string[]> {
  return (await locked(load)).find((item) => item.planId === planId)?.recipientIds ?? [];
}

export const flushTourInvitesQueue = (): Promise<void> => flush();

/** Account boundary: never invite the next account's friends in the previous account's name, or the other way round. */
export async function clearTourInvitesQueue(): Promise<void> {
  abortInFlight();
  await locked(() => save([]).then(() => undefined));
}
