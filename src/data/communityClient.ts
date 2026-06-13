/**
 * Community-contribution client — lets users submit opening hours and the beers
 * on tap for a pub, which the backend stores and shows publicly to everyone.
 *
 * Follows the same conventions as pubReportsClient / feedbackClient: a single
 * best-effort Bearer POST with an 8s timeout that never throws. Delivery
 * guarantees live in communityQueue.ts, which persists the payload before the
 * first send and retries on launch/foreground.
 *
 * The backend is idempotent on `client_id`, so re-sending a queued submission is
 * safe. Wire format is snake_case; the app speaks camelCase and this module maps
 * between the two.
 */

import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import type { CommunityBeer, WeeklyHours, WireBeer } from './communityHours';
import { DAY_KEYS, beerFromWire, beerToWire } from './communityHours';

export type { CommunityBeer, WeeklyHours };
export { beerFromWire, beerToWire };

/** What the UI hands to the queue/client — the stable bits the user edited. */
export interface CommunityInput {
  /** Stable id, name and coordinates of the pub being described. */
  externalId: string | null;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  /** Present only when the user edited opening hours. */
  hours?: WeeklyHours;
  /** Present only when the user edited the beer list (full replacement). */
  beers?: CommunityBeer[];
}

/** The byte-stable payload persisted in the queue and POSTed on every retry. */
export interface CommunityEntry {
  client_id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  external_id: string | null;
  hours?: WeeklyHours;
  beers?: WireBeer[];
}

/** Backend response for a successful submission. */
export interface CommunityResponse {
  cacheKey: string;
  hours: WeeklyHours | null;
  beers: CommunityBeer[];
}

interface WireResponse {
  cache_key?: string;
  hours?: WeeklyHours | null;
  beers?: WireBeer[];
}

const REQUEST_TIMEOUT_MS = 8000;

function chainAbortSignal(signal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
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

  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
}

/**
 * Build the retry-stable wire payload from the user's input + a fresh client_id.
 * Only the sections the user touched (`hours` / `beers`) are included — both are
 * optional but at least one must be present (validated by the caller/UI).
 */
export function buildCommunityEntry(input: CommunityInput, clientId: string): CommunityEntry {
  const entry: CommunityEntry = {
    client_id: clientId,
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    external_id: input.externalId,
  };
  const city = input.city?.trim();
  if (city) entry.city = city;
  if (input.hours) entry.hours = input.hours;
  if (input.beers) entry.beers = input.beers.map(beerToWire);
  return entry;
}

/**
 * POST one community submission. Returns the parsed backend response on success
 * (so the caller can refresh local state with the canonical stored data), or
 * null on any failure. Never throws.
 */
export async function submitPubCommunity(
  entry: CommunityEntry,
  signal?: AbortSignal,
): Promise<CommunityResponse | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/pub-community');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal);
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

    if (!resp.ok) return null;

    const data = (await resp.json()) as WireResponse;
    if (!data?.cache_key) return null;
    return {
      cacheKey: data.cache_key,
      hours: data.hours ?? null,
      beers: Array.isArray(data.beers) ? data.beers.map(beerFromWire) : [],
    };
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}

/** Re-export so consumers have one import site for the structured day keys. */
export { DAY_KEYS };
