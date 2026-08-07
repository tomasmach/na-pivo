import { ensureAccount, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;
const FEED_PAGE_SIZE = 20;

export type NightVisibility = 'friends' | 'public';
export type NightsFeedScope = 'friends' | 'global' | 'mine';

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
}

interface RequestOk {
  ok: true;
  data: Record<string, unknown>;
}

type RequestResult = RequestOk | { ok: false; result: NightActionError };
const feedChangeListeners = new Set<() => void>();

function notifyFeedChanged(): void {
  feedChangeListeners.forEach((listener) => listener());
}

export function subscribeNightsFeedChanges(listener: () => void): () => void {
  feedChangeListeners.add(listener);
  return () => feedChangeListeners.delete(listener);
}

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
          : nickname ?? 'Kamarád',
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
    visibility: payload.visibility,
    updated_at: payload.updatedAt,
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
  return { ok: false, code: `http_${status}`, detail: 'Nepodařilo se to uložit. Zkus to znovu.' };
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
      await handleUnauthorized(session, endpoint);
      return { ok: false, result: { ok: false, code: 'auth', detail: 'Přihlášení vypršelo.' } };
    }
    if (!resp.ok) return { ok: false, result: extractError(data, resp.status) };
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('nights_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { ok: false, result: { ok: false, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' } };
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
  const result: NightPublishResult = res.ok
    ? { ok: true, night: parsePublishedNight(rawObject(res.data.night)) }
    : res.result;
  if (result.ok) notifyFeedChanged();
  return result;
}

export async function unpublishNight(clientId: string): Promise<NightActionResult> {
  const res = await requestJson(`/v1/nights/${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
  });
  const result: NightActionResult = res.ok ? { ok: true } : res.result;
  if (result.ok) notifyFeedChanged();
  return result;
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
