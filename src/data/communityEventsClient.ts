import { chainAbortSignal } from './apiFetch';
import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;

export type CommunityEventStatus = 'upcoming' | 'live' | 'ended' | 'cancelled';
export type CommunityMembershipStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'left';
export type DistanceBand = 'under_1_km' | '1_3_km' | '3_8_km' | '8_15_km';

export interface CommunityEventProfile {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface CommunityJoinRequest {
  id: string;
  account: CommunityEventProfile;
  message: string;
  status: CommunityMembershipStatus;
  requestedAt: string;
}

export interface CommunityEvent {
  id: string;
  host: CommunityEventProfile;
  title: string;
  description: string;
  city: string;
  areaLabel: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  availableSpots: number;
  adultsOnly: true;
  status: CommunityEventStatus;
  distanceBand: DistanceBand | null;
  isHost: boolean;
  membershipStatus: CommunityMembershipStatus | null;
  exactAddress: string | null;
  joinRequests: CommunityJoinRequest[];
}

export interface CommunityEventsDashboard {
  nearby: CommunityEvent[];
  hosted: CommunityEvent[];
  joined: CommunityEvent[];
}

export type CommunityActionResult =
  | { ok: true; event?: CommunityEvent }
  | { ok: false; code: string; detail: string };

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

function profile(raw: Record<string, unknown> | undefined): CommunityEventProfile {
  return {
    id: typeof raw?.id === 'string' ? raw.id : '',
    nickname: typeof raw?.nickname === 'string' ? raw.nickname : null,
    displayName: typeof raw?.display_name === 'string' ? raw.display_name : '',
    avatarUrl: typeof raw?.avatar_url === 'string' ? raw.avatar_url : null,
  };
}

function parseEvent(value: unknown): CommunityEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
  const membership = raw.membership_status;
  const distance = raw.distance_band;
  return {
    id: raw.id,
    host: profile(raw.host as Record<string, unknown> | undefined),
    title: raw.title,
    description: typeof raw.description === 'string' ? raw.description : '',
    city: typeof raw.city === 'string' ? raw.city : '',
    areaLabel: typeof raw.area_label === 'string' ? raw.area_label : '',
    startsAt: typeof raw.starts_at === 'string' ? raw.starts_at : '',
    endsAt: typeof raw.ends_at === 'string' ? raw.ends_at : '',
    capacity: typeof raw.capacity === 'number' ? raw.capacity : 2,
    availableSpots: typeof raw.available_spots === 'number' ? raw.available_spots : 0,
    adultsOnly: true,
    status:
      raw.status === 'live' || raw.status === 'ended' || raw.status === 'cancelled'
        ? raw.status
        : 'upcoming',
    distanceBand:
      distance === 'under_1_km' ||
      distance === '1_3_km' ||
      distance === '3_8_km' ||
      distance === '8_15_km'
        ? distance
        : null,
    isHost: raw.is_host === true,
    membershipStatus:
      membership === 'pending' ||
      membership === 'approved' ||
      membership === 'rejected' ||
      membership === 'cancelled' ||
      membership === 'left'
        ? membership
        : null,
    exactAddress: typeof raw.exact_address === 'string' ? raw.exact_address : null,
    joinRequests: Array.isArray(raw.join_requests)
      ? raw.join_requests.map((item) => {
          const request = item as Record<string, unknown>;
          return {
            id: typeof request.id === 'string' ? request.id : '',
            account: profile(request.account as Record<string, unknown> | undefined),
            message: typeof request.message === 'string' ? request.message : '',
            status:
              request.status === 'approved' ? 'approved' : 'pending',
            requestedAt: typeof request.requested_at === 'string' ? request.requested_at : '',
          };
        })
      : [],
  };
}

async function request(path: string, options: RequestOptions = {}) {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint) return { ok: false as const, code: 'offline', detail: 'Server teď není dostupný.' };
  const session = await ensureAccount(options.signal);
  if (!session?.authenticated) {
    return { ok: false as const, code: 'auth', detail: 'Pro domácí setkání se nejdřív přihlas.' };
  }
  const abort = chainAbortSignal(options.signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: abort.signal,
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (response.ok) return { ok: true as const, data };
    return {
      ok: false as const,
      code: typeof data.code === 'string' ? data.code : `http_${response.status}`,
      detail: typeof data.detail === 'string' ? data.detail : 'Tohle se teď nepovedlo.',
    };
  } catch (error) {
    trackApiFailure('community_events_request', { endpoint: path, reason: 'exception', error });
    return { ok: false as const, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' };
  } finally {
    abort.cleanup();
  }
}

export async function fetchCommunityEvents(
  location?: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<{ ok: true; dashboard: CommunityEventsDashboard } | Exclude<CommunityActionResult, { ok: true }>> {
  const result = location
    ? await request('/v1/community-events/discover', {
        method: 'POST',
        body: { lat: location.lat, lng: location.lng },
        signal,
      })
    : await request('/v1/community-events', { signal });
  if (!result.ok) return result;
  const list = (key: string) =>
    Array.isArray(result.data[key])
      ? (result.data[key] as unknown[]).map(parseEvent).filter((event): event is CommunityEvent => event != null)
      : [];
  return { ok: true, dashboard: { nearby: list('nearby'), hosted: list('hosted'), joined: list('joined') } };
}

export async function createCommunityEvent(input: {
  clientId: string;
  title: string;
  description: string;
  city: string;
  areaLabel: string;
  exactAddress: string;
  lat: number;
  lng: number;
  startsAt: string;
  endsAt: string;
  capacity: number;
}): Promise<CommunityActionResult> {
  const result = await request('/v1/community-events', {
    method: 'POST',
    body: {
      client_id: input.clientId,
      title: input.title,
      description: input.description,
      city: input.city,
      area_label: input.areaLabel,
      exact_address: input.exactAddress,
      lat: input.lat,
      lng: input.lng,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      capacity: input.capacity,
      adults_confirmed: true,
    },
  });
  if (!result.ok) return result;
  const event = parseEvent(result.data);
  return event ? { ok: true, event } : { ok: false, code: 'invalid_response', detail: 'Server poslal neúplná data.' };
}

export async function requestCommunityEventJoin(eventId: string, message = ''): Promise<CommunityActionResult> {
  const result = await request(`/v1/community-events/${eventId}/join`, {
    method: 'POST',
    body: { message, adults_confirmed: true },
  });
  return result.ok ? { ok: true } : result;
}

export async function leaveCommunityEvent(eventId: string): Promise<CommunityActionResult> {
  const result = await request(`/v1/community-events/${eventId}/join`, { method: 'DELETE' });
  return result.ok ? { ok: true } : result;
}

export async function decideCommunityJoinRequest(
  eventId: string,
  requestId: string,
  action: 'approve' | 'reject',
): Promise<CommunityActionResult> {
  const result = await request(`/v1/community-events/${eventId}/requests/${requestId}/${action}`, {
    method: 'POST',
  });
  return result.ok ? { ok: true } : result;
}

export async function cancelCommunityEvent(eventId: string): Promise<CommunityActionResult> {
  const result = await request(`/v1/community-events/${eventId}/cancel`, { method: 'POST' });
  return result.ok ? { ok: true } : result;
}

export async function reportCommunityEvent(eventId: string): Promise<CommunityActionResult> {
  const result = await request(`/v1/community-events/${eventId}/report`, {
    method: 'POST',
    body: { reason: 'other', comment: 'Nahlášeno z přehledu komunitních setkání.' },
  });
  return result.ok ? { ok: true } : result;
}
