/**
 * Pub-visit ("evening") sync client — pushes one explicit visit record to the
 * backend and (for future use) pulls the account's visits back.
 *
 * A "visit" is one drinking evening at one pub (a TallySession). The individual
 * beers already sync via /v1/drinks; this records the EVENING itself as a first-
 * class fact so the backend has the sitting (when it started, when the last beer
 * landed) independent of the per-drink rows.
 *
 * Same conventions as drinksClient / account: best-effort Bearer requests with
 * an 8s timeout that NEVER throw. Delivery guarantees live in visitsQueue.ts
 * (persist-before-send + retry on launch/foreground). The POST is idempotent on
 * `client_id` (the session's clientId), so re-sending a queued/updated visit is
 * safe — the server upserts and replies duplicate:true with no new row.
 *
 * Wire format is snake_case. submitVisit / deleteVisit return the SAME three-
 * state result the drinks queue uses to decide keep/drop:
 *   - 'ok'              → 2xx: reached the backend, drop from queue.
 *   - 'permanent-error' → 400/422: this byte-stable payload will never succeed.
 *   - 'retry'           → network/timeout/5xx/429/401/dormant: keep + retry.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { trackClientEvent } from './telemetryClient';

/** The byte-stable visit payload persisted in the queue and POSTed on retry. */
export interface VisitEntry {
  /** = TallySession.clientId — the idempotency key. */
  client_id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  external_id?: string | null;
  /** ISO-8601 of the session start (first beer). */
  started_at: string;
  /** ISO-8601 of the last beer, or null while the evening is still open. */
  ended_at?: string | null;
  /** Explicit "Dopito" time. Missing keeps compatibility with older clients. */
  closed_at?: string | null;
  /** ISO-8601 of the last local change — drives last-write-wins on the server. */
  updated_at: string;
}

/** A single visit in backend wire form as returned by GET /v1/pub-visits. */
export interface WireVisit {
  client_id: string;
  cache_key: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  external_id: string | null;
  started_at: string;
  ended_at: string | null;
  closed_at?: string | null;
  updated_at: string;
}

/** Outcome of one visit POST/DELETE attempt — drives queue keep/drop. */
export type SubmitVisitResult = 'ok' | 'permanent-error' | 'retry';

const REQUEST_TIMEOUT_MS = 8000;

function trackVisitSynced(operation: 'submit_visit' | 'delete_visit'): void {
  void trackClientEvent({
    event: 'visit_synced',
    context: { operation },
  });
}

function trackVisitSyncFailed(
  operation: 'submit_visit' | 'delete_visit' | 'fetch_visits',
  details: { status?: number; reason: string; result?: SubmitVisitResult; retryable?: boolean },
): void {
  void trackClientEvent({
    event: 'visit_sync_failed',
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

/**
 * POST one visit (idempotent on client_id, so this doubles as the update path —
 * re-sending with a later ended_at updates the same record). Returns a three-
 * state result. Never throws. Dormant backend / missing account → 'retry'.
 */
export async function submitVisit(
  entry: VisitEntry,
  signal?: AbortSignal,
): Promise<SubmitVisitResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint('/v1/pub-visits');
  if (!endpoint) {
    trackVisitSyncFailed('submit_visit', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackVisitSyncFailed('submit_visit', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(entry),
      signal: abort.signal,
    });

    if (resp.ok) {
      trackVisitSynced('submit_visit');
      return 'ok';
    }
    const result = await classifyQueueHttpFailure(resp.status, session, {
      source: 'visit_submit',
      endpoint: '/v1/pub-visits',
    });
    trackVisitSyncFailed('submit_visit', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    trackVisitSyncFailed('submit_visit', {
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
 * DELETE one visit by its client_id — used when the user wipes their history.
 * Idempotent (a missing id replies 200 deleted:false → 'ok'). Same conventions
 * as submitVisit.
 */
export async function deleteVisit(
  clientId: string,
  signal?: AbortSignal,
): Promise<SubmitVisitResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint(`/v1/pub-visits/${encodeURIComponent(clientId)}`);
  if (!endpoint) {
    trackVisitSyncFailed('delete_visit', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackVisitSyncFailed('delete_visit', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.ok) {
      trackVisitSynced('delete_visit');
      return 'ok';
    }
    const result = await classifyQueueHttpFailure(resp.status, session, {
      source: 'visit_delete',
      endpoint: '/v1/pub-visits/:client_id',
    });
    trackVisitSyncFailed('delete_visit', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    trackVisitSyncFailed('delete_visit', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  } finally {
    abort.cleanup();
  }
}

function isWireVisit(value: unknown): value is WireVisit {
  const v = value as WireVisit;
  return (
    !!v &&
    typeof v.client_id === 'string' &&
    typeof v.started_at === 'string' &&
    typeof v.updated_at === 'string'
  );
}

/**
 * GET the account's full set of visits. Returns the parsed array, or null on ANY
 * failure (dormant backend, no account, network/timeout, non-2xx, malformed
 * body). Never throws. Exported for future read-side use (the app is push-only
 * for visits today).
 */
export async function fetchVisits(signal?: AbortSignal): Promise<WireVisit[] | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/pub-visits');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'visits_fetch',
        endpoint: '/v1/pub-visits',
      });
      return null;
    }
    if (!resp.ok) {
      trackVisitSyncFailed('fetch_visits', {
        status: resp.status,
        reason: 'http_error',
        retryable: true,
      });
      return null;
    }

    const data = (await resp.json()) as { visits?: unknown };
    if (!data || !Array.isArray(data.visits)) return null;
    return data.visits.filter(isWireVisit);
  } catch {
    trackVisitSyncFailed('fetch_visits', {
      reason: 'network_or_timeout',
      retryable: true,
    });
    return null;
  } finally {
    abort.cleanup();
  }
}
