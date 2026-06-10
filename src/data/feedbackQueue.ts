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

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  submitFeedback,
  buildFeedbackEntry,
  type FeedbackEntry,
  type FeedbackInput,
} from './feedbackClient';
import { generateUuidV4 } from './account';

const STORAGE_KEY = 'na-pivo-feedback-queue';
/** Hard cap — a queue this long means the backend has been unreachable for a
 *  very long time; dropping the oldest entries beats unbounded growth. */
const MAX_QUEUE_LENGTH = 20;

function isFeedbackEntry(entry: unknown): entry is FeedbackEntry {
  const e = entry as FeedbackEntry;
  return (
    !!e &&
    typeof e.client_id === 'string' &&
    typeof e.category === 'string' &&
    typeof e.message === 'string' &&
    typeof e.app_version === 'string' &&
    typeof e.platform === 'string' &&
    typeof e.os_version === 'string'
  );
}

async function loadQueue(): Promise<FeedbackEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFeedbackEntry);
  } catch {
    return [];
  }
}

async function saveQueue(queue: FeedbackEntry[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Storage failure leaves the previous snapshot in place; the entry was
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

/** Attempts to send every queued entry, keeping only the ones that failed. */
async function flushLocked(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: FeedbackEntry[] = [];
  for (const entry of queue) {
    const sent = await submitFeedback(entry);
    if (!sent) remaining.push(entry);
  }
  await saveQueue(remaining);
}

/**
 * Persists the feedback and immediately tries to sync the whole queue.
 * Resolves true when this entry reached the backend on the first attempt;
 * false means it stays queued for a later flush. Never throws.
 */
export function enqueueFeedback(input: FeedbackInput): Promise<boolean> {
  return enqueueTask(async () => {
    const entry = buildFeedbackEntry(input, generateUuidV4());
    const queue = await loadQueue();
    queue.push(entry);
    await saveQueue(queue.slice(-MAX_QUEUE_LENGTH));

    await flushLocked();
    const after = await loadQueue();
    return !after.some((queued) => queued.client_id === entry.client_id);
  });
}

/**
 * Retries all pending feedback. Call on app launch and on returning to the
 * foreground — both fire-and-forget. Never throws.
 */
export function flushFeedbackQueue(): Promise<void> {
  return enqueueTask(flushLocked);
}
