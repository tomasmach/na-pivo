/**
 * The automatic Výčep feed: what the party actually drank, without anybody
 * having to hang the evening up first.
 *
 * The server groups every synced drink into sittings — one person, one drinking
 * day, one place — so a night at Cisterna arrives as a single row ("6 piv
 * Pilsner Urquell") instead of six. Prices are deliberately absent from the
 * payload: what a round cost is between you and your wallet.
 *
 * Cursor-paginated and read-only. There is nothing to queue offline here — a
 * feed you cannot reach is simply a feed you do not see.
 */

import { ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import type { FriendProfile } from './friendsClient';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;
const DEFAULT_LIMIT = 20;

/** Mirrors DrinkLog.drink_type; unknown server values are kept verbatim. */
export type PartaDrinkType = 'beer' | 'soft_drink' | 'shot' | 'wine' | (string & {});

/** Mirrors DrinkLog.serving_type. */
export type PartaServingType =
  | 'unknown'
  | 'draft'
  | 'bottle'
  | 'can'
  | 'plastic_bottle'
  | 'other'
  | (string & {});

/** Mirrors DrinkLog.place_context. */
export type PartaPlaceContext = 'pub' | 'private' | 'outdoors' | 'other' | (string & {});

/** One "3× Pilsner Urquell, točené" line inside a sitting. */
export interface PartaFeedDrink {
  drinkType: PartaDrinkType;
  servingType: PartaServingType;
  name: string;
  count: number;
}

/** One person, one drinking day, one place. */
export interface PartaFeedSitting {
  id: string;
  account: FriendProfile;
  mine: boolean;
  placeContext: PartaPlaceContext;
  pubName: string;
  pubCity: string;
  cacheKey: string;
  lat: number | null;
  lng: number | null;
  startedAt: string;
  endedAt: string;
  /** Every drink in the sitting, including any beyond the listed `items`. */
  total: number;
  beerCount?: number;
  wineCount?: number;
  softDrinkCount?: number;
  shotCount?: number;
  items: PartaFeedDrink[];
}

export interface PartaFeedPage {
  sittings: PartaFeedSitting[];
  nextCursor: string | null;
}

interface RawFeedDrink {
  drink_type?: string;
  serving_type?: string;
  name?: string;
  count?: number;
}

interface RawFeedSitting {
  id?: string;
  account?: Parameters<typeof parseFeedProfile>[0];
  is_mine?: boolean;
  place_context?: string;
  pub_name?: string | null;
  pub_city?: string | null;
  cache_key?: string | null;
  lat?: number | null;
  lng?: number | null;
  started_at?: string;
  ended_at?: string;
  total?: number;
  beer_count?: number;
  wine_count?: number;
  soft_drink_count?: number;
  shot_count?: number;
  items?: RawFeedDrink[];
}

/**
 * Local copy of the friends-client profile shape. Duplicated rather than
 * imported so this module owns its parsing and a change to one feed's wire
 * format cannot silently reshape the other's.
 */
function parseFeedProfile(
  raw: { id?: string; nickname?: string | null; display_name?: string; avatar_url?: string | null; is_public?: boolean } | undefined,
): FriendProfile {
  return {
    id: raw?.id ?? '',
    nickname: raw?.nickname ?? null,
    displayName: raw?.display_name ?? '',
    avatarUrl: raw?.avatar_url ?? null,
    isPublic: raw?.is_public !== false,
  };
}

function parseDrink(raw: RawFeedDrink): PartaFeedDrink {
  return {
    drinkType: typeof raw.drink_type === 'string' ? raw.drink_type : 'beer',
    servingType: typeof raw.serving_type === 'string' ? raw.serving_type : 'unknown',
    name: raw.name ?? '',
    count: typeof raw.count === 'number' && raw.count > 0 ? Math.floor(raw.count) : 1,
  };
}

function parseCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function parseSitting(raw: RawFeedSitting): PartaFeedSitting {
  const items = Array.isArray(raw.items) ? raw.items.map(parseDrink) : [];
  const listed = items.reduce((sum, item) => sum + item.count, 0);
  return {
    id: raw.id ?? '',
    account: parseFeedProfile(raw.account),
    mine: raw.is_mine === true,
    placeContext: typeof raw.place_context === 'string' ? raw.place_context : 'pub',
    pubName: raw.pub_name ?? '',
    pubCity: raw.pub_city ?? '',
    cacheKey: raw.cache_key ?? '',
    lat: typeof raw.lat === 'number' ? raw.lat : null,
    lng: typeof raw.lng === 'number' ? raw.lng : null,
    startedAt: raw.started_at ?? '',
    endedAt: raw.ended_at ?? raw.started_at ?? '',
    // The server truncates `items` but keeps `total` honest; a server that sends
    // neither still yields a count the row can print.
    total: typeof raw.total === 'number' && raw.total > 0 ? Math.floor(raw.total) : listed,
    beerCount: parseCount(raw.beer_count),
    wineCount: parseCount(raw.wine_count),
    softDrinkCount: parseCount(raw.soft_drink_count),
    shotCount: parseCount(raw.shot_count),
    items,
  };
}

/**
 * One page of the party's drinking history, newest first. Returns null on any
 * failure — the caller decides whether that is an empty state or a retry.
 */
export async function fetchPartaFeed(
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<PartaFeedPage | null> {
  const params = new URLSearchParams({ limit: String(options.limit ?? DEFAULT_LIMIT) });
  if (options.cursor) params.set('cursor', options.cursor);
  const path = `/v1/friends/drink-feed?${params.toString()}`;

  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) return null;

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) return null;

  const abort = chainAbortSignal(options.signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    // A backend that predates the feed 404s it. That is not an outage worth
    // reporting — it is an older server, and an empty page renders as "ticho".
    if (resp.status === 404) return { sittings: [], nextCursor: null };
    if (!resp.ok) return null;
    const data = (await resp.json()) as { results?: RawFeedSitting[]; next_cursor?: string | null };
    return {
      sittings: Array.isArray(data.results) ? data.results.map(parseSitting) : [],
      nextCursor: typeof data.next_cursor === 'string' ? data.next_cursor : null,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('parta_feed', { endpoint: '/v1/friends/drink-feed', reason: 'exception', error: err });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}
