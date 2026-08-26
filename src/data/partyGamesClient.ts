/**
 * Sdílené hry u stolu — the HTTP half.
 *
 * A game played on several phones is not "my state, mirrored". It is one
 * append-only list of events that every phone folds into the same picture:
 *
 *   POST   /v1/party-evenings/<code>/games              put a game on the table
 *   POST   /v1/party-evenings/<code>/games/<id>/events  say what happened
 *   GET    /v1/party-evenings/<code>/games?since=<n>    catch up
 *   GET    /v1/party-evenings/<code>/games/stream       …as it happens (see
 *                                                        partyGamesStream.ts)
 *
 * Two properties carry the whole design, and both live on the server already:
 *
 *   cursor      every event has a monotonic id. A client remembers the highest
 *               one it has folded in and asks for what came after. That single
 *               number is also the reconnect token, the catch-up token and the
 *               "did I miss anything" test — there is nothing else to sync.
 *   client_id   every event carries one, unique per game. So a retry, a
 *               double-tap or a queue flush that ran twice lands once. This is
 *               what makes it safe to be aggressive about resending.
 *
 * Nothing here knows what a game IS. `catalog_key` and `payload` are opaque:
 * the rules live in the app (§18.11a), and a server that understands games is a
 * server that needs deploying every time we add one.
 */

import { ensureAccount, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;

export interface PartyGameProfile {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface PartyGame {
  id: string;
  catalogKey: string;
  name: string;
  scoring: 'points' | 'drinks';
  startedBy: PartyGameProfile;
  /** Frozen server-owned lobby order. Missing on an older backend. */
  roster: PartyGameProfile[];
  startedAt: string;
  endedAt: string | null;
  /** Stable deal seed derived from the table and catalogue-game identity. */
  seed: number;
}

/** `start` is the server-owned discovery envelope; the other kinds are gameplay. */
export type PartyGameEventKind = 'start' | 'score' | 'answer' | 'action' | 'finish';
export type PartyGameWritableEventKind = Exclude<PartyGameEventKind, 'start'>;

export interface PartyGameEvent {
  cursor: number;
  /** Idempotency/optimistic-echo correlation. Null only against a legacy API. */
  clientId: string | null;
  gameId: string;
  kind: PartyGameEventKind;
  /** Who sent it. */
  account: PartyGameProfile;
  /** Whose score moved. Absent on `answer` and `finish`. */
  subject: PartyGameProfile | null;
  delta: number;
  /** Game-specific, opaque to everything but the game that wrote it. */
  payload: Record<string, unknown>;
  at: string;
}

/** What a phone sends. `clientId` is what makes a resend free. */
export interface PartyGameEventInput {
  clientId: string;
  /** `start` is server-owned and can never be appended by a phone. */
  kind: PartyGameWritableEventKind;
  subjectId?: string;
  delta?: number;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export interface PartyGameStartInput {
  clientId: string;
  catalogKey: string;
  name: string;
  scoring?: 'points' | 'drinks';
  /** Explicit lobby selection. Omitted clients get the server's active roster. */
  rosterIds?: string[];
  startedAt?: string;
}

export interface PartyGamesError {
  ok: false;
  code: string;
  detail: string;
}

export type PartyGameStartResult = { ok: true; game: PartyGame } | PartyGamesError;
export type PartyGamesCatchUpResult =
  | { ok: true; cursor: number; games: PartyGame[]; events: PartyGameEvent[] }
  | PartyGamesError;
export type PartyGameEventsResult =
  | { ok: true; cursor: number; accepted: PartyGameEvent[] }
  | PartyGamesError;

/** Errors worth keeping a queued event for. Everything else is the event's fault. */
export function isRetriablePartyGamesError(error: PartyGamesError): boolean {
  return (
    error.code === 'offline' ||
    error.code === 'account' ||
    error.code === 'network' ||
    error.code === 'auth' ||
    error.code.startsWith('http_5') ||
    error.code === 'http_429'
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

export function parsePartyGameProfile(value: unknown): PartyGameProfile {
  const data = raw(value);
  const nickname = typeof data.nickname === 'string' ? data.nickname : null;
  return {
    id: str(data.id),
    nickname,
    displayName: str(data.display_name, nickname ?? 'Kamarád'),
    avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
  };
}

export function parsePartyGame(value: unknown): PartyGame {
  const data = raw(value);
  const id = str(data.id);
  const seed = typeof data.seed === 'number' && Number.isSafeInteger(data.seed) && data.seed > 0
    ? data.seed
    : partyGameSeedFromId(id);
  return {
    id,
    catalogKey: str(data.catalog_key),
    name: str(data.name),
    scoring: data.scoring === 'drinks' ? 'drinks' : 'points',
    startedBy: parsePartyGameProfile(data.started_by),
    roster: Array.isArray(data.roster) ? data.roster.map(parsePartyGameProfile) : [],
    startedAt: str(data.started_at),
    endedAt: typeof data.ended_at === 'string' ? data.ended_at : null,
    seed,
  };
}

function parseKind(value: unknown): PartyGameEventKind {
  return value === 'start' || value === 'finish' || value === 'answer' || value === 'action'
    ? value
    : 'score';
}

export function parsePartyGameEvent(value: unknown): PartyGameEvent {
  const data = raw(value);
  return {
    cursor: typeof data.cursor === 'number' ? data.cursor : 0,
    clientId: typeof data.client_id === 'string' ? data.client_id : null,
    gameId: str(data.game_id),
    kind: parseKind(data.kind),
    account: parsePartyGameProfile(data.account),
    subject: data.subject ? parsePartyGameProfile(data.subject) : null,
    delta: typeof data.delta === 'number' ? data.delta : 0,
    payload: raw(data.payload),
    at: str(data.at),
  };
}

/** Stable fallback for a released backend that does not return a game seed. */
export function partyGameSeedFromId(gameId: string): number {
  const uuid = gameId.startsWith('local:') ? gameId.slice('local:'.length) : gameId;
  const hex = uuid.replaceAll('-', '').toLowerCase();
  let value = 0;
  if (/^[0-9a-f]{32}$/.test(hex)) {
    for (const char of hex) value = (value * 16 + Number.parseInt(char, 16)) % 2_147_483_647;
    return value || 1;
  }
  // Released backends have no seed. Their server game UUID is still identical
  // on every connected phone, so a small stable hash preserves compatibility.
  for (let index = 0; index < gameId.length; index += 1) {
    value = (Math.imul(value, 31) + gameId.charCodeAt(index)) & 0x7fffffff;
  }
  return value || 1;
}

/** Match the API's FNV-1a seed while a game start is still offline/pending. */
export function partyGameSeedForTable(code: string, catalogKey: string): number {
  let value = 2_166_136_261;
  for (const char of `${code.toUpperCase()}:${catalogKey}`) {
    value = Math.imul(value ^ char.charCodeAt(0), 16_777_619) >>> 0;
  }
  return (value & 0x7fffffff) || 1;
}

export function partyGameEventWire(event: PartyGameEventInput): Record<string, unknown> {
  return {
    client_id: event.clientId,
    kind: event.kind,
    ...(event.subjectId ? { subject_id: event.subjectId } : {}),
    ...(event.delta !== undefined ? { delta: event.delta } : {}),
    ...(event.payload ? { payload: event.payload } : {}),
    ...(event.createdAt ? { created_at: event.createdAt } : {}),
  };
}

function extractError(data: unknown, status: number): PartyGamesError {
  const body = raw(data);
  if (typeof body.detail === 'string') {
    return {
      ok: false,
      code: typeof body.code === 'string' ? body.code : `http_${status}`,
      detail: body.detail,
    };
  }
  return { ok: false, code: `http_${status}`, detail: 'Hra se serverem se nedomluvila.' };
}

type RequestResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; result: PartyGamesError };

async function handleUnauthorized(session: AccountSession, endpoint: string): Promise<void> {
  await classifyQueueHttpFailure(401, session, { source: 'party_games_request', endpoint });
}

async function requestJson(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    expectedAccountId?: string;
  } = {},
): Promise<RequestResult> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return {
      ok: false,
      result: { ok: false, code: 'offline', detail: 'Teď se k serveru nedostanu.' },
    };
  }

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) {
    return {
      ok: false,
      result: { ok: false, code: 'account', detail: 'Účet teď není připravený.' },
    };
  }
  if (options.expectedAccountId && session.accountId !== options.expectedAccountId) {
    return {
      ok: false,
      result: { ok: false, code: 'account', detail: 'Účet se mezitím změnil.' },
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
      return { ok: false, result: { ok: false, code: 'auth', detail: 'Přihlášení vypršelo.' } };
    }
    if (!resp.ok) return { ok: false, result: extractError(data, resp.status) };
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      // Path only — a join code is how you get into somebody's evening.
      trackApiFailure('party_games_request', { endpoint: 'party_games', reason: 'exception', error: err });
    }
    return {
      ok: false,
      result: { ok: false, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' },
    };
  } finally {
    abort.cleanup();
  }
}

function gamesPath(code: string): string {
  return `/v1/party-evenings/${encodeURIComponent(code)}/games`;
}

/**
 * Put a game on the table. Idempotent by `clientId`, so the same call twice
 * returns the same game rather than starting a second one.
 */
export async function startPartyGame(
  code: string,
  input: PartyGameStartInput,
  signal?: AbortSignal,
  expectedAccountId?: string,
): Promise<PartyGameStartResult> {
  const res = await requestJson(gamesPath(code), {
    method: 'POST',
    body: {
      client_id: input.clientId,
      catalog_key: input.catalogKey,
      name: input.name,
      scoring: input.scoring ?? 'points',
      ...(input.rosterIds ? { roster_ids: input.rosterIds } : {}),
      ...(input.startedAt ? { started_at: input.startedAt } : {}),
    },
    signal,
    expectedAccountId,
  });
  return res.ok ? { ok: true, game: parsePartyGame(res.data) } : res.result;
}

/** Everything after `since`. `since: 0` also brings the games themselves. */
export async function fetchPartyGames(
  code: string,
  since = 0,
  signal?: AbortSignal,
): Promise<PartyGamesCatchUpResult> {
  const res = await requestJson(`${gamesPath(code)}?since=${since}`, { signal });
  if (!res.ok) return res.result;
  return {
    ok: true,
    cursor: typeof res.data.cursor === 'number' ? res.data.cursor : since,
    games: Array.isArray(res.data.games) ? res.data.games.map(parsePartyGame) : [],
    events: Array.isArray(res.data.events) ? res.data.events.map(parsePartyGameEvent) : [],
  };
}

/**
 * Append to a game. A batch, because a phone that lost signal comes back with
 * several and one request beats five at the moment the connection is worst.
 */
export async function sendPartyGameEvents(
  code: string,
  gameId: string,
  events: PartyGameEventInput[],
  signal?: AbortSignal,
  expectedAccountId?: string,
): Promise<PartyGameEventsResult> {
  const res = await requestJson(`${gamesPath(code)}/${encodeURIComponent(gameId)}/events`, {
    method: 'POST',
    body: { events: events.map(partyGameEventWire) },
    signal,
    expectedAccountId,
  });
  if (!res.ok) return res.result;
  return {
    ok: true,
    cursor: typeof res.data.cursor === 'number' ? res.data.cursor : 0,
    accepted: Array.isArray(res.data.accepted)
      ? res.data.accepted.map(parsePartyGameEvent)
      : [],
  };
}
