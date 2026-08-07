/**
 * Persistent retry queue for pub-visit ("evening") sync.
 *
 * Each visit upsert/delete is a best-effort POST/DELETE via visitsClient. When a
 * send fails (offline, account hiccup, timeout, 5xx, 429, dormant backend) it
 * would be lost while the local tally has already recorded the evening. This
 * queue persists every operation to AsyncStorage BEFORE the first send and
 * retries on each app launch / foreground, so a visit eventually reaches the
 * backend.
 *
 * Like pubRatingsQueue, a visit is *state*, not an event: only the LATEST state
 * for a client_id matters. So enqueuing a new operation for a client_id
 * REPLACES any pending operation for the same client_id (last write wins). This
 * collapses the repeated upserts a growing evening produces (each new beer
 * bumps ended_at) into a single delivery, and lets a later delete supersede a
 * queued upsert.
 *
 * Each queue item is one operation on one client_id:
 *   - { op: 'upsert', clientId, entry } → POST the entry (idempotent on client_id).
 *   - { op: 'delete', clientId }        → DELETE the visit (evening wiped).
 *
 * Flush keep/drop rule (matches the mobile retry contract):
 *   - 'ok' (2xx)              → reached backend → drop from queue.
 *   - 'permanent-error' (4xx) → will never succeed → drop from queue.
 *   - 'retry' (network/5xx/429/dormant) → keep for the next flush.
 */

import {
  deleteVisit,
  submitVisit,
  type SubmitVisitResult,
  type VisitEntry,
} from './visitsClient';
import { createQueueStorage, createQueueLock, createCoalescingFlush } from './createQueue';

const STORAGE_KEY = 'na-pivo-visits-queue';
/** Hard cap — one item per evening; only bites with a very long offline backlog,
 *  where dropping the oldest beats unbounded growth. */
const MAX_QUEUE_LENGTH = 500;

/** One pending sync operation, keyed (and deduped) by client_id. */
export type VisitQueueItem =
  | { op: 'upsert'; clientId: string; entry: VisitEntry }
  | { op: 'delete'; clientId: string };

function isQueueItem(value: unknown): value is VisitQueueItem {
  const i = value as VisitQueueItem;
  if (!i || typeof i.clientId !== 'string') return false;
  if (i.op === 'delete') return true;
  if (i.op === 'upsert') {
    const e = (i as { entry?: VisitEntry }).entry;
    return (
      !!e &&
      typeof e.client_id === 'string' &&
      typeof e.name === 'string' &&
      typeof e.lat === 'number' &&
      typeof e.lng === 'number' &&
      typeof e.started_at === 'string' &&
      typeof e.updated_at === 'string'
    );
  }
  return false;
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<VisitQueueItem>(
  STORAGE_KEY,
  isQueueItem,
);

/** Serializes only AsyncStorage mutations. Network delivery deliberately runs
 *  outside this lock so a slow/offline flush cannot block a fresh visit update
 *  from being persisted immediately. */
const runMutation = createQueueLock();

async function deliver(item: VisitQueueItem): Promise<SubmitVisitResult> {
  return item.op === 'upsert' ? submitVisit(item.entry) : deleteVisit(item.clientId);
}

/** Stable content signature for an op, used to tell whether the queued op for a
 *  client_id is still the SAME one we just attempted (object identity is lost
 *  across the AsyncStorage JSON round-trip, so we compare by value). */
function signature(item: VisitQueueItem): string {
  return JSON.stringify(item);
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await runMutation(loadQueue);
  if (queue.length === 0) return;

  // Snapshot the exact op (by content) we attempt per client_id; re-load after
  // delivery so an op that landed mid-flush (replacing the pending op for a
  // client_id) is kept rather than clobbered by the stale result.
  const attempted = new Map<string, string>();
  const settled = new Set<string>();
  for (const item of queue) {
    // Stop before delivering the next op once an account-boundary clear has
    // aborted us, so a previous account's queued visits are never POSTed under
    // the session that replaces this one. (An op already in flight keeps the
    // token it captured before the boundary, so it still lands on the right
    // account.)
    if (signal.aborted) break;
    attempted.set(item.clientId, signature(item));
    const result = await deliver(item);
    if (result !== 'retry') settled.add(item.clientId);
  }

  await runMutation(async () => {
    const current = await loadQueue();
    const remaining = current.filter((item) => {
      const sig = attempted.get(item.clientId);
      if (sig === undefined || sig !== signature(item)) return true;
      return !settled.has(item.clientId);
    });
    await saveQueue(remaining);
  });
}

/**
 * Enqueue (and dedup) one visit operation, then immediately try to flush the
 * whole queue. A new operation for a client_id REPLACES any pending operation
 * for the same client_id (last write wins). Never throws.
 */
export async function enqueueVisitOp(
  item: VisitQueueItem,
  options?: { deliver?: boolean },
): Promise<void> {
  await runMutation(async () => {
    const queue = await loadQueue();
    const deduped = queue.filter((existing) => existing.clientId !== item.clientId);
    deduped.push(item);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  if (options?.deliver !== false) await flushVisitsQueue();
}

const { flush: _flush, abortInFlight } = createCoalescingFlush(flushUnlocked);

/** Drop all pending private visit sync operations without attempting delivery. */
export function clearVisitsQueue(): Promise<void> {
  // Cancel any in-flight flush first: its network loop runs outside runMutation,
  // so without this it could keep POSTing the previous account's visits under the
  // session that replaces this one.
  abortInFlight();
  return runMutation(async () => {
    await saveQueue([]);
  }, { allowDuringPrivateTransition: true });
}

/**
 * Retries all pending visit operations. Call on app launch and on returning to
 * the foreground — both fire-and-forget. Never throws. Trailing-edge coalesced
 * (see createCoalescingFlush): a visit op enqueued mid-flight is still delivered
 * without waiting for the next launch.
 */
export function flushVisitsQueue(): Promise<void> {
  return _flush();
}

/**
 * Resolve visits staged against a locally reserved table code.
 *
 * The explicit pub stop is persisted before the table POST so a process kill
 * cannot lose the move. Delivery is held back until that POST settles. On
 * success the confirmed code is written into the queued payload; on failure
 * the visit remains a valid private diary stop and is delivered without a
 * party association. The PubVisit endpoint is idempotent on client_id, so this
 * is also safe if a prior attempt reached the server but its response was lost.
 */
export async function resolveQueuedVisitPartyAssociation(
  pendingCode: string,
  confirmedCode: string | null,
): Promise<void> {
  const pending = pendingCode.trim().toUpperCase();
  const confirmed = confirmedCode?.trim().toUpperCase() || null;
  if (!pending) return;

  await runMutation(async () => {
    const queue = await loadQueue();
    let changed = false;
    const next = queue.map((item) => {
      if (
        item.op !== 'upsert' ||
        item.entry.party_code?.trim().toUpperCase() !== pending
      ) {
        return item;
      }
      changed = true;
      const entry = { ...item.entry };
      if (confirmed) entry.party_code = confirmed;
      else delete entry.party_code;
      return { ...item, entry };
    });
    if (changed) await saveQueue(next);
  });

  await flushVisitsQueue();
}
