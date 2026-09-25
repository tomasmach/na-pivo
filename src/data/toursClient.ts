import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { tourBoundary } from './toursBoundary';
import { CHALLENGE_MAX, type TourPlan, type TourError, validPlan } from '@/tours/model';
export type TourResponse = {
  ok: true;
  tour: TourPlan;
  expiresAt?: string;
} | {
  ok: false;
  error: TourError;
  tour?: TourPlan;
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
function parseEnvelope(raw: unknown): TourPlan | null {
  try {
    const { tour: w, share } = raw as {
      tour: TourWire;
      share?: {
        url: string;
        expires_at: string;
      } | null;
    };
    const plan: TourPlan = { id: w.id, title: w.title, scheduledDate: w.scheduled_date, scheduledTime: w.scheduled_time?.slice(0, 5) ?? null, timezone: w.timezone, revision: w.revision, updatedAt: w.updated_at,
      stops: w.stops.map((s) => ({ id: s.id, pubId: s.pub_id, cacheKey: s.cache_key, name: s.name, address: s.address, lat: s.lat, lon: s.lon,
        // A challenge this app could not have written is dropped, not a reason to refuse the whole tour.
        ...(typeof s.challenge === 'string' && s.challenge && s.challenge.length <= CHALLENGE_MAX ? { challenge: s.challenge } : {}) })),
      ...(share ? { share: { url: share.url, expiresAt: share.expires_at } } : {}) };
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
  if (code === 'tour_limit' || code === 'share_limit')
    return 'limit';
  return r.status === 401 || r.status === 403 ? 'auth' : r.status === 409 ? 'conflict' : r.status === 404 ? (publicRead ? 'expired' : 'not_found') : r.status === 429 ? 'throttled' : r.status === 400 || r.status === 422 ? 'invalid' : 'network';
}
async function tourRequest(path: string, method = 'GET', body?: unknown, publicRead = false): Promise<TourResponse> {
  const r = await request(path, method, body, publicRead);
  const tour = parseEnvelope(r.data);
  if (!r.ok)
    return { ok: false, error: errorFor(r, publicRead), ...(tour ? { tour } : {}) };
  if (!tour)
    return { ok: false, error: 'invalid' };
  const expiresAt = (r.data as {
    expires_at?: string;
  }).expires_at;
  return { ok: true, tour, ...(expiresAt ? { expiresAt } : {}) };
}
export const fetchSharedTour = (token: string): Promise<TourResponse> => /^[A-Za-z0-9_-]{20,200}$/.test(token) ? tourRequest(`/v1/tour-shares/${encodeURIComponent(token)}`, 'GET', undefined, true) : Promise.resolve({ ok: false, error: 'expired' });
export const publishTour = (plan: TourPlan, operationId: string) => tourRequest(`/v1/tours/${plan.id}`, 'PUT', { ...toTourWire(plan), operation_id: operationId, base_revision: plan.revision });
export const shareTour = (id: string, operationId: string, rotate = false) => tourRequest(`/v1/tours/${id}/share`, 'POST', { operation_id: operationId, rotate });
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
