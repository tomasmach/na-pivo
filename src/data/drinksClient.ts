/**
 * Drink-logging client — POSTs a single counted beer (which beer + its price)
 * to the backend, which both records the drink and community-merges the beer
 * into that pub's public menu (the price-sourcing hook).
 *
 * Same conventions as communityClient / account: a best-effort Bearer POST with
 * an 8s timeout that NEVER throws. Delivery guarantees live in drinksQueue.ts,
 * which persists the payload before the first send and retries on launch /
 * foreground.
 *
 * The endpoint is idempotent on `client_id`, so re-sending a queued drink is
 * safe (the server replies 200 + duplicate:true with no repeated side effects).
 *
 * Wire format is snake_case; the app speaks camelCase and this module maps
 * between the two. Unlike submitPubCommunity (which returns the parsed body or
 * null), submitDrink returns a THREE-state result the queue uses to decide
 * whether to drop or keep a payload:
 *   - 'ok'              → 2xx: the drink reached the backend, drop from queue.
 *   - 'permanent-error' → validation error: retrying this byte-stable payload
 *                          will never succeed, drop from queue.
 *   - 'retry'           → network error / timeout / 5xx / 429 / dormant: keep in
 *                          queue and retry on the next flush.
 */

import { clearCachedAnonymousAccount, ensureAccount, type AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import type { CommunityBeer } from './communityHours';
import { trackClientEvent } from './telemetryClient';

export type { CommunityBeer };

/** A single counted drink, in app (camelCase) form — what the UI hands over. */
export interface DrinkInput {
  /** The pub the drink was had at. */
  externalId?: string | null;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  /** The beer (price REQUIRED — it is the community-sourcing hook). */
  beer: CommunityBeer & { priceCzk: number };
  /** ISO-8601 timestamp; defaults to now server-side when omitted. */
  drankAt?: string;
}

/** A single beer in backend (snake_case) wire form for a drink. */
interface WireDrinkBeer {
  name: string;
  price_czk: number;
  volume_ml?: number;
}

/** The byte-stable payload persisted in the queue and POSTed on every retry. */
export interface DrinkEntry {
  client_id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  external_id?: string | null;
  beer: WireDrinkBeer;
  drank_at?: string;
}

/** Outcome of one POST attempt — drives queue keep/drop decisions. */
export type SubmitDrinkResult = 'ok' | 'permanent-error' | 'retry';

const REQUEST_TIMEOUT_MS = 8000;

async function classifyDrinkHttpFailure(
  status: number,
  session: AccountSession,
): Promise<SubmitDrinkResult> {
  if (status === 401) {
    await clearCachedAnonymousAccount(session);
    return 'retry';
  }

  // Validation errors are permanent for this byte-stable payload. Other 4xx
  // responses can be caused by auth recovery, throttling, or a frontend build
  // briefly running against an older backend during rollout, so keep them queued.
  if (status === 400 || status === 422) {
    return 'permanent-error';
  }

  return 'retry';
}

type DrinkSyncOperation = 'submit_drink' | 'delete_drink' | 'update_drink';

function trackDrinkSynced(operation: DrinkSyncOperation): void {
  void trackClientEvent({
    event: 'drink_synced',
    context: { operation },
  });
}

function trackDrinkSyncFailed(
  operation: DrinkSyncOperation,
  details: { status?: number; reason: string; result?: SubmitDrinkResult; retryable?: boolean },
): void {
  void trackClientEvent({
    event: 'drink_sync_failed',
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
 * Build the retry-stable wire payload from the user's input + a fresh client_id.
 * `external_id` and `city` are only included when present; `drank_at` defaults
 * to the build time so a delayed retry still records when the beer was actually
 * had (the server defaults to its own now only if omitted).
 */
export function buildDrinkEntry(input: DrinkInput, clientId: string): DrinkEntry {
  const beer: WireDrinkBeer = {
    name: input.beer.name,
    price_czk: input.beer.priceCzk,
  };
  if (typeof input.beer.volumeMl === 'number') beer.volume_ml = input.beer.volumeMl;

  const entry: DrinkEntry = {
    client_id: clientId,
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    beer,
  };
  const city = input.city?.trim();
  if (city) entry.city = city;
  if (input.externalId !== undefined) entry.external_id = input.externalId;
  entry.drank_at = input.drankAt ?? new Date().toISOString();
  return entry;
}

/**
 * POST one counted drink. Returns a three-state result (see SubmitDrinkResult).
 * Never throws.
 *
 * Dormant backend (no EXPO_PUBLIC_BACKEND_URL) or a missing account →
 * 'retry' so the payload stays queued; the local tally still works regardless.
 */
export async function submitDrink(
  entry: DrinkEntry,
  signal?: AbortSignal,
): Promise<SubmitDrinkResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint('/v1/drinks');
  if (!endpoint) {
    trackDrinkSyncFailed('submit_drink', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackDrinkSyncFailed('submit_drink', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort);
    }
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(entry),
      signal: timeoutController.signal,
    });

    if (resp.ok) {
      trackDrinkSynced('submit_drink');
      return 'ok';
    }
    const result = await classifyDrinkHttpFailure(resp.status, session);
    trackDrinkSyncFailed('submit_drink', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    // network / timeout / abort / malformed response — keep for a later flush.
    trackDrinkSyncFailed('submit_drink', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * DELETE one previously-logged drink by its client_id — used when the user
 * removes a counted beer that already reached the backend. Same conventions as
 * submitDrink: best-effort, 8s timeout, never throws, and returns the same
 * three-state result so deleteDrinksQueue can decide to drop or keep the id.
 *
 * The endpoint is idempotent (deleting a missing/already-deleted id replies 200
 * deleted:false), so re-sending a queued delete is safe. Deleting a drink does
 * NOT change the pub's community menu — the contributed price stays.
 */
export async function deleteDrink(
  clientId: string,
  signal?: AbortSignal,
): Promise<SubmitDrinkResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint(`/v1/drinks/${clientId}`);
  if (!endpoint) {
    trackDrinkSyncFailed('delete_drink', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackDrinkSyncFailed('delete_drink', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort);
    }
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: timeoutController.signal,
    });

    if (resp.ok) return 'ok';
    const result = await classifyDrinkHttpFailure(resp.status, session);
    trackDrinkSyncFailed('delete_drink', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    trackDrinkSyncFailed('delete_drink', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * PATCH one previously-logged drink's private beer name by client_id. This is a
 * narrow typo-fix path: it does not rewrite pub, price, volume, timestamp or the
 * public community menu contribution.
 */
export async function updateDrinkName(
  clientId: string,
  beerName: string,
  signal?: AbortSignal,
): Promise<SubmitDrinkResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint(`/v1/drinks/${clientId}`);
  if (!endpoint) {
    trackDrinkSyncFailed('update_drink', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackDrinkSyncFailed('update_drink', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort);
    }
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ beer_name: beerName }),
      signal: timeoutController.signal,
    });

    if (resp.ok) {
      trackDrinkSynced('update_drink');
      return 'ok';
    }
    const result = await classifyDrinkHttpFailure(resp.status, session);
    trackDrinkSyncFailed('update_drink', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    trackDrinkSyncFailed('update_drink', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
