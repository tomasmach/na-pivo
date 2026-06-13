/**
 * Opening-hours client — talks to the app's own backend (NOT Mapy.cz) to look
 * up pub opening hours scraped from Firmy.cz.
 *
 * Design principle: opening hours are a NON-BLOCKING enrichment. If
 * EXPO_PUBLIC_BACKEND_URL is unset/empty, or the request fails/times out, this
 * module resolves to an empty (or partial) Map and NEVER throws — the compass
 * app then behaves exactly as it does without a backend, just without hours.
 *
 * Privacy note: calling the backend sends the pub name + coordinates to OUR
 * server, which is new data egress beyond Mapy.cz. This is disclosed in
 * cs.privacy.body and PRIVACY_POLICY.md.
 */

import type { HoursStatus, Pub, VenueKind } from './pubs';
import { getBackendEndpoint } from './backendConfig';
import type { CommunityBeer, WeeklyHours } from './communityHours';
import { beerFromWire, isWeeklyHours } from './communityHours';
import { trackApiFailure } from './telemetryClient';

export interface PubHoursResult {
  openingHours: string | null;
  isOpenNow: boolean | null;
  nextChange: string | null;
  status: HoursStatus;
  /** Origin of the hours, e.g. "community" | "firmy"; null when not reported. */
  source: string | null;
  /** Structured weekly hours, present when source is "community". */
  communityHours: WeeklyHours | null;
  /** Beers on tap, when the backend has them; empty array when none. */
  beers: CommunityBeer[];
  /** Public star rating from the backend source, on a 0-5 scale. */
  rating: number | null;
  /** Number of user ratings behind `rating`, when known. */
  ratingCount: number | null;
  /** Human rating label from the source, when known. */
  ratingLabel: string | null;
  /**
   * Backend verdict on whether this place is actually a pub, classified from
   * Firmy.cz categories (community beer reports override to 'pub' server-side).
   * Absent/unrecognized → 'unknown' for backward compatibility.
   */
  venueKind: VenueKind;
}

export interface FetchPubHoursOptions {
  /**
   * Max pubs the backend may enrich synchronously in this request.
   *
   * The detail UI defaults single-pub lookups to 0 so cache misses return
   * quickly as "pending" and the background worker spends proxy traffic at its
   * controlled pace. Batch callers keep the old bounded sync behavior.
   */
  syncBudget?: number;
}

interface WireBeer {
  name?: string;
  price_czk?: number;
  volume_ml?: number;
}

/** Shape of a single result entry in the backend's response. */
interface BackendResult {
  key?: string;
  name?: string;
  opening_hours?: string | null;
  isOpenNow?: boolean | null;
  nextChange?: string | null;
  status?: string;
  source?: string | null;
  confidence?: number | null;
  /** Structured weekly hours (present when source is community). */
  hours_json?: unknown;
  /** Beers on tap (may be absent on older backends). */
  beers?: WireBeer[];
  /** Public star rating (may be absent on older backends). */
  rating?: number | null;
  /** Number of public ratings (may be absent on older backends). */
  ratingCount?: number | null;
  /** Human rating label (may be absent on older backends). */
  ratingLabel?: string | null;
  /** Pub-vs-not verdict (may be absent on older backends). */
  venueKind?: string | null;
}

interface BackendResponse {
  results?: BackendResult[];
}

/** Client-side hard timeout for a single hours request. */
const REQUEST_TIMEOUT_MS = 8000;

/** Backend's accepted status values; anything else is normalized to 'unknown'. */
const VALID_BACKEND_STATUSES: ReadonlySet<string> = new Set([
  'ok',
  'unknown',
  'pending',
  'error',
]);

function normalizeStatus(raw: string | undefined): HoursStatus {
  if (raw && VALID_BACKEND_STATUSES.has(raw)) {
    return raw as HoursStatus;
  }
  return 'unknown';
}

/** Backend's accepted venueKind values; anything else (or absent) → 'unknown'. */
const VALID_VENUE_KINDS: ReadonlySet<string> = new Set([
  'pub',
  'maybe',
  'not_pub',
  'unknown',
]);

function normalizeVenueKind(raw: string | null | undefined): VenueKind {
  if (raw && VALID_VENUE_KINDS.has(raw)) {
    return raw as VenueKind;
  }
  return 'unknown';
}

function clampSyncBudget(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), 5));
}

function toResult(entry: BackendResult | undefined): PubHoursResult {
  if (!entry) {
    return {
      openingHours: null,
      isOpenNow: null,
      nextChange: null,
      status: 'unknown',
      source: null,
      communityHours: null,
      beers: [],
      rating: null,
      ratingCount: null,
      ratingLabel: null,
      venueKind: 'unknown',
    };
  }
  // Optional extended fields — old backends omit them; never break on absence.
  const communityHours = isWeeklyHours(entry.hours_json) ? entry.hours_json : null;
  const beers = Array.isArray(entry.beers)
    ? entry.beers.flatMap((b) => (b && typeof b.name === 'string' ? [beerFromWire(b as { name: string })] : []))
    : [];
  return {
    openingHours: entry.opening_hours ?? null,
    isOpenNow: typeof entry.isOpenNow === 'boolean' ? entry.isOpenNow : null,
    nextChange: entry.nextChange ?? null,
    status: normalizeStatus(entry.status),
    source: typeof entry.source === 'string' ? entry.source : null,
    communityHours,
    beers,
    rating: typeof entry.rating === 'number' && Number.isFinite(entry.rating) ? entry.rating : null,
    ratingCount:
      typeof entry.ratingCount === 'number' && Number.isFinite(entry.ratingCount)
        ? entry.ratingCount
        : null,
    ratingLabel: typeof entry.ratingLabel === 'string' ? entry.ratingLabel : null,
    venueKind: normalizeVenueKind(entry.venueKind),
  };
}

/**
 * Look up opening hours for the given pubs.
 *
 * Maps the backend's response (returned IN INPUT ORDER) back onto each pub's
 * `id` BY INDEX — the backend key is a geohash, not our pub id, so we must not
 * trust it for matching.
 *
 * @param pubs   The pubs to look up. Typically a single currently-targeted pub.
 * @param signal Optional caller AbortSignal (e.g. cancel on pub change/unmount).
 *               Layered with an internal 8s timeout.
 * @returns      A Map keyed by pub.id. Empty when the feature is dormant or the
 *               request fails; partial when only some entries resolve. Never throws.
 */
export async function fetchPubHours(
  pubs: Pub[],
  signal?: AbortSignal,
  options: FetchPubHoursOptions = {},
): Promise<Map<string, PubHoursResult>> {
  const out = new Map<string, PubHoursResult>();

  // Nothing to do, or already cancelled.
  if (pubs.length === 0 || signal?.aborted) {
    return out;
  }

  const endpoint = getBackendEndpoint('/v1/pub-hours');
  // Feature dormant — no backend configured.
  if (!endpoint) {
    return out;
  }

  // sync_budget tells the backend how many lazy fills to perform synchronously.
  // Single-pub detail lookups are latency-sensitive, so default them to a
  // cache-only request that queues background enrichment on a miss. Multi-pub
  // batch calls keep the previous bounded sync behavior.
  const syncBudget =
    options.syncBudget !== undefined
      ? clampSyncBudget(options.syncBudget)
      : pubs.length <= 1
        ? 0
        : Math.min(pubs.length, 5);

  const body = JSON.stringify({
    pubs: pubs.map((p) => ({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      city: p.city,
    })),
    sync_budget: syncBudget,
  });

  // Layer an internal timeout with the caller's signal. If either aborts, the
  // fetch aborts.
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
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: timeoutController.signal,
    });

    if (!resp.ok) {
      // Non-blocking: swallow HTTP errors, return what we have (empty).
      trackApiFailure('pub_hours', { endpoint: '/v1/pub-hours', status: resp.status });
      return out;
    }

    const data = (await resp.json()) as BackendResponse;
    const results = Array.isArray(data?.results) ? data.results : [];

    // Map results back to pub.id BY INDEX. Only fill entries the backend returned.
    const n = Math.min(results.length, pubs.length);
    for (let i = 0; i < n; i++) {
      out.set(pubs[i].id, toResult(results[i]));
    }

    return out;
  } catch (err) {
    // Any failure (network, abort, timeout, malformed JSON) → return whatever
    // we have so far. Never throw; hours are a non-blocking enrichment.
    if (!signal?.aborted) {
      trackApiFailure('pub_hours', {
        endpoint: '/v1/pub-hours',
        reason: 'exception',
        error: err,
      });
    }
    return out;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
