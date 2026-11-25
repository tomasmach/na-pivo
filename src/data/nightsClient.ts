import { ensureAccount, type AccountSession } from './account';
import { t } from '@/i18n';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { resolveBeerPhotoUrl } from './beerPhotosClient';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;
const FEED_PAGE_SIZE = 20;

export type NightVisibility = 'friends' | 'public';
export type NightsFeedScope = 'friends' | 'global';

export interface PublishedNight {
  id: string;
  clientId?: string;
  author: {
    id: string;
    nickname: string | null;
    displayName: string;
    avatarUrl: string | null;
    isPublic: boolean;
  };
  drinkingDay: string;
  startedAt: string;
  endedAt: string;
  beerCount: number;
  wineCount: number;
  softDrinkCount: number;
  shotCount: number;
  pubNames: string[];
  city: string;
  durationMinutes: number | null;
  visibility: NightVisibility;
  createdAt: string;
  rounds: number;
  myRound: boolean;
  isMine: boolean;
  /** First photo the author attached to the night, when the viewer may see it. */
  heroPhotoUrl: string | null;
}

export interface NightPublishPayload {
  clientId: string;
  drinkingDay: string;
  startedAt: string;
  endedAt: string;
  beerCount: number;
  wineCount: number;
  softDrinkCount: number;
  shotCount: number;
  pubNames: string[];
  city?: string;
  durationMinutes?: number;
  visibility: NightVisibility;
  updatedAt: string;
  /** Diary photo ids (server or client id) shown on the night; additive. */
  photoIds?: string[];
}

export interface NightActionError {
  ok: false;
  code: string;
  detail: string;
}

export type NightActionResult = { ok: true } | NightActionError;
export type NightPublishResult = { ok: true; night: PublishedNight } | NightActionError;
export type NightsFeedResult =
  | { ok: true; nights: PublishedNight[]; nextCursor: string | null }
  | NightActionError;
export type NightReactionResult =
  | { ok: true; rounds: number; myRound: boolean }
  | NightActionError;

interface RawNightAuthor {
  id?: string | null;
  nickname?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  is_public?: boolean | null;
}

interface RawPublishedNight {
  id?: string | null;
  client_id?: string | null;
  author?: RawNightAuthor | null;
  drinking_day?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  beer_count?: number | string | null;
  wine_count?: number | string | null;
  soft_drink_count?: number | string | null;
  shot_count?: number | string | null;
  pub_names?: unknown;
  city?: string | null;
  duration_minutes?: number | string | null;
  visibility?: string | null;
  created_at?: string | null;
  rounds?: number | string | null;
  my_round?: boolean | null;
  is_mine?: boolean | null;
  hero_photos?: unknown;
}

function firstHeroPhotoUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const photo of value) {
    const url = resolveBeerPhotoUrl((photo as { image_url?: unknown } | null)?.image_url);
    if (url) return url;
  }
  return null;
}

interface RequestOk {
  ok: true;
  data: Record<string, unknown>;
}

type RequestResult = RequestOk | { ok: false; result: NightActionError };

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCount(value: unknown): number {
  return Math.max(0, Math.floor(parseNumber(value) ?? 0));
}

function parseVisibility(value: unknown): NightVisibility {
  return value === 'public' ? 'public' : 'friends';
}

export function parsePublishedNight(raw: RawPublishedNight): PublishedNight {
  const author = raw.author ?? undefined;
  const nickname = typeof author?.nickname === 'string' ? author.nickname : null;
  const clientId = typeof raw.client_id === 'string' ? raw.client_id : undefined;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    ...(clientId ? { clientId } : {}),
    author: {
      id: typeof author?.id === 'string' ? author.id : '',
      nickname,
      displayName:
        typeof author?.display_name === 'string'
          ? author.display_name
          : nickname ?? t.common.friendFallback,
      avatarUrl: typeof author?.avatar_url === 'string' ? author.avatar_url : null,
      isPublic: author?.is_public !== false,
    },
    drinkingDay: typeof raw.drinking_day === 'string' ? raw.drinking_day : '',
    startedAt: typeof raw.started_at === 'string' ? raw.started_at : '',
    endedAt: typeof raw.ended_at === 'string' ? raw.ended_at : '',
    beerCount: parseCount(raw.beer_count),
    wineCount: parseCount(raw.wine_count),
    softDrinkCount: parseCount(raw.soft_drink_count),
    shotCount: parseCount(raw.shot_count),
    pubNames: Array.isArray(raw.pub_names)
      ? raw.pub_names.filter((name): name is string => typeof name === 'string')
      : [],
    city: typeof raw.city === 'string' ? raw.city : '',
    durationMinutes: parseNumber(raw.duration_minutes),
    visibility: parseVisibility(raw.visibility),
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    rounds: parseCount(raw.rounds),
    myRound: raw.my_round === true,
    isMine: raw.is_mine === true,
    heroPhotoUrl: firstHeroPhotoUrl(raw.hero_photos),
  };
}

const NIGHT_PUB_NAME_MAX = 80;
const NIGHT_PUB_NAMES_MAX = 5;
const NIGHT_CITY_MAX = 120;
const NIGHT_COUNT_MAX = 65_535;

function fitNightText(value: string, max: number): string {
  const text = value.trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

function wireCount(value: number): number {
  return Math.min(NIGHT_COUNT_MAX, Math.max(0, Math.floor(value)));
}

export function nightPublishWire(payload: NightPublishPayload): Record<string, unknown> {
  const pubNames = payload.pubNames
    .map((name) => fitNightText(name, NIGHT_PUB_NAME_MAX))
    .filter(Boolean)
    .slice(0, NIGHT_PUB_NAMES_MAX);
  const duration = payload.durationMinutes;
  return {
    client_id: payload.clientId,
    drinking_day: payload.drinkingDay,
    started_at: payload.startedAt,
    ended_at: payload.endedAt,
    beer_count: wireCount(payload.beerCount),
    wine_count: wireCount(payload.wineCount),
    soft_drink_count: wireCount(payload.softDrinkCount),
    shot_count: wireCount(payload.shotCount),
    pub_names: pubNames,
    ...(payload.city !== undefined ? { city: fitNightText(payload.city, NIGHT_CITY_MAX) } : {}),
    ...(duration !== undefined && Number.isFinite(duration)
      ? { duration_minutes: Math.max(1, Math.round(duration)) }
      : {}),
    visibility: payload.visibility,
    updated_at: payload.updatedAt,
    ...(payload.photoIds ? { photo_ids: payload.photoIds } : {}),
  };
}

function extractError(data: unknown, status: number): NightActionError {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === 'string') {
      return {
        ok: false,
        code: typeof obj.code === 'string' ? obj.code : `http_${status}`,
        detail: obj.detail,
      };
    }
  }
  return { ok: false, code: `http_${status}`, detail: t.clientErrors.save };
}

async function handleUnauthorized(session: AccountSession, endpoint: string): Promise<void> {
  await classifyQueueHttpFailure(401, session, { source: 'nights_request', endpoint });
}

async function requestJson(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<RequestResult> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'offline', detail: t.clientErrors.offline } };
  }

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'account', detail: t.clientErrors.account } };
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
      await handleUnauthorized(session, endpoint);
      return { ok: false, result: { ok: false, code: 'auth', detail: t.clientErrors.auth } };
    }
    if (!resp.ok) return { ok: false, result: extractError(data, resp.status) };
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('nights_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { ok: false, result: { ok: false, code: 'network', detail: t.clientErrors.network } };
  } finally {
    abort.cleanup();
  }
}

function rawObject(value: unknown): RawPublishedNight {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawPublishedNight)
    : {};
}

export async function publishNight(payload: NightPublishPayload): Promise<NightPublishResult> {
  const res = await requestJson('/v1/nights', {
    method: 'POST',
    body: nightPublishWire(payload),
  });
  return res.ok
    ? { ok: true, night: parsePublishedNight(rawObject(res.data.night)) }
    : res.result;
}

export async function unpublishNight(clientId: string): Promise<NightActionResult> {
  const res = await requestJson(`/v1/nights/${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
  });
  return res.ok ? { ok: true } : res.result;
}

export async function fetchNightsFeed(
  scope: NightsFeedScope,
  cursor?: string,
): Promise<NightsFeedResult> {
  const query = `scope=${scope}&cursor=${encodeURIComponent(cursor ?? '')}&limit=${FEED_PAGE_SIZE}`;
  const res = await requestJson(`/v1/nights/feed?${query}`);
  if (!res.ok) return res.result;
  return {
    ok: true,
    nights: Array.isArray(res.data.nights)
      ? res.data.nights.map((night) => parsePublishedNight(rawObject(night)))
      : [],
    nextCursor: typeof res.data.next_cursor === 'string' ? res.data.next_cursor : null,
  };
}

function parseReactionResult(data: Record<string, unknown>): NightReactionResult {
  return {
    ok: true,
    rounds: parseCount(data.rounds),
    myRound: data.my_round === true,
  };
}

export async function reactToNight(nightId: string): Promise<NightReactionResult> {
  const res = await requestJson(`/v1/nights/${encodeURIComponent(nightId)}/react`, {
    method: 'POST',
  });
  return res.ok ? parseReactionResult(res.data) : res.result;
}

export async function clearNightReaction(nightId: string): Promise<NightReactionResult> {
  const res = await requestJson(`/v1/nights/${encodeURIComponent(nightId)}/react`, {
    method: 'DELETE',
  });
  return res.ok ? parseReactionResult(res.data) : res.result;
}

export function isRetriableNightError(result: NightActionError): boolean {
  const code = result.code;
  if (code === 'offline' || code === 'account' || code === 'network' || code === 'auth') {
    return true;
  }
  const httpMatch = /^http_(\d{3})$/.exec(code);
  if (!httpMatch) return false;
  const status = Number(httpMatch[1]);
  if (status === 401 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

export interface NightsSummaryLeader {
  kind: 'city' | 'account';
  name: string;
  isMe: boolean;
}

export type NightsSummaryResult =
  | { ok: true; nights: number; beers: number; leader: NightsSummaryLeader | null }
  | NightActionError;

/** GET /v1/nights/summary: the "last 7 days" aggregate of one feed scope. */
export async function fetchNightsSummary(
  scope: NightsFeedScope,
  days = 7,
): Promise<NightsSummaryResult> {
  const res = await requestJson(`/v1/nights/summary?scope=${scope}&days=${days}`);
  if (!res.ok) return res.result;
  const leader = rawObject(res.data.leader) as Record<string, unknown>;
  return {
    ok: true,
    nights: parseCount(res.data.nights),
    beers: parseCount(res.data.beers),
    leader:
      typeof leader.name === 'string' && leader.name
        ? {
            kind: leader.kind === 'account' ? 'account' : 'city',
            name: leader.name,
            isMe: leader.is_me === true,
          }
        : null,
  };
}
