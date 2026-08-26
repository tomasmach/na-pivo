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
 *   - 'permanent-error' → validation error or the server's daily anti-abuse cap
 *                          (422 code "drink_limited", which also toasts the
 *                          user): retrying this byte-stable payload will never
 *                          succeed, drop from queue.
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
  /** The beer. Price is REQUIRED at a pub (the community-sourcing hook) and
   *  optional outside one. */
  beer: CommunityBeer & { servingType?: ServingType };
  /** ISO-8601 timestamp; defaults to now server-side when omitted. */
  drankAt?: string;
  /**
   * The shared evening this was drunk during, when there is one.
   *
   * The beer is still written exactly once, here, into the diary that counts.
   * The code only tags it, so the evening can show it — a shared table is a
   * lens over these rows, never a second place to log a beer.
   */
  partyCode?: string;
}

/** A single beer in backend (snake_case) wire form for a drink. */
interface WireDrinkBeer {
  name: string;
  price_czk?: number | null;
  volume_ml?: number | null;
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
  /** Ignored by the server when the evening ended or was never joined — a
   *  queued drink must never be rejected for the night it belongs to. */
  party_code?: string;
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

/**
 * True when a 422 response is the server's daily anti-abuse cap
 * (`{"code": "drink_limited"}`) rather than a validation error. Body parsing is
 * best-effort — any malformed body reads as a plain validation 422.
 */
async function isDrinkLimitedResponse(resp: Response): Promise<boolean> {
  try {
    const body = (await resp.json()) as { code?: unknown };
    return body?.code === 'drink_limited';
  } catch {
    return false;
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
  if (input.partyCode) entry.party_code = input.partyCode;
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
    if (resp.status === 422 && (await isDrinkLimitedResponse(resp))) {
      // Server anti-abuse daily cap: drop from the queue like any permanent
      // error, but tell the user their entry stays local-only instead of
      // letting it vanish silently.
      trackDrinkSyncFailed('submit_drink', {
        status: resp.status,
        reason: 'drink_limited',
        result: 'permanent-error',
        retryable: false,
      });
      showDrinkLimitedToast();
      return 'permanent-error';
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

/**
 * PATCH one previously-logged drink's private beer name by client_id. This is a
 * narrow typo-fix path: it does not rewrite pub, price, volume, timestamp or the
 * public community menu contribution.
 */
export interface DrinkUpdate {
  beer_name?: string;
  drink_type?: DrinkType;
  price_czk?: number | null;
  volume_ml?: number | null;
  serving_type?: ServingType;
}

/** PATCH one previously logged private drink. All fields are additive to the
 * original narrow rename contract, so released clients can keep sending only
 * `beer_name` while the full party editor syncs type, price and volume too. */
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

export function updateDrinkName(
  clientId: string,
  beerName: string,
  signal?: AbortSignal,
): Promise<SubmitDrinkResult> {
  return updateDrink(clientId, { beer_name: beerName }, signal);
}
