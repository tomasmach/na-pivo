/**
 * Piva tab reads: the national ranking, beer search, a beer page with its
 * everyone-wide numbers, public reviews and my collection. Online-only reads;
 * every call resolves to data or null and never throws into the UI.
 */

import { ensureAccount } from './account';
import { reportProfileContent } from './auth';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { parseBeerDetail, parseBeerTags, type BeerDetail, type BeerTag } from './beerCheckinsClient';

const REQUEST_TIMEOUT_MS = 9000;

export const BEER_STYLES = ['pale', 'amber', 'dark', 'craft'] as const;
export type BeerStyle = (typeof BEER_STYLES)[number];
/** An answer to "Co je to za pivo?": a filter kind, something else, or "Nevím". */
export type StyleAnswer = BeerStyle | 'other' | 'unknown';
/** Czech degrees buckets; '10' also holds weaker beers, '13plus' everything stronger. */
export const BEER_DEGREES = ['10', '11', '12', '13plus'] as const;
export type BeerDegree = (typeof BEER_DEGREES)[number];

function degree(value: unknown): BeerDegree | null {
  return BEER_DEGREES.includes(value as BeerDegree) ? (value as BeerDegree) : null;
}
export type RankingOrder = 'best' | 'bottom';
export type ReviewFilter = 'newest' | 'party' | 'photo';

/** NUTS 3 codes of the Czech regions; the ranking counts where a beer was rated and drunk. */
export const CZ_REGIONS = ['CZ010', 'CZ020', 'CZ031', 'CZ032', 'CZ041', 'CZ042', 'CZ051', 'CZ052', 'CZ053', 'CZ063', 'CZ064', 'CZ071', 'CZ072', 'CZ080'] as const;
export type CzRegion = (typeof CZ_REGIONS)[number];

export interface RankedBeer {
  productKey: string;
  name: string;
  brandName: string;
  styles: BeerStyle[];
  degree: BeerDegree | null;
  ratingAvg: number | null;
  ratingCount: number;
  rank: number | null;
  position: number;
  /** Places gained since last week; null when it was not ranked then. */
  move: number | null;
  /** Share of raters per star, 5★ first. */
  stars: number[];
  topTag: BeerTag | null;
  /** Drinks logged of it, nationally or at pubs in the asked region. */
  drunkTotal: number;
}

export interface BeerRankingPage {
  early: boolean;
  items: RankedBeer[];
  nextCursor: string | null;
}

export interface BeerSearchItem {
  productKey: string;
  name: string;
  brandName: string;
  styles: BeerStyle[];
  ratingAvg: number | null;
  ratingCount: number;
}

export interface NearestPub {
  cacheKey: string;
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  priceCzk: number | null;
}

export interface BeerPage extends BeerDetail {
  productKey: string | null;
  brandName: string;
  styles: BeerStyle[];
  globalRating: number | null;
  globalRatingCount: number;
  nationalRank: number | null;
  ratingStars: number[];
  /** Percent of people who tagged it, most common first. */
  tagShares: { tag: BeerTag; percent: number }[];
  drunkTotal: number;
  drinkers: number;
  drunkWeek: number;
  pubsPouring: number;
  nearestPub: NearestPub | null;
  photoCount: number | null;
  /** Enough people agreed on the style, so the app stops asking. */
  styleSettled: boolean;
  myStyle: StyleAnswer | null;
  /** Known from the name or what most people answered. */
  degree: BeerDegree | null;
  myDegree: BeerDegree | null;
}

export interface BeerReview {
  id: string;
  authorId: string;
  authorName: string;
  inParty: boolean;
  rating: number | null;
  note: string;
  pubName: string;
  /** Local day, YYYY-MM-DD. Reviews never carry the hour. */
  day: string;
  cheers: number;
  cheered: boolean;
  photoUrl: string | null;
}

export interface BeerReviewsPage {
  total: number;
  items: BeerReview[];
  nextCursor: string | null;
}

export interface BeerCollection {
  distinctBeers: number;
  drunkTotal: number;
  breweries: number;
  taster: {
    level: number;
    tier: number;
    target: number;
    have: number;
    missing: { productKey: string; name: string; nearestDistanceM: number | null } | null;
  } | null;
  against: { productKey: string; name: string; ratingAvg: number; myRating: number }[];
  unrated: { productKey: string; name: string; brandName: string; count: number }[];
}

export interface Position {
  lat: number;
  lng: number;
}

type Raw = Record<string, unknown>;

async function getJson(path: string, signal?: AbortSignal): Promise<Raw | null> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || signal?.aborted) return null;
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;
  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await classifyQueueHttpFailure(401, session, { source: 'beers_request', endpoint: path.split('?')[0] });
      return null;
    }
    if (!resp.ok) return null;
    const data: unknown = await resp.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Raw) : null;
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}

function query(params: Record<string, string | number | null | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
}

/** Three decimals (~100 m) is enough for "nearest pub" and keeps the exact spot on the phone. */
function rounded(position: Position | null | undefined): { lat?: number; lng?: number } {
  if (!position) return {};
  return { lat: Math.round(position.lat * 1000) / 1000, lng: Math.round(position.lng * 1000) / 1000 };
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const count = (value: unknown): number => num(value) ?? 0;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function styles(value: unknown): BeerStyle[] {
  return Array.isArray(value) ? value.filter((s): s is BeerStyle => (BEER_STYLES as readonly string[]).includes(s)) : [];
}

function stars(value: unknown): number[] {
  const list = Array.isArray(value) ? value.map((v) => num(v) ?? 0) : [];
  return list.length === 5 ? list : [0, 0, 0, 0, 0];
}

function rankedBeer(raw: Raw, fallbackPosition: number): RankedBeer | null {
  if (typeof raw.product_key !== 'string' || typeof raw.name !== 'string') return null;
  return {
    productKey: raw.product_key,
    name: raw.name,
    brandName: str(raw.brand_name),
    styles: styles(raw.styles),
    degree: degree(raw.degree),
    ratingAvg: num(raw.rating_avg),
    ratingCount: count(raw.rating_count),
    rank: num(raw.rank),
    position: num(raw.position) ?? fallbackPosition,
    move: num(raw.move),
    stars: stars(raw.stars),
    topTag: parseBeerTags([raw.top_tag])[0] ?? null,
    drunkTotal: count(raw.drunk_total),
  };
}

function list<T>(value: unknown, parse: (raw: Raw, index: number) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw, index) => (raw && typeof raw === 'object' ? parse(raw as Raw, index) : null))
    .filter((item): item is T => item !== null);
}

export async function fetchBeerRanking(
  options: { order: RankingOrder; style?: BeerStyle | null; degree?: BeerDegree | null; region?: CzRegion | null; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<BeerRankingPage | null> {
  const qs = query({ order: options.order, style: options.style, degree: options.degree, region: options.region, cursor: options.cursor, limit: options.limit ?? 50 });
  const data = await getJson(`/v1/beers/ranking?${qs}`, signal);
  if (!data) return null;
  return {
    early: data.early === true,
    items: list(data.items, (raw, index) => rankedBeer(raw, index + 1)),
    nextCursor: typeof data.next_cursor === 'string' ? data.next_cursor : null,
  };
}

export async function searchBeers(q: string, signal?: AbortSignal): Promise<BeerSearchItem[] | null> {
  const data = await getJson(`/v1/beers/search?${query({ q: q.trim() })}`, signal);
  if (!data) return null;
  return list(data.items, (raw) =>
    typeof raw.product_key === 'string' && typeof raw.name === 'string'
      ? {
          productKey: raw.product_key,
          name: raw.name,
          brandName: str(raw.brand_name),
          styles: styles(raw.styles),
          ratingAvg: num(raw.rating_avg),
          ratingCount: count(raw.rating_count),
        }
      : null,
  );
}

export type BeerRef = { productKey?: string | null; beerName?: string | null; breweryName?: string | null };

function refQuery(ref: BeerRef) {
  return ref.productKey ? { product: ref.productKey } : { beer_name: ref.beerName, brewery_name: ref.breweryName };
}

export async function fetchBeerPage(
  ref: BeerRef,
  position: Position | null,
  signal?: AbortSignal,
): Promise<BeerPage | null> {
  const data = await getJson(`/v1/beers/detail?${query({ ...refQuery(ref), ...rounded(position) })}`, signal);
  if (!data) return null;
  const detail = parseBeerDetail(data, ref.beerName ?? '', ref.breweryName ?? '');
  const nearest = data.nearest_pub as Raw | null;
  const shares = data.tag_shares && typeof data.tag_shares === 'object' ? (data.tag_shares as Raw) : {};
  return {
    ...detail,
    productKey: typeof data.product_key === 'string' ? data.product_key : null,
    brandName: str(data.brand_name) || detail.breweryName,
    styles: styles(data.styles),
    globalRating: num(data.global_rating),
    globalRatingCount: count(data.global_rating_count),
    nationalRank: num(data.national_rank),
    ratingStars: stars(data.rating_stars),
    tagShares: parseBeerTags(Object.keys(shares)).map((tag) => ({ tag, percent: count(shares[tag]) })),
    drunkTotal: count(data.drunk_total),
    drinkers: count(data.drinkers),
    drunkWeek: count(data.drunk_week),
    pubsPouring: count(data.pubs_pouring),
    nearestPub:
      nearest && typeof nearest.name === 'string' && num(nearest.distance_m) !== null
        ? {
            cacheKey: str(nearest.cache_key),
            name: nearest.name,
            lat: count(nearest.lat),
            lng: count(nearest.lng),
            distanceM: count(nearest.distance_m),
            priceCzk: num(nearest.price_czk),
          }
        : null,
    photoCount: num(data.photo_count),
    styleSettled: data.style_settled === true,
    myStyle: STYLE_ANSWERS.includes(data.my_style as StyleAnswer) ? (data.my_style as StyleAnswer) : null,
    degree: degree(data.degree),
    myDegree: degree(data.my_degree),
  };
}

const STYLE_ANSWERS: readonly StyleAnswer[] = [...BEER_STYLES, 'other', 'unknown'];

/** Sends my answer about the beer's kind and/or degrees; false when it did not reach the server. */
export async function submitBeerStyle(ref: BeerRef, answer: { style?: StyleAnswer; degree?: BeerDegree }): Promise<boolean> {
  const endpoint = getBackendEndpoint('/v1/beers/style');
  if (!endpoint) return false;
  const session = await ensureAccount();
  if (!session) return false;
  const abort = chainAbortSignal(undefined, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...refQuery(ref), ...answer }),
      signal: abort.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    abort.cleanup();
  }
}

export async function fetchBeerReviews(
  ref: BeerRef,
  options: { filter: ReviewFilter; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<BeerReviewsPage | null> {
  const qs = query({ ...refQuery(ref), filter: options.filter, cursor: options.cursor, limit: options.limit ?? 10 });
  const data = await getJson(`/v1/beers/reviews?${qs}`, signal);
  if (!data) return null;
  return {
    total: count(data.total),
    nextCursor: typeof data.next_cursor === 'string' ? data.next_cursor : null,
    items: list(data.items, (raw) => {
      const author = (raw.author ?? {}) as Raw;
      if (typeof raw.id !== 'string' || typeof author.id !== 'string') return null;
      const nickname = str(author.nickname);
      return {
        id: raw.id,
        authorId: author.id,
        authorName: nickname ? `@${nickname}` : str(author.display_name),
        inParty: raw.in_party === true,
        rating: num(raw.rating),
        note: str(raw.note),
        pubName: str(raw.pub_name),
        day: str(raw.day),
        cheers: count(raw.cheers),
        cheered: raw.my_reaction === 'cheers',
        photoUrl: typeof raw.photo_url === 'string' ? raw.photo_url : null,
      };
    }),
  };
}

export async function fetchBeerCollection(position: Position | null, signal?: AbortSignal): Promise<BeerCollection | null> {
  const data = await getJson(`/v1/beers/collection?${query(rounded(position))}`, signal);
  if (!data) return null;
  const taster = data.taster as Raw | null;
  const missing = taster?.missing as Raw | null | undefined;
  return {
    distinctBeers: count(data.distinct_beers),
    drunkTotal: count(data.drunk_total),
    breweries: count(data.breweries),
    taster:
      taster && typeof taster === 'object'
        ? {
            level: count(taster.level),
            tier: count(taster.tier),
            target: count(taster.target),
            have: count(taster.have),
            missing:
              missing && typeof missing.product_key === 'string'
                ? { productKey: missing.product_key, name: str(missing.name), nearestDistanceM: num(missing.nearest_distance_m) }
                : null,
          }
        : null,
    against: list(data.against, (raw) =>
      typeof raw.product_key === 'string'
        ? { productKey: raw.product_key, name: str(raw.name), ratingAvg: count(raw.rating_avg), myRating: count(raw.my_rating) }
        : null,
    ),
    unrated: list(data.unrated, (raw) =>
      typeof raw.product_key === 'string'
        ? { productKey: raw.product_key, name: str(raw.name), brandName: str(raw.brand_name), count: count(raw.count) }
        : null,
    ),
  };
}

export async function reportBeerReview(review: Pick<BeerReview, 'id' | 'authorId'>): Promise<boolean> {
  const result = await reportProfileContent({ targetAccountId: review.authorId, reason: 'other', checkinId: review.id });
  return result.ok;
}
