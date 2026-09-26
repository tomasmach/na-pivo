import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { tourBoundary } from './toursBoundary';
import { CHALLENGE_MAX, type CrewMember, type TourPlan, type TourError, type TourPublication, uuidValid, validPlan, validPublication } from '@/tours/model';
export interface PublicTourAuthor {
  id: string;
  nickname: string;
  displayName: string;
  avatarUrl: string | null;
}
/** What a public link adds on top of the plan: who made it and how far it walks. */
export interface PublicTourInfo {
  id: string;
  author: PublicTourAuthor;
  peopleCount: number;
  city: string;
  walkM: number;
}
export type TourResponse = {
  ok: true;
  tour: TourPlan;
  expiresAt?: string;
  public?: PublicTourInfo;
} | {
  ok: false;
  error: TourError;
  tour?: TourPlan;
  stop?: number;
  field?: 'title' | 'challenge';
  limit?: number;
};
export interface TourWire {
  id: string;
  title: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  timezone: string;
  revision: number;
  updated_at: string;
  stops: {
    id: string;
    pub_id: string;
    cache_key: string | null;
    name: string;
    address: string;
    lat: number;
    lon: number;
    challenge?: string;
  }[];
}
export function toTourWire(plan: TourPlan) {
  return { title: plan.title, scheduled_date: plan.scheduledDate, scheduled_time: plan.scheduledTime, timezone: plan.timezone,
    // Always send the key: an empty string clears a challenge, a missing key keeps it (released apps).
    stops: plan.stops.map((s) => ({ id: s.id, pub_id: s.pubId, cache_key: s.cacheKey, name: s.name, address: s.address, lat: s.lat, lon: s.lon, challenge: s.challenge ?? '' })) };
}
interface PublicationWire {
  id: string;
  token: string;
  url: string;
  status: TourPublication['status'];
  revision: number;
  plan_revision: number;
  people_count: number;
}
function parsePublication(w: PublicationWire | null | undefined): TourPublication | null {
  if (!w)
    return null;
  const publication = { id: w.id, token: w.token, url: w.url, status: w.status, revision: w.revision, planRevision: w.plan_revision, peopleCount: w.people_count };
  return validPublication(publication) ? publication : null;
}
function parsePublic(raw: unknown): PublicTourInfo | undefined {
  const p = (raw as { public?: { id?: unknown; author?: { id?: unknown; nickname?: unknown; display_name?: unknown; avatar_url?: unknown }; people_count?: unknown; city?: unknown; walk_m?: unknown } } | null)?.public;
  if (!p || !uuidValid(p.id) || !p.author || typeof p.author.id !== 'string' || typeof p.author.nickname !== 'string' || !p.author.nickname)
    return undefined;
  return {
    id: p.id, peopleCount: Number.isInteger(p.people_count) ? p.people_count as number : 0,
    city: typeof p.city === 'string' ? p.city : '', walkM: Number.isFinite(p.walk_m) ? p.walk_m as number : 0,
    author: { id: p.author.id, nickname: p.author.nickname, displayName: typeof p.author.display_name === 'string' ? p.author.display_name : '',
      avatarUrl: typeof p.author.avatar_url === 'string' ? p.author.avatar_url : null },
  };
}
function parseEnvelope(raw: unknown): TourPlan | null {
  try {
    const { tour: w, share, publication: pw } = raw as {
      tour: TourWire;
      share?: {
        url: string;
        expires_at: string;
      } | null;
      publication?: PublicationWire | null;
    };
    const publication = parsePublication(pw);
    const plan: TourPlan = { id: w.id, title: w.title, scheduledDate: w.scheduled_date, scheduledTime: w.scheduled_time?.slice(0, 5) ?? null, timezone: w.timezone, revision: w.revision, updatedAt: w.updated_at,
      stops: w.stops.map((s) => ({ id: s.id, pubId: s.pub_id, cacheKey: s.cache_key, name: s.name, address: s.address, lat: s.lat, lon: s.lon,
        // A challenge this app could not have written is dropped, not a reason to refuse the whole tour.
        ...(typeof s.challenge === 'string' && s.challenge && s.challenge.length <= CHALLENGE_MAX ? { challenge: s.challenge } : {}) })),
      ...(share ? { share: { url: share.url, expiresAt: share.expires_at } } : {}),
      ...(publication ? { publication } : {}) };
    return validPlan(plan) ? plan : null;
  }
  catch {
    return null;
  }
}
async function request(path: string, method = 'GET', body?: unknown, publicRead = false): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  stale?: boolean;
}> {
  const boundary = tourBoundary();
  if (boundary.changing)
    return { ok: false, status: 0, data: null, stale: true };
  const abort = chainAbortSignal(undefined, 12000);
  try {
    const endpoint = getBackendEndpoint(path);
    if (!endpoint)
      return { ok: false, status: 0, data: null };
    const session = publicRead ? null : await ensureAccount();
    if (tourBoundary().generation !== boundary.generation || tourBoundary().changing)
      return { ok: false, status: 0, data: null, stale: true };
    if (!publicRead && !session)
      return { ok: false, status: 0, data: null };
    const response = await fetch(endpoint, { method, signal: abort.signal, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data: unknown = null;
    if (response.status !== 204) {
      try { data = await response.json(); } catch { /* Empty error bodies still carry a meaningful HTTP status. */ }
    }
    if (tourBoundary().generation !== boundary.generation || tourBoundary().changing)
      return { ok: false, status: 0, data: null, stale: true };
    return { ok: response.ok, status: response.status, data };
  }
  catch {
    return { ok: false, status: 0, data: null };
  }
  finally {
    abort.cleanup();
  }
}
function errorFor(r: {
  status: number;
  stale?: boolean;
  data?: unknown;
}, publicRead = false): TourError {
  if (r.stale)
    return 'account_changed';
  const code = (r.data && typeof r.data === 'object') ? (r.data as {
    error?: unknown;
  }).error : null;
  if (code === 'tour_limit' || code === 'share_limit' || code === 'publication_limit')
    return 'limit';
  const publicCodes: Record<string, TourError> = {
    sign_in_required: 'sign_in', nickname_required: 'nickname', profile_private: 'profile_private', rules_required: 'rules',
    text_rejected: 'text_rejected', unknown_pub: 'unknown_pub', hidden_pub: 'hidden_pub', duplicate_pub: 'duplicate', publication_hidden: 'publication_hidden',
  };
  if (typeof code === 'string' && publicCodes[code])
    return publicCodes[code];
  return r.status === 401 || r.status === 403 ? 'auth' : r.status === 409 ? 'conflict' : r.status === 404 ? (publicRead ? 'expired' : 'not_found') : r.status === 429 ? 'throttled' : r.status === 400 || r.status === 422 ? 'invalid' : 'network';
}
async function tourRequest(path: string, method = 'GET', body?: unknown, publicRead = false): Promise<TourResponse> {
  const r = await request(path, method, body, publicRead);
  const tour = parseEnvelope(r.data);
  if (!r.ok) {
    const detail = (r.data && typeof r.data === 'object' ? r.data : {}) as { stop?: unknown; field?: unknown; limit?: unknown };
    return { ok: false, error: errorFor(r, publicRead), ...(tour ? { tour } : {}),
      ...(Number.isInteger(detail.stop) ? { stop: detail.stop as number } : {}),
      ...(detail.field === 'title' || detail.field === 'challenge' ? { field: detail.field } : {}),
      ...(Number.isInteger(detail.limit) ? { limit: detail.limit as number } : {}) };
  }
  if (!tour)
    return { ok: false, error: 'invalid' };
  const expiresAt = (r.data as {
    expires_at?: string;
  }).expires_at;
  const publicInfo = parsePublic(r.data);
  return { ok: true, tour, ...(expiresAt ? { expiresAt } : {}), ...(publicInfo ? { public: publicInfo } : {}) };
}
export const fetchSharedTour = (token: string): Promise<TourResponse> => /^[A-Za-z0-9_-]{20,200}$/.test(token) ? tourRequest(`/v1/tour-shares/${encodeURIComponent(token)}`, 'GET', undefined, true) : Promise.resolve({ ok: false, error: 'expired' });
export const publishTour = (plan: TourPlan, operationId: string) => tourRequest(`/v1/tours/${plan.id}`, 'PUT', { ...toTourWire(plan), operation_id: operationId, base_revision: plan.revision });
export const shareTour = (id: string, operationId: string, rotate = false) => tourRequest(`/v1/tours/${id}/share`, 'POST', { operation_id: operationId, rotate });
/** The screen shows the rules line every time, so publishing always carries the consent. */
export const publishPublicTour = (id: string, revision: number) => tourRequest(`/v1/tours/${id}/publication`, 'PUT', { revision, accept_rules: true });
export async function unpublishPublicTour(id: string): Promise<{ ok: true } | { ok: false; error: TourError }> {
  const r = await request(`/v1/tours/${id}/publication`, 'DELETE');
  return r.ok ? { ok: true } : { ok: false, error: errorFor(r) };
}
export async function reportPublicTour(publicId: string): Promise<{ ok: true } | { ok: false; error: TourError }> {
  const r = await request(`/v1/tour-publications/${publicId}/report`, 'POST', { reason: 'inappropriate_tour' });
  return r.ok ? { ok: true } : { ok: false, error: errorFor(r) };
}
export async function revokeTour(id: string): Promise<{
  ok: true;
} | {
  ok: false;
  error: TourError;
}> {
  const r = await request(`/v1/tours/${id}/share`, 'DELETE');
  return r.ok ? { ok: true } : { ok: false, error: errorFor(r) };
}
export async function deletePublishedTour(id: string): Promise<{
  ok: true;
} | {
  ok: false;
  error: TourError;
}> {
  const r = await request(`/v1/tours/${id}`, 'DELETE');
  return r.ok || r.status === 404 ? { ok: true } : { ok: false, error: errorFor(r) };
}
export async function fetchPublishedTours(): Promise<{
  ok: true;
  tours: TourPlan[];
} | {
  ok: false;
  error: TourError;
}> {
  const tours: TourPlan[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const r = await request(`/v1/tours${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!r.ok)
      return { ok: false, error: errorFor(r) };
    const data = r.data as {
      tours?: unknown[];
      next_cursor?: unknown;
    };
    if (!Array.isArray(data?.tours))
      return { ok: false, error: 'invalid' };
    for (const item of data.tours) {
      const plan = parseEnvelope(item);
      if (!plan)
        return { ok: false, error: 'invalid' };
      if (!tours.some((p) => p.id === plan.id))
        tours.push(plan);
    }
    if (tours.length > 100)
      return { ok: false, error: 'limit' };
    if (data.next_cursor !== null && data.next_cursor !== undefined && typeof data.next_cursor !== 'string')
      return { ok: false, error: 'invalid' };
    cursor = typeof data.next_cursor === 'string' ? data.next_cursor : null;
    if (cursor) {
      if (seen.has(cursor))
        return { ok: false, error: 'invalid' };
      seen.add(cursor);
    }
  } while (cursor);
  return { ok: true, tours };
}

/** The party of one joint run, as the server shows it to its members. */
export interface TourCrewRun {
  id: string;
  ended: boolean;
  /** Null once the organizer deleted their account. */
  organizerId: string | null;
  members: CrewMember[];
  me: { completed: boolean; left: boolean };
  peopleCount: number;
  counted?: boolean;
}
function parseAuthor(raw: unknown): PublicTourAuthor | null {
  const a = raw as { id?: unknown; nickname?: unknown; display_name?: unknown; avatar_url?: unknown } | null;
  if (!a || typeof a.id !== 'string' || typeof a.nickname !== 'string' || !a.nickname)
    return null;
  return { id: a.id, nickname: a.nickname, displayName: typeof a.display_name === 'string' ? a.display_name : '', avatarUrl: typeof a.avatar_url === 'string' ? a.avatar_url : null };
}
function parseCrewRun(raw: unknown): TourCrewRun | null {
  const r = raw as { id?: unknown; ended?: unknown; organizer_id?: unknown; members?: unknown[]; me?: { completed?: unknown; left?: unknown };
    people_count?: unknown; counted?: unknown } | null;
  if (!r || !uuidValid(r.id) || (typeof r.organizer_id !== 'string' && r.organizer_id !== null) || !Array.isArray(r.members))
    return null;
  const members = r.members.flatMap((item) => {
    const author = parseAuthor(item);
    const flags = item as { left?: unknown; completed?: unknown };
    return author ? [{ ...author, left: flags.left === true, completed: flags.completed === true }] : [];
  }).slice(0, 20);
  return {
    id: r.id, ended: r.ended === true, organizerId: r.organizer_id, members,
    me: { completed: r.me?.completed === true, left: r.me?.left === true },
    peopleCount: Number.isInteger(r.people_count) ? r.people_count as number : 0,
    ...(typeof r.counted === 'boolean' ? { counted: r.counted } : {}),
  };
}
/** `refused`: the run is over or full, so this walker is not in the party. */
export type TourRunResult = { status: number; stale?: boolean; run: TourCrewRun | null; refused?: boolean };
async function runRequest(path: string, method: string, body?: unknown): Promise<TourRunResult> {
  const r = await request(path, method, body);
  const refused = r.ok && (r.data as { joined?: unknown } | null)?.joined === false;
  return { status: r.status, ...(r.stale ? { stale: true } : {}), run: r.ok ? parseCrewRun(r.data) : null, ...(refused ? { refused: true } : {}) };
}
export const putTourRun = (runId: string, publicId: string, ended: boolean) => runRequest(`/v1/tour-runs/${runId}`, 'PUT', { publication_id: publicId, ended });
export const putTourRunMember = (runId: string, state: 'joined' | 'left' | 'completed' | 'uncounted') => runRequest(`/v1/tour-runs/${runId}/me`, 'PUT', { state });
export const fetchTourRun = (runId: string) => runRequest(`/v1/tour-runs/${runId}`, 'GET');
export interface TourRunPreview { organizer: PublicTourAuthor; going: number; members: PublicTourAuthor[] }
export async function fetchTourRunPreview(runId: string): Promise<TourRunPreview | null> {
  const r = await request(`/v1/tour-runs/${runId}/preview`, 'GET');
  const data = r.data as { organizer?: unknown; going?: unknown; members?: unknown[] } | null;
  const organizer = r.ok ? parseAuthor(data?.organizer) : null;
  if (!organizer)
    return null;
  return { organizer, going: Number.isInteger(data?.going) ? data!.going as number : 1,
    members: (Array.isArray(data?.members) ? data!.members : []).map(parseAuthor).filter((a): a is PublicTourAuthor => !!a) };
}
