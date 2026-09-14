/**
 * Persistent retry queue for in-app feedback.
 *
 * submitFeedback() is a single best-effort POST; when it fails (offline, account
 * registration hiccup, timeout) the message would be lost while the UI already
 * showed a thank-you. This queue persists every entry to AsyncStorage BEFORE the
 * first send attempt and retries pending entries on each app launch / foreground,
 * so a message eventually reaches the backend even if the first try fails.
 *
 * The backend endpoint is idempotent (keyed by client_id), so re-sending an
 * already-delivered entry is safe. Each queued entry carries the full payload,
 * so retries are byte-identical to the first attempt.
 */

import {
  submitFeedback,
  buildFeedbackEntry,
  type FeedbackEntry,
  type FeedbackInput,
} from './feedbackClient';
import { generateUuidV4 } from './account';
import { createCoalescingFlush, createQueueStorage, createQueueLock } from './createQueue';
import { Directory, File, Paths } from 'expo-file-system';
import { preserveDurableQueue } from './durableQueuePolicy';

const STORAGE_KEY = 'na-pivo-feedback-queue';
/** Historical queue limit retained as migration context; durable reports are never dropped. */
const MAX_QUEUE_LENGTH = 20;
const ATTACHMENTS_DIRECTORY = 'feedback-attachments';

function isFeedbackEntry(entry: unknown): entry is FeedbackEntry {
  const e = entry as FeedbackEntry;
  return (
    !!e &&
    typeof e.client_id === 'string' &&
    typeof e.category === 'string' &&
    typeof e.message === 'string' &&
    typeof e.app_version === 'string' &&
    typeof e.platform === 'string' &&
    typeof e.os_version === 'string' &&
    (e.attachment_uri === undefined || typeof e.attachment_uri === 'string')
  );
}

function attachmentsDirectory(): Directory {
  return new Directory(Paths.document, ATTACHMENTS_DIRECTORY);
}

async function persistAttachment(uri: string, clientId: string): Promise<string> {
  try {
    const directory = attachmentsDirectory();
    directory.create({ intermediates: true, idempotent: true });
    const destination = new File(directory, `${clientId}.jpg`);
    if (destination.exists) destination.delete();
    await new File(uri).copy(destination);
    return destination.uri;
  } catch {
    // The picker cache may still survive until the next flush; keep the report
    // usable even if durable-copying fails on a low-storage device.
    return uri;
  }
}

function deleteAttachment(entry: FeedbackEntry): void {
  if (!entry.attachment_uri) return;
  try {
    const durable = new File(attachmentsDirectory(), `${entry.client_id}.jpg`);
    if (durable.exists) durable.delete();
  } catch {
    // Best effort: one orphaned support JPEG must never crash queue cleanup.
  }
}

const { load: loadQueue, save: saveQueue } = createQueueStorage<FeedbackEntry>(
  STORAGE_KEY,
  isFeedbackEntry,
);

/** Serializes queue mutations — concurrent enqueue/flush calls would otherwise
 *  read-modify-write the same AsyncStorage snapshot and lose entries. */
const enqueueTask = createQueueLock();

/** Attempts to send every queued entry, keeping only the ones that failed. */
async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const queue = await enqueueTask(loadQueue);
  if (queue.length === 0) return;

  const settledIds = new Set<string>();
  for (const entry of queue) {
    if (signal.aborted) break;
    const result = await submitFeedback(entry, signal);
    if (result !== 'retry') settledIds.add(entry.client_id);
  }
  if (settledIds.size === 0) return;

  await enqueueTask(async () => {
    const current = await loadQueue();
    const removed = current.filter((entry) => settledIds.has(entry.client_id));
    const persisted = await saveQueue(
      current.filter((entry) => !settledIds.has(entry.client_id)),
    );
    if (persisted) removed.forEach(deleteAttachment);
  });
}

const feedbackDelivery = createCoalescingFlush(flushUnlocked);

/**
 * Persist the feedback (and any picked cache image) before resolving, then kick
 * off delivery without making the form wait for the network. Never throws.
 */
export async function enqueueFeedback(input: FeedbackInput): Promise<void> {
  await enqueueTask(async () => {
    const clientId = generateUuidV4();
    const attachmentUri = input.attachmentUri
      ? await persistAttachment(input.attachmentUri, clientId)
      : undefined;
    const entry = buildFeedbackEntry(input, clientId, attachmentUri);
    const queue = await loadQueue();
    queue.push(entry);
    const kept = preserveDurableQueue(queue, MAX_QUEUE_LENGTH);
    const keptIds = new Set(kept.map((item) => item.client_id));
    const dropped = queue.filter((item) => !keptIds.has(item.client_id));
    await saveQueue(kept);
    dropped.forEach(deleteAttachment);
  });
  void flushFeedbackQueue();
}

/**
 * Retries all pending feedback. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushFeedbackQueue(): Promise<void> {
  return feedbackDelivery.flush();
}

/** Drops queued feedback containing free text/contact details at account boundary changes. */
export function clearFeedbackQueue(): Promise<void> {
  feedbackDelivery.abortInFlight();
  return enqueueTask(async () => {
    await saveQueue([]);
    try {
      const directory = attachmentsDirectory();
      if (directory.exists) directory.delete();
    } catch {
      // Best-effort privacy cleanup at account boundaries.
    }
  }, { allowDuringPrivateTransition: true });
}
