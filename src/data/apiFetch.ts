/**
 * Shared low-level request helpers for the backend HTTP clients in this folder.
 *
 * Every client speaks to the same backend with the same best-effort, never-throw
 * conventions, so the request lifecycle bits that used to be copy-pasted into each
 * one live here instead:
 *   - chainAbortSignal: layer a caller's AbortSignal with an internal hard timeout.
 *   - classifyQueueHttpFailure: map a non-2xx status to the three-state keep/drop
 *     result the persisted queues (drinks / ratings / amenities / visits) share.
 *
 * This module owns NO endpoint, header, or payload shape — those stay in each
 * client so the wire contract is still read in one place per feature.
 */

import { clearCachedAnonymousAccount, type AccountSession } from './account';

/**
 * Layer an optional external AbortSignal with an internal hard timeout. The
 * returned signal aborts when EITHER the caller cancels or `timeoutMs` elapses;
 * call `cleanup()` in a finally block to clear the timer and detach the listener.
 *
 * `signal` may be undefined for fire-and-forget callers that only want the
 * timeout (e.g. telemetry / uploads) — no listener is attached in that case.
 */
export function chainAbortSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const onExternalAbort = () => timeoutController.abort();

  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort);
    }
  }

  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
}

/** Three-state outcome the persisted-queue clients use to decide keep/drop. */
export type QueueSyncResult = 'ok' | 'permanent-error' | 'retry';

/**
 * Classify a non-2xx response for a persisted-queue submit/delete (drinks,
 * ratings, amenities, visits — all share this exact policy):
 *   - 401          → clear the cached anonymous account so the next flush
 *                    re-mints one, and keep the payload ('retry').
 *   - 400 / 422    → validation error: this byte-stable payload will never
 *                    succeed, drop it ('permanent-error').
 *   - anything else → transient (auth recovery, throttling, 5xx, or a frontend
 *                    briefly ahead of the backend during rollout), keep ('retry').
 */
export async function classifyQueueHttpFailure(
  status: number,
  session: AccountSession,
): Promise<QueueSyncResult> {
  if (status === 401) {
    await clearCachedAnonymousAccount(session);
    return 'retry';
  }
  if (status === 400 || status === 422) {
    return 'permanent-error';
  }
  return 'retry';
}
