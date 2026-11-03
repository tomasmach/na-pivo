/**
 * New-look Parta wire contract: plans up to two weeks ahead (pub, home or a
 * custom place), the plan detail with who answered what, host reminders,
 * direct pings, the friend's-home evening and the month duel.
 *
 * Every call returns a result or null, never throws into the UI. Writes that
 * must survive a dead signal go through `friendsQueue` (see `enqueueFriendOp`).
 */

import {
  parseActivity,
  parseProfile,
  requestJson,
  type FriendActionResult,
  type FriendProfile,
  type FriendPubActivity,
  type RawFriendActivity,
  type RawFriendProfile,
} from './friendsClient';

export type PlaceKind = 'pub' | 'home' | 'custom';

export interface PartaPlan extends FriendPubActivity {
  placeKind: PlaceKind;
  /** Free-text address of a home or custom place; empty for pubs. */
  address: string;
  lat: number | null;
  lng: number | null;
  isMine: boolean;
  /** How many people my own plan went to; null on friends' plans. */
  inviteeCount: number | null;
}

export interface PlanPeople {
  going: FriendProfile[];
  /** Only the host gets the maybe / can't / silent profiles. */
  maybe: FriendProfile[];
  cant: FriendProfile[];
  silent: FriendProfile[];
  maybeCount: number;
  cantCount: number;
}

export interface HomeEveningState {
  started: boolean;
  present: FriendProfile[];
  coming: FriendProfile[];
  myCheckin: boolean;
  canCheckIn: boolean;
}

export interface PlanDetail {
  plan: PartaPlan;
  people: PlanPeople;
  home: HomeEveningState | null;
}

export interface PlanInput {
  clientId: string;
  placeKind: PlaceKind;
  /** Pub name, or the title shown for a home ("U @tomas doma"). */
  name: string;
  lat?: number | null;
  lng?: number | null;
  city?: string;
  externalId?: string;
  address?: string;
  message?: string;
  /** ISO time; absent or past means "now". */
  scheduledFor?: string | null;
  /** When a queued "now" invite was really sent; the server keeps it instead of restarting the evening. */
  startedAt?: string;
  /** Undefined means the whole party. */
  recipientIds?: string[];
}

export type DuelWindow = 'month' | '30d' | '180d' | 'all';

export interface DuelSide {
  beers: number;
  evenings: number;
  pubs: number;
}

export interface FriendDuel {
  available: boolean;
  me: DuelSide | null;
  them: DuelSide | null;
}

type Raw = Record<string, unknown>;

function profiles(raw: unknown): FriendProfile[] {
  return Array.isArray(raw)
    ? raw.map((item) => parseProfile(item as RawFriendProfile)).filter((profile) => profile.id)
    : [];
}

function count(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function parsePartaPlan(raw: unknown): PartaPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Raw;
  const base = parseActivity(row as RawFriendActivity);
  if (!base.id) return null;
  const kind = row.place_kind;
  return {
    ...base,
    placeKind: kind === 'home' || kind === 'custom' ? kind : 'pub',
    address: typeof row.address === 'string' ? row.address : '',
    lat: typeof row.lat === 'number' ? row.lat : null,
    lng: typeof row.lng === 'number' ? row.lng : null,
    isMine: row.is_mine === true,
    inviteeCount: typeof row.invitee_count === 'number' ? row.invitee_count : null,
  };
}

function parseHome(raw: unknown): HomeEveningState | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Raw;
  return {
    started: row.started === true,
    present: profiles(row.present),
    coming: profiles(row.coming),
    myCheckin: row.my_checkin === true,
    canCheckIn: row.can_check_in === true,
  };
}

export function parsePlanDetail(raw: unknown): PlanDetail | null {
  const plan = parsePartaPlan(raw);
  if (!plan) return null;
  const people = ((raw as Raw).people ?? {}) as Raw;
  return {
    plan,
    people: {
      going: profiles(people.going),
      maybe: profiles(people.maybe),
      cant: profiles(people.cant),
      silent: profiles(people.silent),
      maybeCount: count(people.maybe_count),
      cantCount: count(people.cant_count),
    },
    home: parseHome((raw as Raw).home),
  };
}

/** Every open invitation I host or am invited to; null when it could not load. */
export async function fetchPartaPlans(signal?: AbortSignal): Promise<PartaPlan[] | null> {
  const res = await requestJson('/v1/friends/plans', { signal });
  if (!res.ok) return null;
  const rows = Array.isArray(res.data.plans) ? res.data.plans : [];
  return rows.map(parsePartaPlan).filter((plan): plan is PartaPlan => plan !== null);
}

/** `'gone'` when the plan was called off, ended or is not mine to see. */
export async function fetchPlanDetail(id: string, signal?: AbortSignal): Promise<PlanDetail | 'gone' | null> {
  const res = await requestJson(`/v1/friends/pub-activity/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) return res.result.code === 'plan_not_found' || res.result.code === 'http_404' ? 'gone' : null;
  return parsePlanDetail(res.data);
}

function planBody(input: Partial<PlanInput>): Raw {
  const body: Raw = {};
  if (input.clientId) body.client_id = input.clientId;
  if (input.placeKind) body.place_kind = input.placeKind;
  if (input.name !== undefined) body.name = input.name;
  if (input.lat != null && input.lng != null) {
    body.lat = input.lat;
    body.lng = input.lng;
  }
  if (input.city !== undefined) body.city = input.city;
  if (input.externalId !== undefined) body.external_id = input.externalId;
  if (input.address !== undefined) body.address = input.address;
  if (input.message !== undefined) body.message = input.message;
  if (input.scheduledFor !== undefined) body.scheduled_for = input.scheduledFor;
  if (input.startedAt) body.started_at = input.startedAt;
  if (input.recipientIds && input.recipientIds.length > 0) body.recipient_ids = input.recipientIds;
  return body;
}

export type PlanWriteResult = { ok: true; detail: PlanDetail | null } | Extract<FriendActionResult, { ok: false }>;

/** Create (or, with the same client id, retry) a plan. */
export async function createPartaPlan(input: PlanInput): Promise<PlanWriteResult> {
  const res = await requestJson('/v1/friends/pub-activity', { method: 'POST', body: planBody(input) });
  return res.ok ? { ok: true, detail: parsePlanDetail(res.data) } : res.result;
}

/** Edit my plan; omitted fields stay as they are. */
export async function updatePartaPlan(id: string, patch: Partial<PlanInput>): Promise<PlanWriteResult> {
  const res = await requestJson(`/v1/friends/pub-activity/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: planBody(patch),
  });
  return res.ok ? { ok: true, detail: parsePlanDetail(res.data) } : res.result;
}

export async function remindPlan(id: string): Promise<{ ok: true; reminded: number } | Extract<FriendActionResult, { ok: false }>> {
  const res = await requestJson(`/v1/friends/pub-activity/${encodeURIComponent(id)}/remind`, { method: 'POST' });
  return res.ok ? { ok: true, reminded: count(res.data.reminded) } : res.result;
}

/** A cinknutí to one friend, without a pub. */
export async function pingFriend(accountId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/${encodeURIComponent(accountId)}/ping`, { method: 'POST', body: {} });
  return res.ok ? { ok: true } : res.result;
}

/** "Jsem u Kláry". Idempotent per client id, so the queue may replay it. */
export async function checkInAtHome(activityId: string, clientId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/pub-activity/${encodeURIComponent(activityId)}/checkin`, {
    method: 'POST',
    body: { client_id: clientId },
  });
  return res.ok ? { ok: true } : res.result;
}

export async function leaveHome(activityId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/friends/pub-activity/${encodeURIComponent(activityId)}/checkin`, {
    method: 'DELETE',
  });
  return res.ok ? { ok: true } : res.result;
}

function duelSide(raw: unknown): DuelSide | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Raw;
  return { beers: count(row.beers), evenings: count(row.evenings), pubs: count(row.pubs) };
}

/** The Souboj with one friend; `available` is false when they do not share drinks. */
export async function fetchFriendDuel(
  accountId: string,
  window: DuelWindow,
  signal?: AbortSignal,
): Promise<FriendDuel | null> {
  const res = await requestJson(
    `/v1/friends/${encodeURIComponent(accountId)}/duel?window=${window}`,
    { signal },
  );
  if (!res.ok) return null;
  return {
    available: res.data.available === true,
    me: duelSide(res.data.me),
    them: duelSide(res.data.them),
  };
}
