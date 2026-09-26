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
 * null), submitDrink returns a result the queue uses to decide whether to drop
 * or keep a payload:
 *   - 'ok'              → 2xx: the drink reached the backend, drop from queue.
 *   - 'permanent-error' → validation error: retrying this byte-stable payload
 *                          will never succeed, drop from queue. The local drink
 *                          is kept and flagged so the user can fix or remove it.
 *   - 'limited'         → the server's daily anti-abuse cap (422 code
 *                          "drink_limited", which also toasts the user): drop
 *                          from queue, the drink stays in the local diary.
 *   - 'retry'           → network error / timeout / 5xx / 429 / dormant: keep in
 *                          queue and retry on the next flush.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import type { CommunityBeer } from './communityHours';
import { trackClientEvent } from './telemetryClient';
import {
  isDrinkType,
  isOutsidePlaceContext,
  isServingType,
  normalizePlaceContext,
  type DrinkType,
  type PlaceContext,
  type ServingType,
} from '@/drinks/drinkTypes';
import { useToastStore } from '@/stores/toastStore';
import { t } from '@/i18n';
import { notePivarSnapshot } from './pivarXp';

export type { CommunityBeer };

/** A single counted drink, in app (camelCase) form — what the UI hands over.
 *  Pub identity fields are required for a pub drink and MUST be absent for an
 *  outside one (`placeContext` other than pub) — no coordinates ever leave the
 *  device for a beer at home. */
export interface DrinkInput {
  /** Where the drink was had. Missing means pub (compat with old callers). */
  placeContext?: PlaceContext;
  /** The pub the drink was had at (pub context only). */
  externalId?: string | null;
  name?: string;
  lat?: number;
  lng?: number;
  city?: string;
  /** Beer remains the default for compatibility with older queued payloads. */
  drinkType?: DrinkType;
  /** The beer. Price may be absent in records restored from 2.0. */
  beer: CommunityBeer & { servingType?: ServingType };
  /** ISO-8601 timestamp; defaults to now server-side when omitted. */
  drankAt?: string;
}

/** A single beer in backend (snake_case) wire form for a drink. */
interface WireDrinkBeer {
  name: string;
  price_czk?: number;
  volume_ml?: number;
  serving_type?: ServingType;
}

/** The byte-stable payload persisted in the queue and POSTed on every retry. */
export interface DrinkEntry {
  client_id: string;
  place_context?: PlaceContext;
  name?: string;
  lat?: number;
  lng?: number;
  city?: string;
  external_id?: string | null;
  drink_type?: DrinkType;
  beer: WireDrinkBeer;
  drank_at?: string;
}

/** One private drink in the authoritative account snapshot returned by GET. */
export interface WireDrink {
  client_id: string;
  cache_key: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
  city: string;
  external_id: string;
  place_context: PlaceContext;
  drink_type: DrinkType;
  beer: {
    name: string;
    price_czk: number | null;
    volume_ml: number | null;
    serving_type: ServingType;
  };
  drank_at: string;
  is_suspect: boolean;
}

/** Outcome of one POST attempt — drives queue keep/drop decisions. */
export type SubmitDrinkResult = 'ok' | 'permanent-error' | 'retry';
/** submitDrink also tells the daily cap apart from a validation rejection. */
export type SubmitDrinkOutcome = SubmitDrinkResult | 'limited';

const REQUEST_TIMEOUT_MS = 8000;

function isWireDrink(value: unknown): value is WireDrink {
  const drink = value as Partial<WireDrink>;
  const beer = drink?.beer as Partial<WireDrink['beer']> | undefined;
  return (
    !!drink &&
    typeof drink.client_id === 'string' &&
    (drink.cache_key === null || typeof drink.cache_key === 'string') &&
    typeof drink.name === 'string' &&
    (drink.lat === null || (typeof drink.lat === 'number' && Number.isFinite(drink.lat))) &&
    (drink.lng === null || (typeof drink.lng === 'number' && Number.isFinite(drink.lng))) &&
    typeof drink.city === 'string' &&
    typeof drink.external_id === 'string' &&
    (drink.place_context === 'pub' || isOutsidePlaceContext(drink.place_context)) &&
    isDrinkType(drink.drink_type) &&
    typeof drink.drank_at === 'string' &&
    typeof drink.is_suspect === 'boolean' &&
    !!beer &&
    typeof beer.name === 'string' &&
    (beer.price_czk === null ||
      (typeof beer.price_czk === 'number' && Number.isFinite(beer.price_czk))) &&
    (beer.volume_ml === null ||
      (typeof beer.volume_ml === 'number' && Number.isFinite(beer.volume_ml))) &&
    isServingType(beer.serving_type)
  );
}

/** GET the account's full private drink snapshot. Best-effort and never throws. */
export async function fetchDrinks(signal?: AbortSignal): Promise<WireDrink[] | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/drinks');
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
        source: 'drinks_fetch',
        endpoint: '/v1/drinks',
      });
      return null;
    }
    if (!resp.ok) return null;

    const data = (await resp.json()) as { drinks?: unknown };
    if (!data || !Array.isArray(data.drinks)) return null;
    return data.drinks.filter(isWireDrink);
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}

/** Minimum gap between "drink limited" toasts, so a queue flush that trips the
 *  server's daily anti-abuse cap on several drinks in a row nags only once. */
const DRINK_LIMITED_TOAST_GAP_MS = 60_000;
let lastDrinkLimitedToastAt = 0;

/** Best-effort parse of a 400/422 body: the daily cap code and the first
 *  rejected field path (`validation_errors: [{field, code}]`). Malformed or
 *  older bodies read as a plain validation error with no field. */
async function readRejection(resp: Response): Promise<{ limited: boolean; field?: string }> {
  try {
    const body = (await resp.json()) as { code?: unknown; validation_errors?: unknown };
    const first = Array.isArray(body?.validation_errors)
      ? (body.validation_errors[0] as { field?: unknown } | undefined)
      : undefined;
    return {
      limited: body?.code === 'drink_limited',
      ...(typeof first?.field === 'string' ? { field: first.field } : {}),
    };
  } catch {
    return { limited: false };
  }
}

/** Tell the user once that a drink stays local-only; the local diary keeps it. */
function showDrinkLimitedToast(): void {
  const now = Date.now();
  if (now - lastDrinkLimitedToastAt < DRINK_LIMITED_TOAST_GAP_MS) return;
  lastDrinkLimitedToastAt = now;
  useToastStore.getState().show(t.counter.drinkLimitedToast);
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
 *
 * An outside drink (`placeContext` ≠ pub) sends `place_context` and NO pub
 * fields at all — the server rejects coordinates for non-pub contexts, so
 * omitting them here is both privacy and correctness.
 */
export function buildDrinkEntry(input: DrinkInput, clientId: string): DrinkEntry {
  const placeContext = normalizePlaceContext(input.placeContext);
  const atPub = placeContext === 'pub';

  const beer: WireDrinkBeer = { name: input.beer.name };
  if (typeof input.beer.priceCzk === 'number') beer.price_czk = input.beer.priceCzk;
  if (typeof input.beer.volumeMl === 'number') beer.volume_ml = input.beer.volumeMl;
  if (input.beer.servingType && input.beer.servingType !== 'unknown') {
    beer.serving_type = input.beer.servingType;
  }

  const entry: DrinkEntry = { client_id: clientId, beer };
  if (atPub) {
    entry.name = input.name ?? '';
    entry.lat = input.lat;
    entry.lng = input.lng;
    const city = input.city?.trim();
    if (city) entry.city = city;
    if (input.externalId !== undefined) entry.external_id = input.externalId;
  } else {
    entry.place_context = placeContext;
  }
  if (input.drinkType && input.drinkType !== 'beer') entry.drink_type = input.drinkType;
  entry.drank_at = input.drankAt ?? new Date().toISOString();
  return entry;
}

/**
 * POST one counted drink. Returns a SubmitDrinkOutcome. Never throws.
 *
 * Dormant backend (no EXPO_PUBLIC_BACKEND_URL) or a missing account →
 * 'retry' so the payload stays queued; the local tally still works regardless.
 */
export async function submitDrink(
  entry: DrinkEntry,
  signal?: AbortSignal,
  /** Called with the first rejected field path on a validation rejection. */
  onRejected?: (field?: string) => void,
): Promise<SubmitDrinkOutcome> {
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
      trackDrinkSynced('submit_drink');
      // The response carries the server-authoritative drink-XP component; patch
      // it into the one combined account level. Malformed bodies are ignored.
      try {
        const body = (await resp.json()) as { pivar?: unknown };
        if (body?.pivar) notePivarSnapshot(body.pivar);
      } catch {
        // Older backend / empty body — no XP component to patch.
      }
      return 'ok';
    }
    const rejection =
      resp.status === 400 || resp.status === 422 ? await readRejection(resp) : null;
    if (resp.status === 422 && rejection?.limited) {
      // Server anti-abuse daily cap: drop from the queue, but tell the user
      // their entry stays local-only. There is nothing to fix, so it is not
      // flagged as rejected.
      trackDrinkSyncFailed('submit_drink', {
        status: resp.status,
        reason: 'drink_limited',
        result: 'permanent-error',
        retryable: false,
      });
      showDrinkLimitedToast();
      return 'limited';
    }
    const result = await classifyQueueHttpFailure(resp.status, session, {
      source: 'drink_submit',
      endpoint: '/v1/drinks',
    });
    trackDrinkSyncFailed('submit_drink', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    if (result === 'permanent-error') onRejected?.(rejection?.field);
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
    abort.cleanup();
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

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.ok) return 'ok';
    const result = await classifyQueueHttpFailure(resp.status, session, {
      source: 'drink_delete',
      endpoint: '/v1/drinks/:client_id',
    });
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
    abort.cleanup();
  }
}

export interface DrinkUpdate {
  beer_name?: string;
  drink_type?: DrinkType;
  price_czk?: number | null;
  volume_ml?: number | null;
  serving_type?: ServingType;
}

/** Send private drink edits, including fields queued by the 2.0 editor. */
export async function updateDrink(
  clientId: string,
  update: DrinkUpdate,
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

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(update),
      signal: abort.signal,
    });

    if (resp.ok) {
      trackDrinkSynced('update_drink');
      return 'ok';
    }
    const result = await classifyQueueHttpFailure(resp.status, session, {
      source: 'drink_update',
      endpoint: '/v1/drinks/:client_id',
    });
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
    abort.cleanup();
  }
}

/** Keep the simple UI's rename contract. */
export function updateDrinkName(
  clientId: string,
  beerName: string,
  signal?: AbortSignal,
): Promise<SubmitDrinkResult> {
  return updateDrink(clientId, { beer_name: beerName }, signal);
}
