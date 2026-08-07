/**
 * Shared primitives for the AsyncStorage-backed offline retry queues in this
 * directory (drinks, visits, ratings, amenities, community, …).
 *
 * Every queue persists its payloads to a private STORAGE_KEY, serializes its
 * mutations so concurrent enqueue/flush calls can't lose entries, and retries on
 * launch / foreground. Only that byte-identical boilerplate lives here:
 *   - createQueueStorage: the validated AsyncStorage read/write/remove pair.
 *   - createQueueLock:     the single-slot async mutex.
 *   - createCoalescingFlush: the trailing-edge "one in flight, one queued" flush.
 *
 * The per-queue flush/dedup/in-flight semantics deliberately stay in each queue
 * module — that's where the offline retry contract is decided.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PrivateAccountMutationFrozenError,
  runPrivateAccountCleanupMutation,
  runPrivateAccountMutation,
} from './privateAccountBoundary';

/** A validated, AsyncStorage-backed list of queue entries under one key. */
export interface QueueStorage<T> {
  /** Load the persisted queue, dropping anything that fails `isValid`. Never throws. */
  load(): Promise<T[]>;
  /**
   * Persist the queue (removes the key entirely when empty). Never throws.
   * Existing queues may ignore the result; migration/backfill callers use it to
   * avoid marking a seed complete after an AsyncStorage write failed.
   */
  save(queue: T[]): Promise<boolean>;
}

/**
 * Binds the load/parse/validate/save/remove pattern to one storage key and entry
 * guard. `load` returns `[]` on any read/parse error and filters out malformed
 * entries; `save` removes the key when the queue is empty and silently leaves the
 * previous snapshot in place if the write fails (the entry was already attempted
 * once, so the worst case matches the pre-queue behavior).
 */
export function createQueueStorage<T>(
  storageKey: string,
  isValid: (entry: unknown) => entry is T,
): QueueStorage<T> {
  return {
    load: async (): Promise<T[]> => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isValid);
      } catch {
        return [];
      }
    },
    save: async (queue: T[]): Promise<boolean> => {
      try {
        if (queue.length === 0) {
          await AsyncStorage.removeItem(storageKey);
        } else {
          await AsyncStorage.setItem(storageKey, JSON.stringify(queue));
        }
        return true;
      } catch {
        // Storage failure leaves the previous snapshot in place.
        return false;
      }
    },
  };
}

/**
 * A single-slot async mutex: tasks run one at a time in call order, and a
 * rejected task never breaks the chain (its rejection still surfaces to its own
 * caller). Each queue owns its own instance, so its mutations never interleave
 * with a concurrent enqueue/flush of the same queue.
 */
export interface QueueLockRunOptions {
  /** Strict account cleanup is the only writer allowed after the global freeze. */
  allowDuringPrivateTransition?: boolean;
}

export interface QueueLockOptions {
  /** Photo/game queues own a stronger subsystem boundary and opt out explicitly. */
  protectPrivateAccount?: boolean;
}

export function createQueueLock(
  options: QueueLockOptions = {},
): <T>(task: () => Promise<T>, runOptions?: QueueLockRunOptions) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return function runLocked<T>(
    task: () => Promise<T>,
    runOptions: QueueLockRunOptions = {},
  ): Promise<T> {
    const enqueue = (): Promise<T> => {
      const next = chain.then(task, task);
      chain = next.catch(() => undefined);
      return next;
    };
    if (options.protectPrivateAccount === false) return enqueue();
    // Capture the global lease NOW, before waiting behind this queue's local
    // mutex. Otherwise an A task delayed here could wake after B is installed.
    if (runOptions.allowDuringPrivateTransition) {
      return runPrivateAccountCleanupMutation(enqueue);
    }
    return runPrivateAccountMutation(async () => enqueue());
  };
}

/** A trailing-edge coalescing flush plus a hook to cancel its in-flight network. */
export interface CoalescingFlush {
  /** Run the flush (trailing-edge coalesced). */
  flush: () => Promise<void>;
  /**
   * Abort the in-flight flush's network delivery, if any. `clear()` calls this at
   * an account boundary: delivery runs OUTSIDE the storage lock, so wiping the
   * queue alone does not stop an already-running flush from POSTing its remaining
   * snapshot — which, after the session has rotated, would attribute the previous
   * account's private data to the next one. The flush routine receives the signal
   * and must stop delivering once it is aborted. The next `flush()` starts with a
   * fresh signal.
   */
  abortInFlight: () => void;
}

/**
 * Wraps a flush routine with trailing-edge coalescing: only one flush runs at a
 * time (never two concurrently, preserving the no-duplicate-send guarantee), but
 * a call made while a flush is in flight schedules exactly one more flush to run
 * after it. That trailing flush re-snapshots the queue, so an item enqueued
 * mid-flight is delivered without waiting for the next launch. The returned
 * promise resolves only after that trailing flush completes.
 *
 * `run` receives an AbortSignal for the current flush; `abortInFlight()` aborts
 * it so an account-boundary clear can cancel delivery that is already underway.
 */
export function createCoalescingFlush(
  run: (signal: AbortSignal) => Promise<void>,
  options: QueueLockOptions = {},
): CoalescingFlush {
  let flushPromise: Promise<void> | null = null;
  let flushAgain: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const flush = (): Promise<void> => {
    if (flushPromise) {
      if (!flushAgain) {
        flushAgain = flushPromise.then(() => {
          flushAgain = null;
          return flush();
        });
      }
      return flushAgain;
    }
    controller = new AbortController();
    const localController = controller;
    const execute = options.protectPrivateAccount === false
      ? run(localController.signal)
      : runPrivateAccountMutation(async (scope) => {
          const combined = new AbortController();
          const abort = () => combined.abort();
          for (const signal of [localController.signal, scope.signal]) {
            if (signal.aborted) combined.abort();
            else signal.addEventListener('abort', abort);
          }
          try {
            await run(combined.signal);
          } finally {
            localController.signal.removeEventListener('abort', abort);
            scope.signal.removeEventListener('abort', abort);
          }
        }).catch((error) => {
          // A retry flush during the short credential freeze is a safe no-op;
          // the durable queue remains for the next foreground pass.
          if (!(error instanceof PrivateAccountMutationFrozenError)) throw error;
        });
    flushPromise = execute.finally(() => {
      flushPromise = null;
      controller = null;
    });
    return flushPromise;
  };
  const abortInFlight = (): void => {
    controller?.abort();
  };
  return { flush, abortInFlight };
}
