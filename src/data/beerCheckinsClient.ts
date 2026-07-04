import { ensureAccount, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure, type QueueSyncResult } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import type { FriendActionError, FriendActionResult, FriendProfile } from './friendsClient';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;

export type BeerCheckInVisibility = 'private' | 'friends';
export type BeerCheckInReactionKind = 'cheers';

/**
 * Fixed, shared contract with the backend: stable English snake_case identifiers.
 * Czech labels live in cs.ts only. Order is the tie-breaker for "top tags" and
 * for rendering, so keep it stable. A newer server may send tags we don't know
 * yet; the parser drops those so old clients keep working (forward compat).
 */
export const BEER_TAGS = [
  'crisp',
  'great_foam',
  'smooth',
  'watery',
  'stale',
  'overpriced',
  'one_more',
  'never_again',
] as const;

export type BeerTag = (typeof BEER_TAGS)[number];

/** Max tags a single check-in may carry (server enforces the same cap). */
export const MAX_BEER_TAGS = 3;

const BEER_TAG_SET: ReadonlySet<string> = new Set(BEER_TAGS);

export function isBeerTag(value: unknown): value is BeerTag {
  return typeof value === 'string' && BEER_TAG_SET.has(value);
}

/**
 * Whitelist + de-dupe an arbitrary wire value into known tags, preserving the
 * incoming order. Unknown values are dropped (never throws). Does not truncate —
 * callers that need the ≤3 contract slice explicitly.
 */
export function parseBeerTags(value: unknown): BeerTag[] {
  if (!Array.isArray(value)) return [];
  const out: BeerTag[] = [];
  for (const item of value) {
    if (isBeerTag(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Parse a `{tag: count}` wire object into known-tag counts (drops junk). */
export function parseBeerTagCounts(value: unknown): Partial<Record<BeerTag, number>> {
  const out: Partial<Record<BeerTag, number>> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!isBeerTag(key)) continue;
      const count = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
      if (Number.isFinite(count) && count > 0) out[key] = count;
    }
  }
  return out;
}

export interface BeerCheckInInput {
  clientId: string;
  beerName: string;
  breweryName?: string;
  beerStyle?: string;
  abv?: number | null;
  quantity?: number;
  priceCzk?: number | null;
  rating?: number | null;
  note?: string;
  tags?: BeerTag[];
  pubCacheKey?: string;
  pubName?: string;
  pubCity?: string;
  visitClientId?: string | null;
  visibility: BeerCheckInVisibility;
  checkedInAt?: string;
  endedAt?: string | null;
}

export interface BeerCheckIn {
  id: string;
  account: FriendProfile;
  clientId: string;
  beerName: string;
  breweryName: string;
  beerStyle: string;
  abv: number | null;
  quantity: number;
  priceCzk: number | null;
  rating: number | null;
  note: string;
  tags: BeerTag[];
  pubCacheKey: string;
  pubName: string;
  pubCity: string;
  visitClientId: string | null;
  visibility: BeerCheckInVisibility;
  checkedInAt: string;
  endedAt: string | null;
  reactions: { cheers: number };
  myReaction: BeerCheckInReactionKind | null;
  createdAt: string;
  updatedAt: string;
}

export interface BeerDetail {
  beerName: string;
  breweryName: string;
  /** ISO datetime of my first check-in of this beer; null when unseen or on an older backend. */
  firstCheckedInAt: string | null;
  myCount: number;
  partyCount: number;
  myAverageRating: number | null;
  partyAverageRating: number | null;
  partyDrinkers: FriendProfile[];
  recentCheckins: BeerCheckIn[];
  myHistory: BeerCheckIn[];
  myTags: Partial<Record<BeerTag, number>>;
}

/**
 * Lightweight personal-memory lookup for the check-in sheet strip. All fields
 * describe ONLY the caller's own history with this beer; `myCount === 0` means
 * an unseen beer (all aggregates empty).
 */
export interface BeerMemory {
  beerName: string;
  breweryName: string;
  myCount: number;
  firstCheckedInAt: string | null;
  lastCheckedInAt: string | null;
  lastPubName: string;
  lastRating: number | null;
  myAverageRating: number | null;
  topTags: BeerTag[];
}

interface RequestOk {
  ok: true;
  data: Record<string, unknown>;
}

type RequestResult = RequestOk | { ok: false; result: FriendActionError };

interface RawProfile {
  id?: string;
  nickname?: string | null;
  display_name?: string;
  avatar_url?: string | null;
  is_public?: boolean;
}

interface RawCheckIn {
  id?: string;
  account?: RawProfile;
  client_id?: string;
  beer_name?: string;
  brewery_name?: string;
  beer_style?: string;
  abv?: string | number | null;
  quantity?: number | string | null;
  price_czk?: number | string | null;
  rating?: string | number | null;
  note?: string;
  tags?: unknown;
  pub_cache_key?: string;
  pub_name?: string;
  pub_city?: string;
  visit_client_id?: string | null;
  visibility?: string;
  checked_in_at?: string;
  ended_at?: string | null;
  reactions?: { cheers?: number };
  my_reaction?: string | null;
  created_at?: string;
  updated_at?: string;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseProfile(raw?: RawProfile): FriendProfile {
  return {
    id: raw?.id ?? '',
    nickname: typeof raw?.nickname === 'string' ? raw.nickname : null,
    displayName: raw?.display_name ?? raw?.nickname ?? 'Kamarád',
    avatarUrl: raw?.avatar_url ?? null,
    isPublic: raw?.is_public !== false,
  };
}

function parseVisibility(value: unknown): BeerCheckInVisibility {
  return value === 'friends' ? 'friends' : 'private';
}

export function parseBeerCheckIn(raw: RawCheckIn): BeerCheckIn {
  return {
    id: raw.id ?? '',
    account: parseProfile(raw.account),
    clientId: raw.client_id ?? '',
    beerName: raw.beer_name ?? '',
    breweryName: raw.brewery_name ?? '',
    beerStyle: raw.beer_style ?? '',
    abv: parseNumber(raw.abv),
    quantity: Math.max(1, Math.floor(parseNumber(raw.quantity) ?? 1)),
    priceCzk: parseNumber(raw.price_czk),
    rating: parseNumber(raw.rating),
    note: raw.note ?? '',
    tags: parseBeerTags(raw.tags),
    pubCacheKey: raw.pub_cache_key ?? '',
    pubName: raw.pub_name ?? '',
    pubCity: raw.pub_city ?? '',
    visitClientId: raw.visit_client_id ?? null,
    visibility: parseVisibility(raw.visibility),
    checkedInAt: raw.checked_in_at ?? '',
    endedAt: raw.ended_at ?? null,
    reactions: { cheers: raw.reactions?.cheers ?? 0 },
    myReaction: raw.my_reaction === 'cheers' ? 'cheers' : null,
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? '',
  };
}

function extractError(data: Record<string, unknown>, status: number): FriendActionError {
  const detail = typeof data.detail === 'string' ? data.detail : 'Nepodařilo se to uložit. Zkus to znovu.';
  const code = typeof data.code === 'string' ? data.code : `http_${status}`;
  return { ok: false, code, detail };
}

async function handleUnauthorized(session: AccountSession): Promise<void> {
  await classifyQueueHttpFailure(401, session);
}

async function requestJson(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<RequestResult> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'offline', detail: 'Server teď není dostupný.' } };
  }

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'account', detail: 'Účet teď není připravený.' } };
  }

  const abort = chainAbortSignal(options.signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: abort.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      const text = await resp.text();
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (resp.status === 401) {
      await handleUnauthorized(session);
      return { ok: false, result: { ok: false, code: 'auth', detail: 'Přihlášení vypršelo.' } };
    }
    if (!resp.ok) return { ok: false, result: extractError(data, resp.status) };
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('beer_checkins_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { ok: false, result: { ok: false, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' } };
  } finally {
    abort.cleanup();
  }
}

export function beerCheckInWire(input: BeerCheckInInput): Record<string, unknown> {
  return {
    client_id: input.clientId,
    beer_name: input.beerName,
    brewery_name: input.breweryName ?? '',
    beer_style: input.beerStyle ?? '',
    abv: input.abv ?? null,
    quantity: input.quantity ?? 1,
    price_czk: input.priceCzk ?? null,
    rating: input.rating ?? null,
    note: input.note ?? '',
    // Whitelist + cap here too so a queued payload never ships junk or >3 tags.
    tags: parseBeerTags(input.tags).slice(0, MAX_BEER_TAGS),
    pub_cache_key: input.pubCacheKey ?? '',
    pub_name: input.pubName ?? '',
    pub_city: input.pubCity ?? '',
    visit_client_id: input.visitClientId ?? null,
    visibility: input.visibility,
    checked_in_at: input.checkedInAt ?? new Date().toISOString(),
    ended_at: input.endedAt ?? null,
  };
}

export async function submitBeerCheckIn(input: BeerCheckInInput): Promise<QueueSyncResult> {
  const res = await requestJson('/v1/beer-checkins', {
    method: 'POST',
    body: beerCheckInWire(input),
  });
  if (res.ok) return 'ok';
  if (res.result.code === 'offline' || res.result.code === 'account' || res.result.code === 'network' || res.result.code === 'auth') {
    return 'retry';
  }
  const httpMatch = /^http_(\d{3})$/.exec(res.result.code);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 401 || status === 429 || status >= 500) return 'retry';
  }
  return 'permanent-error';
}

export async function createBeerCheckIn(input: BeerCheckInInput): Promise<BeerCheckIn | null> {
  const res = await requestJson('/v1/beer-checkins', {
    method: 'POST',
    body: beerCheckInWire(input),
  });
  return res.ok ? parseBeerCheckIn(res.data as RawCheckIn) : null;
}

export async function fetchMyBeerCheckIns(signal?: AbortSignal): Promise<BeerCheckIn[] | null> {
  const res = await requestJson('/v1/beer-checkins', { signal });
  if (!res.ok) return null;
  return Array.isArray(res.data.checkins)
    ? (res.data.checkins as RawCheckIn[]).map(parseBeerCheckIn)
    : [];
}

export async function fetchBeerCheckInFeed(signal?: AbortSignal): Promise<BeerCheckIn[] | null> {
  const res = await requestJson('/v1/beer-checkins/feed', { signal });
  if (!res.ok) return null;
  return Array.isArray(res.data.checkins)
    ? (res.data.checkins as RawCheckIn[]).map(parseBeerCheckIn)
    : [];
}

export async function reactToBeerCheckIn(
  checkInId: string,
  reaction: BeerCheckInReactionKind = 'cheers',
): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/beer-checkins/${encodeURIComponent(checkInId)}/react`, {
    method: 'POST',
    body: { reaction },
  });
  return res.ok ? { ok: true } : res.result;
}

export async function clearBeerCheckInReaction(checkInId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/beer-checkins/${encodeURIComponent(checkInId)}/react`, {
    method: 'DELETE',
  });
  return res.ok ? { ok: true } : res.result;
}

export async function fetchBeerDetail(
  beerName: string,
  breweryName?: string,
  signal?: AbortSignal,
): Promise<BeerDetail | null> {
  const qs = `beer_name=${encodeURIComponent(beerName)}&brewery_name=${encodeURIComponent(breweryName ?? '')}`;
  const res = await requestJson(`/v1/beers/detail?${qs}`, { signal });
  if (!res.ok) return null;
  return {
    beerName: typeof res.data.beer_name === 'string' ? res.data.beer_name : beerName,
    breweryName: typeof res.data.brewery_name === 'string' ? res.data.brewery_name : breweryName ?? '',
    firstCheckedInAt:
      typeof res.data.first_checked_in_at === 'string' ? res.data.first_checked_in_at : null,
    myCount: typeof res.data.my_count === 'number' ? res.data.my_count : 0,
    partyCount: typeof res.data.party_count === 'number' ? res.data.party_count : 0,
    myAverageRating: parseNumber(res.data.my_average_rating),
    partyAverageRating: parseNumber(res.data.party_average_rating),
    partyDrinkers: Array.isArray(res.data.party_drinkers)
      ? (res.data.party_drinkers as RawProfile[]).map(parseProfile)
      : [],
    recentCheckins: Array.isArray(res.data.recent_checkins)
      ? (res.data.recent_checkins as RawCheckIn[]).map(parseBeerCheckIn)
      : [],
    myHistory: Array.isArray(res.data.my_history)
      ? (res.data.my_history as RawCheckIn[]).map(parseBeerCheckIn)
      : [],
    myTags: parseBeerTagCounts(res.data.my_tags),
  };
}

/**
 * Personal-memory lookup for the check-in sheet. Never throws: any failure
 * (offline, dormant endpoint, HTTP error, malformed body) resolves to null so
 * the caller silently collapses the memory strip. An empty beer name skips the
 * request entirely.
 */
export async function fetchBeerMemory(
  beerName: string,
  breweryName?: string,
  signal?: AbortSignal,
): Promise<BeerMemory | null> {
  const clean = beerName.trim();
  if (!clean) return null;
  const qs = `beer_name=${encodeURIComponent(clean)}&brewery_name=${encodeURIComponent(breweryName?.trim() ?? '')}`;
  const res = await requestJson(`/v1/beers/memory?${qs}`, { signal });
  if (!res.ok) return null;
  const d = res.data;
  return {
    beerName: typeof d.beer_name === 'string' ? d.beer_name : clean,
    breweryName: typeof d.brewery_name === 'string' ? d.brewery_name : breweryName?.trim() ?? '',
    myCount: typeof d.my_count === 'number' && Number.isFinite(d.my_count) ? d.my_count : 0,
    firstCheckedInAt: typeof d.first_checked_in_at === 'string' ? d.first_checked_in_at : null,
    lastCheckedInAt: typeof d.last_checked_in_at === 'string' ? d.last_checked_in_at : null,
    lastPubName: typeof d.last_pub_name === 'string' ? d.last_pub_name : '',
    lastRating: parseNumber(d.last_rating),
    myAverageRating: parseNumber(d.my_average_rating),
    topTags: parseBeerTags(d.top_tags).slice(0, MAX_BEER_TAGS),
  };
}
