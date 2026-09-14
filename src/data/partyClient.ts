/**
 * Party evening — the explicit shared table.
 *
 * One person starts an evening and reads a six-character code across the table;
 * everybody else joins it. From then on there is a `code`, and everything that
 * is shared during the night hangs off it — members, games, the quiz.
 *
 *   GET    /v1/party-evenings                 the one I am in, if any
 *   GET    /v1/party-evenings/history         recent ended tables I joined
 *   GET    /v1/party-evenings/<code>          that one again, members and all
 *   POST   /v1/party-evenings                 start one, idempotent by client_id
 *   POST   /v1/party-evenings/<code>/join     get in
 *   DELETE /v1/party-evenings/<code>/join     get out
 *   POST   /v1/party-evenings/<code>/end      close it (host only)
 *
 * The detail endpoint is members-only on the server, so a code you are not in
 * is a 404 — guessing six characters does not read somebody else's table.
 *
 * This existed once and was deleted in July 2026, for a reason worth keeping in
 * view: the old version made you log every beer TWICE — once into the diary that
 * counts, and once into a shared table that counted nothing. What comes back is
 * the evening, not the second diary. A beer is written where it always was; the
 * evening is a lens over it, and `POST /v1/drinks` carries the `party_code`.
 *
 * Not restored: `sharePartyEveningDrink`. That WAS the second diary.
 *
 * Everything here is best-effort and never throws — the whole point of an
 * evening is that it survives a pub's signal.
 */

import { t } from '@/i18n';

import { ensureAccount, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';
import { normalizeDrinkType } from '@/drinks/drinkTypes';
import { ME_TINT, tintFor } from '@/party/nightBuilder';
import type { NightGame, NightRecord } from '@/party/nightRecord';

// Re-exported: the evening's code is part of this contract, and callers should
// not have to know it is generated one module over.
export { generateJoinCode } from './joinCode';

const REQUEST_TIMEOUT_MS = 9000;

export interface PartyProfile {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export type PartyEveningEventKind = 'joined' | 'left' | 'drink';

export interface PartyEveningEvent {
  id: string;
  kind: PartyEveningEventKind;
  at: string;
  account: PartyProfile;
  beerName: string;
  quantity: number;
}

export interface PartyEvening {
  id: string;
  joinCode: string;
  joinUrl: string;
  host: PartyProfile;
  pubName: string;
  pubCity: string;
  active: boolean;
  startedAt: string;
  endedAt: string | null;
  isHost: boolean;
  members: PartyProfile[];
  events: PartyEveningEvent[];
}

export interface PartyEveningHistoryItem {
  id: string;
  joinCode: string;
  pubName: string;
  pubCity: string;
  startedAt: string;
  endedAt: string;
  isHost: boolean;
}

export interface PartyError {
  ok: false;
  code: string;
  detail: string;
}

export type PartyEveningResult = { ok: true; evening: PartyEvening | null } | PartyError;
export type PartyEveningHistoryResult =
  { ok: true; evenings: PartyEveningHistoryItem[]; truncated: boolean } | PartyError;
export type PartyActionResult = { ok: true } | PartyError;
export type PartyNightRecordResult = { ok: true; record: NightRecord } | PartyError;

export function isRetriablePartyError(error: PartyError): boolean {
  return (
    error.code === 'offline' ||
    error.code === 'network' ||
    error.code === 'account' ||
    error.code === 'auth' ||
    /^http_(408|425|429|5\d\d)$/.test(error.code)
  );
}

function raw(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function parsePartyProfile(value: unknown): PartyProfile {
  const data = raw(value);
  const nickname = typeof data.nickname === 'string' ? data.nickname : null;
  return {
    id: str(data.id),
    nickname,
    displayName: str(data.display_name, nickname ?? t.common.friendFallback),
    avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
  };
}

function parseEvent(value: unknown): PartyEveningEvent | null {
  const data = raw(value);
  if (data.kind !== 'joined' && data.kind !== 'left' && data.kind !== 'drink') return null;
  return {
    id: str(data.id),
    kind: data.kind,
    at: str(data.at),
    account: parsePartyProfile(data.account),
    beerName: str(data.beer_name),
    quantity: typeof data.quantity === 'number' ? data.quantity : 1,
  };
}

export function parsePartyEvening(value: unknown): PartyEvening {
  const data = raw(value);
  return {
    id: str(data.id),
    joinCode: str(data.join_code),
    joinUrl: str(data.join_url),
    host: parsePartyProfile(data.host),
    pubName: str(data.pub_name),
    pubCity: str(data.pub_city),
    active: data.active !== false,
    startedAt: str(data.started_at),
    endedAt: typeof data.ended_at === 'string' ? data.ended_at : null,
    isHost: data.is_host === true,
    members: Array.isArray(data.members) ? data.members.map(parsePartyProfile) : [],
    events: Array.isArray(data.events)
      ? data.events.flatMap((event) => {
          const parsed = parseEvent(event);
          return parsed ? [parsed] : [];
        })
      : [],
  };
}

function parsePartyEveningHistoryItem(value: unknown): PartyEveningHistoryItem | null {
  const data = raw(value);
  const id = str(data.id);
  const joinCode = str(data.join_code).toUpperCase();
  const startedAt = str(data.started_at);
  const endedAt = str(data.ended_at);
  if (!id || !joinCode || !startedAt || !endedAt) return null;
  return {
    id,
    joinCode,
    pubName: str(data.pub_name),
    pubCity: str(data.pub_city),
    startedAt,
    endedAt,
    isHost: data.is_host === true,
  };
}

function parseGameResult(value: unknown): NightGame['result'] | undefined {
  const data = raw(value);
  if (Object.keys(data).length === 0) return undefined;
  const scores = Array.isArray(data.scores)
    ? data.scores.flatMap((value) => {
        const row = raw(value);
        return typeof row.name === 'string' && typeof row.score === 'number'
          ? [{ name: row.name, score: row.score }]
          : [];
      })
    : [];
  return {
    winner: typeof data.winner === 'string' ? data.winner : null,
    ...(typeof data.paying === 'string' ? { paying: data.paying } : {}),
    scores,
  };
}

/**
 * Private party record wire shape → the one record used by hub, finish and recap.
 *
 * The current account is put first because `nightMe()` deliberately treats the
 * first person as "this phone". Everything else is tolerant: malformed rows are
 * skipped instead of taking the counter down with a bad recap response.
 */
export function parsePartyNightRecord(value: unknown, viewerId?: string): NightRecord {
  const data = raw(value);
  const participants = Array.isArray(data.participants)
    ? data.participants
        .map((value) => {
          const row = raw(value);
          const profile = parsePartyProfile(row);
          return {
            id: profile.id,
            name: profile.nickname ?? profile.displayName,
            avatarUrl: profile.avatarUrl,
            tint: profile.id === viewerId ? ME_TINT : tintFor(profile.id),
            ...(typeof row.joined_at === 'string' ? { joinedAt: row.joined_at } : {}),
            ...(typeof row.left_at === 'string' ? { leftAt: row.left_at } : {}),
            ...(typeof row.active === 'boolean' ? { active: row.active } : {}),
          };
        })
        .filter((person) => person.id.length > 0)
    : [];
  if (viewerId) {
    participants.sort((a, b) => Number(b.id === viewerId) - Number(a.id === viewerId));
  }

  const stops = Array.isArray(data.stops)
    ? data.stops.flatMap((value) => {
        const row = raw(value);
        const id = str(row.id);
        const pubName = str(row.pub_name);
        const arrivedAt = str(row.arrived_at);
        return id && pubName && arrivedAt
          ? [
              {
                id,
                ...(typeof row.by === 'string' ? { by: row.by } : {}),
                pubName,
                cacheKey: typeof row.cache_key === 'string' ? row.cache_key : null,
                arrivedAt,
              },
            ]
          : [];
      })
    : [];

  const drinks = Array.isArray(data.drinks)
    ? data.drinks.flatMap((value) => {
        const row = raw(value);
        const id = str(row.id);
        const at = str(row.at);
        const by = str(row.by);
        if (!id || !at || !by) return [];
        return [
          {
            id,
            at,
            by,
            beerName: str(row.beer_name, 'Pivo'),
            drinkType: normalizeDrinkType(row.drink_type),
            ...(typeof row.volume_ml === 'number' ? { volumeMl: row.volume_ml } : {}),
            stopId: typeof row.stop_id === 'string' ? row.stop_id : null,
          },
        ];
      })
    : [];

  const games = Array.isArray(data.games)
    ? data.games.flatMap((value) => {
        const row = raw(value);
        const key = str(row.key);
        const name = str(row.name);
        const startedAt = str(row.started_at);
        if (!key || !name || !startedAt) return [];
        const result = parseGameResult(row.result);
        const startedBy = raw(row.started_by);
        return [
          {
            key,
            name,
            startedAt,
            ...(typeof startedBy.id === 'string' ? { by: startedBy.id } : {}),
            ...(result ? { result } : {}),
          },
        ];
      })
    : [];

  const photos = Array.isArray(data.photos)
    ? data.photos.flatMap((value) => {
        const row = raw(value);
        const id = str(row.id);
        const url = str(row.url);
        const at = str(row.at);
        const by = str(row.by);
        return id && url && at && by ? [{ id, url, at, by }] : [];
      })
    : [];

  return {
    id: str(data.id, 'night'),
    code: typeof data.code === 'string' ? data.code : null,
    startedAt: str(data.started_at, new Date(0).toISOString()),
    endedAt: typeof data.ended_at === 'string' ? data.ended_at : null,
    people: participants,
    stops,
    drinks: drinks.sort((a, b) => a.at.localeCompare(b.at)),
    games,
    photos,
  };
}

/** Codes the UI has to say something specific about, rather than "zkus to znovu". */
export const PARTY_CONFLICT_CODES = new Set([
  'active_party_membership_exists',
  'party_not_active',
  'party_not_found',
  'ghost_mode',
]);

function extractError(data: unknown, status: number): PartyError {
  const body = raw(data);
  if (typeof body.detail === 'string') {
    return {
      ok: false,
      code: typeof body.code === 'string' ? body.code : `http_${status}`,
      detail: body.detail,
    };
  }
  if (status === 404) {
    return {
      ok: false,
      code: 'party_not_found',
      detail: t.clientErrors.eveningMissing,
    };
  }
  return {
    ok: false,
    code: `http_${status}`,
    detail: 'Nepovedlo se. Zkus to znovu.',
  };
}

type RequestResult =
  { ok: true; data: Record<string, unknown> } | { ok: false; result: PartyError };

async function handleUnauthorized(session: AccountSession, endpoint: string): Promise<void> {
  await classifyQueueHttpFailure(401, session, {
    source: 'party_request',
    endpoint,
  });
}

async function requestJson(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<RequestResult> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'offline',
        detail: t.clientErrors.offline,
      },
    };
  }

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'account',
        detail: t.clientErrors.account,
      },
    };
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
      return {
        ok: false,
        result: { ok: false, code: 'auth', detail: t.clientErrors.auth },
      };
    }
    if (!resp.ok) return { ok: false, result: extractError(data, resp.status) };
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      // No path: a join code is how somebody gets into a table.
      trackApiFailure('party_request', {
        endpoint: 'party',
        reason: 'exception',
        error: err,
      });
    }
    return {
      ok: false,
      result: {
        ok: false,
        code: 'network',
        detail: t.clientErrors.network,
      },
    };
  } finally {
    abort.cleanup();
  }
}

function codePath(code: string, suffix: string): string {
  return `/v1/party-evenings/${encodeURIComponent(code.toUpperCase())}${suffix}`;
}

/** The evening I am currently in, or `null` — the app asks this on launch. */
export async function fetchCurrentPartyEvening(signal?: AbortSignal): Promise<PartyEveningResult> {
  const res = await requestJson('/v1/party-evenings', { signal });
  if (!res.ok) return res.result;
  const evening = res.data.evening;
  return { ok: true, evening: evening ? parsePartyEvening(evening) : null };
}

/** Small, private recap picker used to recover the last night on a fresh device. */
export async function fetchPartyEveningHistory(
  signal?: AbortSignal,
): Promise<PartyEveningHistoryResult> {
  const res = await requestJson('/v1/party-evenings/history', { signal });
  if (!res.ok) return res.result;
  const evenings = Array.isArray(res.data.evenings)
    ? res.data.evenings.flatMap((value) => {
        const evening = parsePartyEveningHistoryItem(value);
        return evening ? [evening] : [];
      })
    : [];
  return { ok: true, evenings, truncated: res.data.truncated === true };
}

/**
 * The evening again, with whoever has joined since.
 *
 * Same shape as the collection call, asked by code — this is what the hub polls
 * while a night runs, so a face that sits down shows up without a stream.
 */
export async function fetchPartyEvening(
  code: string,
  signal?: AbortSignal,
): Promise<PartyEveningResult> {
  const res = await requestJson(codePath(code, ''), { signal });
  return res.ok ? { ok: true, evening: parsePartyEvening(res.data) } : res.result;
}

/** Private, members-only derived record for the running or finished evening. */
export async function fetchPartyNightRecord(
  code: string,
  viewerId?: string,
  signal?: AbortSignal,
): Promise<PartyNightRecordResult> {
  const res = await requestJson(codePath(code, '/record'), { signal });
  return res.ok ? { ok: true, record: parsePartyNightRecord(res.data, viewerId) } : res.result;
}

/**
 * Start one. Idempotent by `clientId`, so a retry on a bad connection joins the
 * evening it already created instead of starting a second one next to it.
 */
export async function createPartyEvening(
  input: {
    clientId: string;
    joinCode: string;
    pubName: string;
    pubCity?: string;
    startedAt?: string;
  },
  signal?: AbortSignal,
): Promise<PartyEveningResult> {
  const res = await requestJson('/v1/party-evenings', {
    method: 'POST',
    body: {
      client_id: input.clientId,
      join_code: input.joinCode.toUpperCase(),
      pub_name: input.pubName,
      pub_city: input.pubCity ?? '',
      ...(input.startedAt ? { started_at: input.startedAt } : {}),
    },
    signal,
  });
  return res.ok ? { ok: true, evening: parsePartyEvening(res.data) } : res.result;
}

export async function joinPartyEvening(
  code: string,
  signal?: AbortSignal,
): Promise<PartyEveningResult> {
  const res = await requestJson(codePath(code, '/join'), {
    method: 'POST',
    signal,
  });
  return res.ok ? { ok: true, evening: parsePartyEvening(res.data) } : res.result;
}

/** Leaving is not ending: the table plays on without you. */
export async function leavePartyEvening(
  code: string,
  signal?: AbortSignal,
): Promise<PartyActionResult> {
  const res = await requestJson(codePath(code, '/join'), {
    method: 'DELETE',
    signal,
  });
  return res.ok ? { ok: true } : res.result;
}

/** Closing the evening for everybody. The host's call. */
export async function endPartyEvening(
  code: string,
  signal?: AbortSignal,
): Promise<PartyEveningResult> {
  const res = await requestJson(codePath(code, '/end'), {
    method: 'POST',
    signal,
  });
  return res.ok ? { ok: true, evening: parsePartyEvening(res.data) } : res.result;
}
