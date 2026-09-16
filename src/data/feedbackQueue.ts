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
import { createQueueStorage, createQueueLock } from './createQueue';
import { Directory, File, Paths } from 'expo-file-system';

const STORAGE_KEY = 'na-pivo-feedback-queue';
/** Hard cap — a queue this long means the backend has been unreachable for a
 *  very long time; dropping the oldest entries beats unbounded growth. */
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
async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: FeedbackEntry[] = [];
  for (const entry of queue) {
    const result = await submitFeedback(entry);
    if (result === 'retry') {
      remaining.push(entry);
    } else {
      deleteAttachment(entry);
    }
  }
  await saveQueue(remaining);
}

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
    const dropped = queue.slice(0, Math.max(0, queue.length - MAX_QUEUE_LENGTH));
    await saveQueue(queue.slice(-MAX_QUEUE_LENGTH));
    dropped.forEach(deleteAttachment);
  });
  void flushFeedbackQueue();
}

/**
 * Retries all pending feedback. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushFeedbackQueue(): Promise<void> {
  return enqueueTask(flushLocked);
}

/** Drops queued feedback containing free text/contact details at account boundary changes. */
export function clearFeedbackQueue(): Promise<void> {
  return enqueueTask(async () => {
    await saveQueue([]);
    try {
      const directory = attachmentsDirectory();
      if (directory.exists) directory.delete();
    } catch {
      // Best-effort privacy cleanup at account boundaries.
    }
  });
}
