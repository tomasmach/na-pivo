/**
 * Persistent retry queue for pub reports.
 *
 * reportPubIssue() is a single best-effort POST; when it fails (offline, account
 * registration hiccup, timeout) the report used to be lost silently while the
 * local hide masked the failure — the place stayed visible for everyone else.
 * This queue persists every report to AsyncStorage BEFORE the first send
 * attempt and retries pending entries on each app launch / foreground, so a
 * report eventually reaches the backend even if the first try fails.
 *
 * The backend endpoint is idempotent (update_or_create keyed by
 * account+cache_key+reason), so re-sending an already-delivered report is safe.
 */

import { reportPubIssue, type PubReportReason } from './pubReportsClient';
import type { Pub } from './pubs';
import { createCoalescingFlush, createQueueStorage, createQueueLock } from './createQueue';

const STORAGE_KEY = 'na-pivo-pub-report-queue';
/** Hard cap — a queue this long means the backend has been unreachable for a
 *  very long time; dropping the oldest entries beats unbounded growth. */
const MAX_QUEUE_LENGTH = 50;

interface QueuedPubReport {
  pub: Pub;
  reason: PubReportReason;
}

function entryKey(entry: QueuedPubReport): string {
  return `${entry.pub.id}|${entry.reason}`;
}

function isQueuedPubReport(entry: unknown): entry is QueuedPubReport {
  return (
    !!entry &&
    typeof (entry as QueuedPubReport).pub?.id === 'string' &&
    typeof (entry as QueuedPubReport).pub?.lat === 'number' &&
    typeof (entry as QueuedPubReport).pub?.lng === 'number' &&
    typeof (entry as QueuedPubReport).reason === 'string'
  );
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<QueuedPubReport>(
  STORAGE_KEY,
  isQueuedPubReport,
);

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose entries. */
const storageTask = createQueueLock();

/** Network runs outside the storage lock, so a new report can always be
 * persisted instantly even while an old backlog is timing out. */
async function deliverQueue(signal: AbortSignal): Promise<void> {
  const queue = await storageTask(loadQueue);
  if (queue.length === 0) return;

  const sentKeys = new Set<string>();
  for (const entry of queue) {
    if (signal.aborted) return;
    const sent = await reportPubIssue(entry.pub, entry.reason, signal);
    if (sent) sentKeys.add(entryKey(entry));
  }
  if (sentKeys.size === 0) return;
  await storageTask(async () => {
    const latest = await loadQueue();
    await saveQueue(latest.filter((entry) => !sentKeys.has(entryKey(entry))));
  });
}

const reportDelivery = createCoalescingFlush(deliverQueue);

/**
 * Persists the report and immediately tries to sync the whole queue.
 * Resolves true when this report reached the backend on the first attempt;
 * false means it stays queued for a later flush. Never throws.
 */
export function enqueuePubReport(pub: Pub, reason: PubReportReason): Promise<boolean> {
  return storageTask(async () => {
    const queue = await loadQueue();
    const entry: QueuedPubReport = { pub, reason };
    const key = entryKey(entry);
    const deduped = queue.filter((queued) => entryKey(queued) !== key);
    deduped.push(entry);
    const persisted = await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
    if (!persisted) return false;

    return true;
  }).then(async (persisted) => {
    if (!persisted) return false;
    await reportDelivery.flush();
    const after = await storageTask(loadQueue);
    return !after.some((queued) => entryKey(queued) === entryKey({ pub, reason }));
  });
}

/**
 * Persists a report before the UI hides the pub, then syncs in the background.
 * This keeps the action instant even when an older queued report has to wait
 * for the network timeout. False means nothing durable was written.
 */
export async function persistPubReport(pub: Pub, reason: PubReportReason): Promise<boolean> {
  const persisted = await storageTask(async () => {
    const queue = await loadQueue();
    const entry: QueuedPubReport = { pub, reason };
    const key = entryKey(entry);
    const deduped = queue.filter((queued) => entryKey(queued) !== key);
    deduped.push(entry);
    return saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));
  });
  if (persisted) void flushPubReportQueue().catch(() => undefined);
  return persisted;
}

/**
 * Retries all pending reports. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushPubReportQueue(): Promise<void> {
  return reportDelivery.flush();
}

export function clearPubReportQueue(): Promise<void> {
  reportDelivery.abortInFlight();
  return storageTask(async () => {
    await saveQueue([]);
  }, { allowDuringPrivateTransition: true });
}
