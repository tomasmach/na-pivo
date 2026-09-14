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
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import type { CommunityBeer, WeeklyHours, WireBeer } from './communityHours';
import { DAY_KEYS, beerFromWire, beerToWire } from './communityHours';
import type { WireMapperSnapshot } from './pubAmenitiesClient';
import { notifyUgcConsentRequiredFromResponse, ugcPolicyHeaders } from './ugcConsent';

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
  /** Present with a beer-list edit when the pub intentionally rotates its taps. */
  beerMenuRotates?: boolean;
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
  beer_menu_rotates?: boolean;
}

/** Backend response for a successful submission. */
export interface CommunityResponse {
  cacheKey: string;
  hours: WeeklyHours | null;
  beers: CommunityBeer[];
  historicalBeers: CommunityBeer[];
  beersUpdatedAt: string | null;
  beerMenuRotates: boolean;
  /** Mapér XP this submission paid (0 when the pub's facts were already
   *  contributed by this account). Additive field — 0 on older backends. */
  xpAwarded: number;
  /** Fresh Mapér snapshot to feed Profile, or null when XP was skipped. */
  mapper: WireMapperSnapshot | null;
}

interface WireResponse {
  cache_key?: string;
  hours?: WeeklyHours | null;
  beers?: WireBeer[];
  historical_beers?: WireBeer[];
  beers_updated_at?: string | null;
  beer_menu_rotates?: boolean;
  xp_awarded?: number;
  mapper?: WireMapperSnapshot | null;
}

const REQUEST_TIMEOUT_MS = 8000;

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
  if (typeof input.beerMenuRotates === 'boolean') {
    entry.beer_menu_rotates = input.beerMenuRotates;
  }
  return entry;
}

function parseCommunityResponse(data: WireResponse | null): CommunityResponse | null {
  if (!data?.cache_key) return null;
  return {
    cacheKey: data.cache_key,
    hours: data.hours ?? null,
    beers: Array.isArray(data.beers) ? data.beers.map(beerFromWire) : [],
    historicalBeers: Array.isArray(data.historical_beers)
      ? data.historical_beers.map(beerFromWire)
      : [],
    beersUpdatedAt: typeof data.beers_updated_at === 'string' ? data.beers_updated_at : null,
    beerMenuRotates: data.beer_menu_rotates === true,
    xpAwarded: typeof data.xp_awarded === 'number' ? data.xp_awarded : 0,
    mapper: data.mapper ?? null,
  };
}

/**
 * Queue-aware outcome: only 'ok' carries the parsed backend response;
 * 'permanent-error' (400/422 poison) and 'retry' never do.
 */
export type CommunitySubmitResult =
  | { status: 'ok'; response: CommunityResponse }
  | { status: 'permanent-error' }
  | { status: 'retry' };

/**
 * Queue-aware submit used by communityQueue. Every community submission is
 * public UGC, so the canonical UGC policy header is baked in on every attempt.
 * The response body is read at most once; on non-2xx the payload is only used
 * to surface a UGC-consent prompt before the shared keep/drop classification.
 * Never throws.
 */
export async function submitPubCommunityForQueue(
  entry: CommunityEntry,
  signal?: AbortSignal,
): Promise<CommunitySubmitResult> {
  if (signal?.aborted) return { status: 'retry' };

  const endpoint = getBackendEndpoint('/v1/pub-community');
  if (!endpoint) return { status: 'retry' };

  let session;
  try {
    session = await ensureAccount(signal);
  } catch {
    return { status: 'retry' };
  }
  if (!session || signal?.aborted) return { status: 'retry' };

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        ...ugcPolicyHeaders(session.accountId),
      },
      body: JSON.stringify(entry),
      signal: abort.signal,
    });

    let data: WireResponse | null = null;
    try {
      data = (await resp.json()) as WireResponse;
    } catch {
      data = null;
    }

    if (resp.ok) {
      const response = parseCommunityResponse(data);
      // A malformed 2xx envelope is a backend hiccup, not a bad payload — retry.
      return response ? { status: 'ok', response } : { status: 'retry' };
    }

    notifyUgcConsentRequiredFromResponse(resp.status, data);
    const classified = await classifyQueueHttpFailure(resp.status, session, {
      source: 'pub_community_submit',
      endpoint: '/v1/pub-community',
    });
    return classified === 'permanent-error'
      ? { status: 'permanent-error' }
      : { status: 'retry' };
  } catch {
    return { status: 'retry' };
  } finally {
    abort.cleanup();
  }
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
  const result = await submitPubCommunityForQueue(entry, signal);
  return result.status === 'ok' ? result.response : null;
}

/** Re-export so consumers have one import site for the structured day keys. */
export { DAY_KEYS };
