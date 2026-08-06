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

export interface CommunityEventTeamMember {
  account: CommunityEventProfile;
  joinedAt: string;
}

export interface CommunityEventTeam {
  id: string;
  name: string;
  capacity: number;
  memberCount: number;
  availableSpots: number;
  isMine: boolean;
  members: CommunityEventTeamMember[];
  createdAt: string;
}

export interface CommunityEventTeamRoster {
  maxTeamSize: number;
  participantCount: number;
  assignedCount: number;
  unassignedCount: number;
  myTeamId: string | null;
  teams: CommunityEventTeam[];
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
  teamRoster: CommunityEventTeamRoster | null;
}

export interface CommunityEventsDashboard {
  nearby: CommunityEvent[];
  hosted: CommunityEvent[];
  joined: CommunityEvent[];
}

export type CommunityActionResult =
  | { ok: true; event?: CommunityEvent }
  | { ok: false; code: string; detail: string };

export type CommunityTeamRosterResult =
  | { ok: true; roster: CommunityEventTeamRoster }
  | Exclude<CommunityActionResult, { ok: true }>;

export type CommunityTeamMutationResult =
  | {
      ok: true;
      roster: CommunityEventTeamRoster;
      team?: CommunityEventTeam;
      created?: boolean;
      joined?: boolean;
      left?: boolean;
    }
  | Exclude<CommunityActionResult, { ok: true }>;

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

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseTeam(value: unknown): CommunityEventTeam | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const capacity = nonNegativeInteger(raw.capacity);
  const memberCount = nonNegativeInteger(raw.member_count);
  const availableSpots = nonNegativeInteger(raw.available_spots);
  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    capacity === null ||
    memberCount === null ||
    availableSpots === null ||
    !Array.isArray(raw.members)
  ) return null;
  const members = raw.members.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const member = value as Record<string, unknown>;
    const account = profile(member.account as Record<string, unknown> | undefined);
    if (!account.id) return [];
    return [{ account, joinedAt: typeof member.joined_at === 'string' ? member.joined_at : '' }];
  });
  return {
    id: raw.id,
    name: raw.name,
    capacity,
    memberCount,
    availableSpots,
    isMine: raw.is_mine === true,
    members,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
  };
}

function parseTeamRoster(value: unknown): CommunityEventTeamRoster | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const maxTeamSize = nonNegativeInteger(raw.max_team_size);
  const participantCount = nonNegativeInteger(raw.participant_count);
  const assignedCount = nonNegativeInteger(raw.assigned_count);
  const unassignedCount = nonNegativeInteger(raw.unassigned_count);
  if (
    maxTeamSize === null ||
    participantCount === null ||
    assignedCount === null ||
    unassignedCount === null ||
    (raw.my_team_id !== null && typeof raw.my_team_id !== 'string') ||
    !Array.isArray(raw.teams)
  ) return null;
  const teams = raw.teams.map(parseTeam);
  if (teams.some((team) => team === null)) return null;
  return {
    maxTeamSize,
    participantCount,
    assignedCount,
    unassignedCount,
    myTeamId: typeof raw.my_team_id === 'string' ? raw.my_team_id : null,
    teams: teams as CommunityEventTeam[],
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
    teamRoster: parseTeamRoster(raw.team_roster),
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

export async function fetchCommunityEvent(
  eventId: string,
  signal?: AbortSignal,
): Promise<{ ok: true; event: CommunityEvent } | Exclude<CommunityActionResult, { ok: true }>> {
  const result = await request(`/v1/community-events/${encodeURIComponent(eventId)}`, { signal });
  if (!result.ok) return result;
  const event = parseEvent(result.data);
  return event
    ? { ok: true, event }
    : { ok: false, code: 'invalid_response', detail: 'Server poslal neúplná data.' };
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

export async function fetchCommunityEventTeams(
  eventId: string,
  signal?: AbortSignal,
): Promise<CommunityTeamRosterResult> {
  const result = await request(`/v1/community-events/${encodeURIComponent(eventId)}/teams`, { signal });
  if (!result.ok) return result;
  const roster = parseTeamRoster(result.data);
  return roster
    ? { ok: true, roster }
    : { ok: false, code: 'invalid_response', detail: 'Server poslal neúplná data.' };
}

export async function createCommunityEventTeam(
  eventId: string,
  input: { clientId: string; name: string },
): Promise<CommunityTeamMutationResult> {
  const result = await request(`/v1/community-events/${encodeURIComponent(eventId)}/teams`, {
    method: 'POST',
    body: { client_id: input.clientId, name: input.name },
  });
  if (!result.ok) return result;
  const roster = parseTeamRoster(result.data.team_roster);
  const team = parseTeam(result.data.team);
  if (!roster || !team) {
    return { ok: false, code: 'invalid_response', detail: 'Server poslal neúplná data.' };
  }
  return { ok: true, roster, team, created: result.data.created === true };
}

export async function joinCommunityEventTeam(
  eventId: string,
  teamId: string,
): Promise<CommunityTeamMutationResult> {
  const result = await request(
    `/v1/community-events/${encodeURIComponent(eventId)}/teams/${encodeURIComponent(teamId)}/join`,
    { method: 'POST' },
  );
  if (!result.ok) return result;
  const roster = parseTeamRoster(result.data.team_roster);
  const team = parseTeam(result.data.team);
  if (!roster || !team) {
    return { ok: false, code: 'invalid_response', detail: 'Server poslal neúplná data.' };
  }
  return { ok: true, roster, team, joined: result.data.joined === true };
}

export async function leaveCommunityEventTeam(
  eventId: string,
  teamId: string,
): Promise<CommunityTeamMutationResult> {
  const result = await request(
    `/v1/community-events/${encodeURIComponent(eventId)}/teams/${encodeURIComponent(teamId)}/join`,
    { method: 'DELETE' },
  );
  if (!result.ok) return result;
  const roster = parseTeamRoster(result.data.team_roster);
  if (!roster) {
    return { ok: false, code: 'invalid_response', detail: 'Server poslal neúplná data.' };
  }
  return { ok: true, roster, left: result.data.left === true };
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
