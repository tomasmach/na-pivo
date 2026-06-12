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
 *   - 'permanent-error' → 4xx (validation / auth): retrying will never succeed,
 *                          drop from queue.
 *   - 'retry'           → network error / timeout / 5xx / 429 / dormant: keep in
 *                          queue and retry on the next flush.
 */

import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import type { CommunityBeer } from './communityHours';

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
  if (!endpoint) return 'retry';

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return 'retry';

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

    if (resp.ok) return 'ok';
    // 4xx (except 429) is permanent: the payload is malformed or unauthorized and
    // will never be accepted, so drop it. 429 (throttled) and 5xx are transient.
    if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
      return 'permanent-error';
    }
    return 'retry';
  } catch {
    // network / timeout / abort / malformed response — keep for a later flush.
    return 'retry';
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
