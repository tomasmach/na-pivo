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

/**
 * Thrown by `load` when the first read of a storage key fails on the I/O level
 * (AsyncStorage itself is unavailable) and no previously validated snapshot is
 * cached yet. Parse/validation problems never throw — they degrade to an empty
 * snapshot instead.
 */
export class QueueStorageReadError extends Error {
  readonly code = 'queue_storage_read_unavailable';

  constructor() {
    super('Queue storage is unavailable and no validated snapshot is cached.');
    this.name = 'QueueStorageReadError';
  }
}

/** A validated, AsyncStorage-backed list of queue entries under one key. */
export interface QueueStorage<T> {
  /**
   * Load the persisted queue, dropping anything that fails `isValid`. Throws
   * `QueueStorageReadError` only when the first-ever read fails on the I/O
   * level; once a snapshot has been validated, later I/O failures fall back to
   * a fresh defensive copy of it.
   */
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
 * guard. Each instance keeps the last successfully validated snapshot as
 * serialized JSON: reads return fresh defensive copies parsed from it, so caller
 * mutations can't reach the cache. A first I/O failure with nothing cached throws
 * `QueueStorageReadError` without touching writes; later ones fall back to the
 * cached snapshot. Malformed JSON / non-array values safely degrade to a
 * validated empty snapshot; arrays are filtered through `isValid`. A successful
 * `save` replaces the cached snapshot exactly with what was written; a failed
 * write leaves it untouched.
 */
export function createQueueStorage<T>(
  storageKey: string,
  isValid: (entry: unknown) => entry is T,
): QueueStorage<T> {
  let cachedSnapshotJson: string | null = null;
  const cacheSnapshot = (queue: T[]): void => {
    cachedSnapshotJson = JSON.stringify(queue);
  };
  const snapshotCopy = (): T[] => {
    const parsed = JSON.parse(cachedSnapshotJson as string) as unknown[];
    return parsed.filter(isValid);
  };
  return {
    load: async (): Promise<T[]> => {
      let raw: string | null;
      try {
        raw = await AsyncStorage.getItem(storageKey);
      } catch {
        if (cachedSnapshotJson === null) throw new QueueStorageReadError();
        return snapshotCopy();
      }
      if (!raw) {
        cacheSnapshot([]);
        return [];
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          cacheSnapshot([]);
          return [];
        }
        const valid = parsed.filter(isValid);
        cacheSnapshot(valid);
        return snapshotCopy();
      } catch {
        cacheSnapshot([]);
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
        cacheSnapshot(queue);
        return true;
      } catch {
        // Storage failure leaves the previous validated snapshot in place.
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
    const execute = Promise.resolve(
      options.protectPrivateAccount === false
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
          }),
    ).catch((error) => {
      // Two safe no-ops: a retry flush during the short credential freeze, and
      // a cold queue storage read failure; both leave the durable queue intact
      // for the next foreground pass.
      if (
        !(error instanceof PrivateAccountMutationFrozenError) &&
        !(error instanceof QueueStorageReadError)
      ) throw error;
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
