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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportPubIssue, type PubReportReason } from './pubReportsClient';
import type { Pub } from './pubs';

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

async function loadQueue(): Promise<QueuedPubReport[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is QueuedPubReport =>
        !!entry &&
        typeof (entry as QueuedPubReport).pub?.id === 'string' &&
        typeof (entry as QueuedPubReport).pub?.lat === 'number' &&
        typeof (entry as QueuedPubReport).pub?.lng === 'number' &&
        typeof (entry as QueuedPubReport).reason === 'string',
    );
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedPubReport[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Storage failure leaves the previous snapshot in place; the report was
    // already attempted once, so the worst case matches the old behavior.
  }
}

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose entries. */
let _chain: Promise<unknown> = Promise.resolve();

function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
  const next = _chain.then(task, task);
  _chain = next.catch(() => undefined);
  return next;
}

/** Attempts to send every queued report, keeping only the ones that failed. */
async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: QueuedPubReport[] = [];
  for (const entry of queue) {
    const sent = await reportPubIssue(entry.pub, entry.reason);
    if (!sent) remaining.push(entry);
  }
  await saveQueue(remaining);
}

/**
 * Persists the report and immediately tries to sync the whole queue.
 * Resolves true when this report reached the backend on the first attempt;
 * false means it stays queued for a later flush. Never throws.
 */
export function enqueuePubReport(pub: Pub, reason: PubReportReason): Promise<boolean> {
  return enqueueTask(async () => {
    const queue = await loadQueue();
    const entry: QueuedPubReport = { pub, reason };
    const key = entryKey(entry);
    const deduped = queue.filter((queued) => entryKey(queued) !== key);
    deduped.push(entry);
    await saveQueue(deduped.slice(-MAX_QUEUE_LENGTH));

    await flushLocked();
    const after = await loadQueue();
    return !after.some((queued) => entryKey(queued) === key);
  });
}

/**
 * Retries all pending reports. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushPubReportQueue(): Promise<void> {
  return enqueueTask(flushLocked);
}
