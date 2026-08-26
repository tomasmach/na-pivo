import { t } from '@/i18n';

import { ensureAccount, generateUuidV4, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { notifyUgcConsentRequiredFromResponse, ugcPolicyHeaders } from './ugcConsent';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;
const FEED_PAGE_SIZE = 20;

export type NightVisibility = 'friends' | 'public';
export type NightsFeedScope = 'friends' | 'global';

export interface NightAuthor {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
  isPublic: boolean;
}

export interface PublishedNightHeroPhoto {
  id: string;
  imageUrl: string;
  caption: string;
}

export interface PublishedNightHeroGame {
  id: string;
  catalogKey: string;
  name: string;
  scoring: 'points' | 'drinks';
}

export interface PublishedNight {
  id: string;
  /** Client-only row rebuilt from the automatic Parta history. */
  historical?: boolean;
  clientId?: string;
  author: NightAuthor;
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
  title: string;
  roastLine: string;
  roastBasis: string;
  participants: NightAuthor[];
  heroPhotos: PublishedNightHeroPhoto[];
  heroGames: PublishedNightHeroGame[];
  visibility: NightVisibility;
  createdAt: string;
  rounds: number;
  myRound: boolean;
  isMine: boolean;
  commentCount: number;
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
  title?: string;
  roastLine?: string;
  roastBasis?: string;
  partyCode?: string;
  participantIds?: string[];
  photoIds?: string[];
  gameIds?: string[];
  visibility: NightVisibility;
  updatedAt: string;
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

export interface NightComment {
  id: string;
  author: NightAuthor;
  body: string;
  createdAt: string;
  isMine: boolean;
  canDelete: boolean;
}

export type NightDetailResult = { ok: true; night: PublishedNight } | NightActionError;
export type NightCommentsResult = { ok: true; comments: NightComment[] } | NightActionError;
export type NightCommentResult = { ok: true; comment: NightComment } | NightActionError;

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
  title?: string | null;
  roast_line?: string | null;
  roast_basis?: string | null;
  participants?: unknown;
  hero_photos?: unknown;
  hero_games?: unknown;
  visibility?: string | null;
  created_at?: string | null;
  rounds?: number | string | null;
  my_round?: boolean | null;
  is_mine?: boolean | null;
  comment_count?: number | string | null;
}

interface RawNightComment {
  id?: string | null;
  author?: RawNightAuthor | null;
  body?: string | null;
  created_at?: string | null;
  is_mine?: boolean | null;
  can_delete?: boolean | null;
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

function parseAuthor(raw: RawNightAuthor | undefined | null): NightAuthor {
  const nickname = typeof raw?.nickname === 'string' ? raw.nickname : null;
  return {
    id: typeof raw?.id === 'string' ? raw.id : '',
    nickname,
    displayName:
      typeof raw?.display_name === 'string' ? raw.display_name : nickname ?? t.common.friendFallback,
    avatarUrl: typeof raw?.avatar_url === 'string' ? raw.avatar_url : null,
    isPublic: raw?.is_public !== false,
  };
}

function rawAuthor(value: unknown): RawNightAuthor | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawNightAuthor)
    : null;
}

export function parsePublishedNight(raw: RawPublishedNight): PublishedNight {
  const clientId = typeof raw.client_id === 'string' ? raw.client_id : undefined;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    ...(clientId ? { clientId } : {}),
    author: parseAuthor(raw.author),
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
    title: typeof raw.title === 'string' ? raw.title : '',
    roastLine: typeof raw.roast_line === 'string' ? raw.roast_line : '',
    roastBasis: typeof raw.roast_basis === 'string' ? raw.roast_basis : '',
    participants: Array.isArray(raw.participants)
      ? raw.participants.map(rawAuthor).filter((value): value is RawNightAuthor => value !== null).map(parseAuthor)
      : [],
    heroPhotos: Array.isArray(raw.hero_photos)
      ? raw.hero_photos.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const row = value as Record<string, unknown>;
          return typeof row.id === 'string' && typeof row.image_url === 'string'
            ? [{
                id: row.id,
                imageUrl: row.image_url,
                caption: typeof row.caption === 'string' ? row.caption : '',
              }]
            : [];
        })
      : [],
    heroGames: Array.isArray(raw.hero_games)
      ? raw.hero_games.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const row = value as Record<string, unknown>;
          return typeof row.id === 'string' &&
            typeof row.catalog_key === 'string' &&
            typeof row.name === 'string'
            ? [{
                id: row.id,
                catalogKey: row.catalog_key,
                name: row.name,
                scoring: row.scoring === 'drinks' ? 'drinks' as const : 'points' as const,
              }]
            : [];
        })
      : [],
    visibility: parseVisibility(raw.visibility),
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    rounds: parseCount(raw.rounds),
    myRound: raw.my_round === true,
    isMine: raw.is_mine === true,
    commentCount: parseCount(raw.comment_count),
  };
}

export function nightPublishWire(payload: NightPublishPayload): Record<string, unknown> {
  return {
    client_id: payload.clientId,
    drinking_day: payload.drinkingDay,
    started_at: payload.startedAt,
    ended_at: payload.endedAt,
    beer_count: payload.beerCount,
    wine_count: payload.wineCount,
    soft_drink_count: payload.softDrinkCount,
    shot_count: payload.shotCount,
    pub_names: payload.pubNames,
    ...(payload.city !== undefined ? { city: payload.city } : {}),
    ...(payload.durationMinutes !== undefined
      ? { duration_minutes: payload.durationMinutes }
      : {}),
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.roastLine !== undefined ? { roast_line: payload.roastLine } : {}),
    ...(payload.roastBasis !== undefined ? { roast_basis: payload.roastBasis } : {}),
    ...(payload.partyCode !== undefined ? { party_code: payload.partyCode } : {}),
    ...(payload.participantIds !== undefined
      ? { participant_ids: payload.participantIds }
      : {}),
    ...(payload.photoIds !== undefined ? { photo_ids: payload.photoIds } : {}),
    ...(payload.gameIds !== undefined ? { game_ids: payload.gameIds } : {}),
    visibility: payload.visibility,
    updated_at: payload.updatedAt,
  };
}

/**
 * The first sentence the server actually said.
 *
 * DRF answers a rejected publish with `{"non_field_errors": ["…"]}` rather than
 * `detail`, so reading only `detail` turned "A published night must contain at
 * least one drink" into "Nepodařilo se to uložit. Zkus to znovu." and the user
 * retried forever.
 */
function firstSerializerError(obj: Record<string, unknown>): string | null {
  const fields = ['non_field_errors', ...Object.keys(obj)];
  for (const field of fields) {
    if (field === 'code' || field === 'detail') continue;
    const value = obj[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim());
      if (typeof first === 'string') return first.trim();
    }
  }
  return null;
}

function extractError(data: unknown, status: number): NightActionError {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const code = typeof obj.code === 'string' ? obj.code : `http_${status}`;
    if (typeof obj.detail === 'string' && obj.detail.trim()) {
      return { ok: false, code, detail: obj.detail };
    }
    const serializerError = firstSerializerError(obj);
    if (serializerError) return { ok: false, code, detail: serializerError };
  }
  return { ok: false, code: `http_${status}`, detail: t.clientErrors.save };
}

async function handleUnauthorized(session: AccountSession, endpoint: string): Promise<void> {
  await classifyQueueHttpFailure(401, session, { source: 'nights_request', endpoint });
}

async function requestJson(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    gatedUgc?: boolean;
  } = {},
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
        ...(options.gatedUgc ? ugcPolicyHeaders(session.accountId) : {}),
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
    if (options.gatedUgc) notifyUgcConsentRequiredFromResponse(resp.status, data);
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

function parseNightComment(value: unknown): NightComment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as RawNightComment;
  if (typeof raw.id !== 'string' || typeof raw.body !== 'string') return null;
  return {
    id: raw.id,
    author: parseAuthor(raw.author),
    body: raw.body,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    isMine: raw.is_mine === true,
    canDelete: raw.can_delete === true,
  };
}

export async function publishNight(payload: NightPublishPayload): Promise<NightPublishResult> {
  const res = await requestJson('/v1/nights', {
    method: 'POST',
    body: nightPublishWire(payload),
    gatedUgc: true,
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

/** Friends-visible published nights that explicitly named one pub. */
export async function fetchPubNightsFeed(
  pubName: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<NightsFeedResult> {
  const query =
    `scope=friends&pub=${encodeURIComponent(pubName)}` +
    `&cursor=${encodeURIComponent(cursor ?? '')}&limit=${FEED_PAGE_SIZE}`;
  const res = await requestJson(`/v1/nights/feed?${query}`, { signal });
  if (!res.ok) return res.result;
  return {
    ok: true,
    nights: Array.isArray(res.data.nights)
      ? res.data.nights.map((night) => parsePublishedNight(rawObject(night)))
      : [],
    nextCursor: typeof res.data.next_cursor === 'string' ? res.data.next_cursor : null,
  };
}

export async function fetchNightDetail(
  nightId: string,
  signal?: AbortSignal,
): Promise<NightDetailResult> {
  const res = await requestJson(
    `/v1/nights/${encodeURIComponent(nightId)}/detail`,
    { signal },
  );
  return res.ok
    ? { ok: true, night: parsePublishedNight(rawObject(res.data.night)) }
    : res.result;
}

export async function fetchNightComments(
  nightId: string,
  signal?: AbortSignal,
): Promise<NightCommentsResult> {
  const res = await requestJson(
    `/v1/nights/${encodeURIComponent(nightId)}/comments`,
    { signal },
  );
  return res.ok
    ? {
        ok: true,
        comments: Array.isArray(res.data.comments)
          ? res.data.comments.flatMap((value) => {
              const comment = parseNightComment(value);
              return comment ? [comment] : [];
            })
          : [],
      }
    : res.result;
}

export async function createNightComment(
  nightId: string,
  body: string,
  clientId = generateUuidV4(),
): Promise<NightCommentResult> {
  const res = await requestJson(
    `/v1/nights/${encodeURIComponent(nightId)}/comments`,
    { method: 'POST', body: { client_id: clientId, body }, gatedUgc: true },
  );
  if (!res.ok) return res.result;
  const comment = parseNightComment(res.data.comment);
  return comment
    ? { ok: true, comment }
    : { ok: false, code: 'invalid_response', detail: t.clientErrors.commentIncomplete };
}

export async function deleteNightComment(
  nightId: string,
  commentId: string,
): Promise<NightActionResult> {
  const res = await requestJson(
    `/v1/nights/${encodeURIComponent(nightId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' },
  );
  return res.ok ? { ok: true } : res.result;
}

export async function fetchMyNights(cursor?: string): Promise<NightsFeedResult> {
  const query = `scope=global&mine=true&cursor=${encodeURIComponent(cursor ?? '')}&limit=${FEED_PAGE_SIZE}`;
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

export async function fetchProfileNights(
  accountId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<NightsFeedResult> {
  // The dedicated server parameter always applies public-post visibility,
  // independent of friendship or any future default-scope changes.
  const query = `public_author=${encodeURIComponent(accountId)}&cursor=${encodeURIComponent(cursor ?? '')}&limit=${FEED_PAGE_SIZE}`;
  const res = await requestJson(`/v1/nights/feed?${query}`, { signal });
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
  if (code === 'ugc_consent_required' || code === 'ugc_policy_update_required') return true;
  const httpMatch = /^http_(\d{3})$/.exec(code);
  if (!httpMatch) return false;
  const status = Number(httpMatch[1]);
  if (status === 401 || status === 428 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}
