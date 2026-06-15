/**
 * Personal pub-rating sync client — pushes a single private rating upsert/delete
 * to the backend and pulls the full per-account set back down.
 *
 * Same conventions as drinksClient / account: best-effort Bearer requests with
 * an 8s timeout that NEVER throw. Delivery guarantees live in pubRatingsQueue.ts
 * (persist-before-send + retry on launch/foreground). Restore/merge lives in
 * pubRatingsSync.ts.
 *
 * Privacy: a rating is the user's OWN memory of a pub ("stálo to za návrat?").
 * Syncing keeps it private and per-account — it is NOT a public review and is
 * never aggregated. It moves to the backend only so the same account sees the
 * same ratings across devices / after a reinstall.
 *
 * Wire format is snake_case; the app speaks camelCase (the store's PubRating)
 * and this module maps between the two. submitRatingUpsert / submitRatingDelete
 * return the SAME three-state result the drinks queue uses to decide keep/drop:
 *   - 'ok'              → 2xx: reached the backend, drop from queue.
 *   - 'permanent-error' → 400/422: this byte-stable payload will never succeed.
 *   - 'retry'           → network/timeout/5xx/429/401/dormant: keep + retry.
 *
 * fetchRatings() is the read side: it returns the parsed array or null (never
 * throws), mirroring submitPubCommunity's null-on-failure shape.
 */

import { clearCachedAnonymousAccount, ensureAccount, type AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import { trackClientEvent } from './telemetryClient';

/** A single rating in backend (snake_case) wire form for an upsert PUT. */
export interface WireRatingUpsert {
  name?: string;
  lat: number;
  lng: number;
  external_id?: string | null;
  verdict?: 'like' | 'dislike' | null;
  tag?: string | null;
  note?: string | null;
  /** ISO-8601 of the last local change — drives last-write-wins on the server. */
  updated_at: string;
}

/** A single rating in backend wire form as returned by GET /v1/pub-ratings. */
export interface WireRating {
  /** geohash-8 cell key = the local pubKey. */
  cache_key: string;
  name: string | null;
  lat: number;
  lng: number;
  external_id: string | null;
  verdict: 'like' | 'dislike' | null;
  tag: string | null;
  note: string | null;
  updated_at: string;
}

/** Outcome of one upsert/delete attempt — drives queue keep/drop decisions. */
export type SubmitRatingResult = 'ok' | 'permanent-error' | 'retry';

const REQUEST_TIMEOUT_MS = 8000;

async function classifyRatingHttpFailure(
  status: number,
  session: AccountSession,
): Promise<SubmitRatingResult> {
  if (status === 401) {
    await clearCachedAnonymousAccount(session);
    return 'retry';
  }
  // Validation errors are permanent for this byte-stable payload; other 4xx can
  // be transient (auth recovery, throttling, a frontend briefly ahead of the
  // backend during rollout), so keep them queued.
  if (status === 400 || status === 422) {
    return 'permanent-error';
  }
  return 'retry';
}

function trackRatingSynced(operation: 'submit_rating' | 'delete_rating'): void {
  void trackClientEvent({
    event: 'rating_synced',
    context: { operation },
  });
}

function trackRatingSyncFailed(
  operation: 'submit_rating' | 'delete_rating' | 'fetch_ratings',
  details: { status?: number; reason: string; result?: SubmitRatingResult; retryable?: boolean },
): void {
  void trackClientEvent({
    event: 'rating_sync_failed',
    severity: 'warning',
    context: {
      operation,
      status: details.status,
      reason: details.reason,
      sync_result: details.result,
      retryable: details.retryable,
    },
  });
}

/** Layer an external AbortSignal with an internal 8s timeout. */
function chainTimeout(signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }
  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
}

/**
 * PUT one rating upsert. Returns a three-state result (see SubmitRatingResult).
 * Never throws. Dormant backend or missing account → 'retry' so the payload
 * stays queued; the local rating still works regardless.
 */
export async function submitRatingUpsert(
  payload: WireRatingUpsert,
  signal?: AbortSignal,
): Promise<SubmitRatingResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint('/v1/pub-ratings');
  if (!endpoint) {
    trackRatingSyncFailed('submit_rating', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackRatingSyncFailed('submit_rating', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const abort = chainTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });

    if (resp.ok) {
      trackRatingSynced('submit_rating');
      return 'ok';
    }
    const result = await classifyRatingHttpFailure(resp.status, session);
    trackRatingSyncFailed('submit_rating', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    trackRatingSyncFailed('submit_rating', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  } finally {
    abort.cleanup();
  }
}

/**
 * DELETE one rating by its cache_key (= the local pubKey, put straight into the
 * URL). Same conventions as submitRatingUpsert. The endpoint is idempotent
 * (deleting a missing key replies 200 deleted:false → 'ok'), so re-sending a
 * queued delete is safe.
 */
export async function submitRatingDelete(
  pubKey: string,
  signal?: AbortSignal,
): Promise<SubmitRatingResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint(`/v1/pub-ratings/${encodeURIComponent(pubKey)}`);
  if (!endpoint) {
    trackRatingSyncFailed('delete_rating', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackRatingSyncFailed('delete_rating', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const abort = chainTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.ok) {
      trackRatingSynced('delete_rating');
      return 'ok';
    }
    const result = await classifyRatingHttpFailure(resp.status, session);
    trackRatingSyncFailed('delete_rating', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    trackRatingSyncFailed('delete_rating', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  } finally {
    abort.cleanup();
  }
}

function isWireRating(value: unknown): value is WireRating {
  const r = value as WireRating;
  return (
    !!r &&
    typeof r.cache_key === 'string' &&
    typeof r.updated_at === 'string'
  );
}

/**
 * GET the account's full set of ratings. Returns the parsed array, or null on
 * ANY failure (dormant backend, no account, network/timeout, non-2xx, malformed
 * body). Never throws. The caller (restorePubRatings) treats null as "nothing to
 * merge this time" and simply retries on the next flush.
 */
export async function fetchRatings(signal?: AbortSignal): Promise<WireRating[] | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/pub-ratings');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session);
      return null;
    }
    if (!resp.ok) {
      trackRatingSyncFailed('fetch_ratings', {
        status: resp.status,
        reason: 'http_error',
        retryable: true,
      });
      return null;
    }

    const data = (await resp.json()) as { ratings?: unknown };
    if (!data || !Array.isArray(data.ratings)) return null;
    return data.ratings.filter(isWireRating);
  } catch {
    trackRatingSyncFailed('fetch_ratings', {
      reason: 'network_or_timeout',
      retryable: true,
    });
    return null;
  } finally {
    abort.cleanup();
  }
}
