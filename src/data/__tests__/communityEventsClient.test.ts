import {
  createCommunityEventTeam,
  createCommunityEvent,
  decideCommunityJoinRequest,
  fetchCommunityEvent,
  fetchCommunityEventTeams,
  fetchCommunityEvents,
  joinCommunityEventTeam,
  leaveCommunityEventTeam,
  requestCommunityEventJoin,
} from '../communityEventsClient';
import { ensureAccount } from '../account';

jest.mock('../account', () => ({ ensureAccount: jest.fn() }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const RAW_EVENT = {
  id: 'event-1',
  host: { id: 'host-1', nickname: 'host', display_name: 'Host' },
  title: 'Pivo a deskovky',
  description: 'Komorní večer.',
  city: 'Praha',
  area_label: 'Vinohrady',
  starts_at: '2026-07-20T18:00:00.000Z',
  ends_at: '2026-07-20T22:00:00.000Z',
  capacity: 6,
  available_spots: 5,
  adults_only: true,
  status: 'upcoming',
  distance_band: '1_3_km',
  is_host: false,
  membership_status: null,
  exact_address: null,
};

const RAW_TEAM = {
  id: 'team-1',
  name: 'Chmelouni',
  capacity: 4,
  member_count: 2,
  available_spots: 2,
  is_mine: true,
  created_at: '2026-07-20T16:00:00.000Z',
  members: [
    {
      account: {
        id: 'account',
        nickname: 'tomas',
        display_name: 'Tomáš',
        avatar_url: 'https://cdn.example.com/tomas.jpg',
      },
      joined_at: '2026-07-20T16:01:00.000Z',
    },
    {
      account: { id: 'host-1', nickname: 'host', display_name: 'Host', avatar_url: null },
      joined_at: '2026-07-20T16:02:00.000Z',
    },
  ],
};

const RAW_ROSTER = {
  max_team_size: 4,
  participant_count: 3,
  assigned_count: 2,
  unassigned_count: 1,
  my_team_id: 'team-1',
  teams: [RAW_TEAM],
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  (ensureAccount as jest.Mock).mockResolvedValue({
    deviceId: 'device',
    accountId: 'account',
    token: 'secret',
    authenticated: true,
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  jest.clearAllMocks();
});

describe('community events client', () => {
  it('parses coarse discovery without inventing a private address', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ nearby: [RAW_EVENT], hosted: [], joined: [] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchCommunityEvents({ lat: 50.075123, lng: 14.438765 });

    expect(result).toMatchObject({
      ok: true,
      dashboard: {
        nearby: [{ areaLabel: 'Vinohrady', distanceBand: '1_3_km', exactAddress: null }],
      },
    });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/community-events/discover');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ lat: 50.075123, lng: 14.438765 });
  });

  it('sends exact location only in the explicit host-create request', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ ...RAW_EVENT, is_host: true, exact_address: 'Testovací 12' }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createCommunityEvent({
      clientId: 'client-1',
      title: 'Pivo a deskovky',
      description: 'Komorní večer.',
      city: 'Praha',
      areaLabel: 'Vinohrady',
      exactAddress: 'Testovací 12',
      lat: 50.0755,
      lng: 14.4378,
      startsAt: '2026-07-20T18:00:00.000Z',
      endsAt: '2026-07-20T22:00:00.000Z',
      capacity: 6,
    });

    expect(result).toMatchObject({ ok: true, event: { exactAddress: 'Testovací 12' } });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      exact_address: 'Testovací 12',
      lat: 50.0755,
      lng: 14.4378,
      adults_confirmed: true,
    });
  });

  it('requires a claimed session and preserves a server safety error', async () => {
    (ensureAccount as jest.Mock).mockResolvedValueOnce({
      token: 'anonymous',
      authenticated: false,
    });
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(requestCommunityEventJoin('event-1')).resolves.toMatchObject({
      ok: false,
      code: 'auth',
    });
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ code: 'capacity_full', detail: 'Kapacita je plná.' }),
    })) as unknown as typeof fetch;
    await expect(requestCommunityEventJoin('event-1')).resolves.toEqual({
      ok: false,
      code: 'capacity_full',
      detail: 'Kapacita je plná.',
    });
  });

  it('parses the private team roster and host requests only when the detail returns them', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ...RAW_EVENT,
        is_host: true,
        exact_address: 'Testovací 12',
        team_roster: RAW_ROSTER,
        join_requests: [
          {
            id: 'request-1',
            account: { id: 'guest-1', nickname: 'jana', display_name: 'Jana' },
            message: 'Beru karty.',
            status: 'pending',
            requested_at: '2026-07-20T15:00:00.000Z',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await fetchCommunityEvent('event-1');

    expect(result).toMatchObject({
      ok: true,
      event: {
        exactAddress: 'Testovací 12',
        joinRequests: [{ id: 'request-1', account: { nickname: 'jana' }, status: 'pending' }],
        teamRoster: {
          maxTeamSize: 4,
          participantCount: 3,
          assignedCount: 2,
          unassignedCount: 1,
          myTeamId: 'team-1',
          teams: [
            {
              id: 'team-1',
              name: 'Chmelouni',
              memberCount: 2,
              availableSpots: 2,
              isMine: true,
              members: [{ account: { nickname: 'tomas' } }, { account: { nickname: 'host' } }],
            },
          ],
        },
      },
    });
  });

  it('loads teams through their participant-only endpoint', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(RAW_ROSTER),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(fetchCommunityEventTeams('event-1')).resolves.toMatchObject({
      ok: true,
      roster: { myTeamId: 'team-1', teams: [{ name: 'Chmelouni' }] },
    });
    expect((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      'https://api.example.com/v1/community-events/event-1/teams',
    );
  });

  it('creates, joins, and leaves a team with the retry-stable client id', async () => {
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ created: true, team: RAW_TEAM, team_roster: RAW_ROSTER }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ joined: false, team: RAW_TEAM, team_roster: RAW_ROSTER }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          left: true,
          team_roster: { ...RAW_ROSTER, my_team_id: null },
        }),
      });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      createCommunityEventTeam('event-1', { clientId: 'client-1', name: 'Chmelouni' }),
    ).resolves.toMatchObject({ ok: true, created: true, team: { id: 'team-1' } });
    await expect(joinCommunityEventTeam('event-1', 'team-1')).resolves.toMatchObject({
      ok: true,
      joined: false,
    });
    await expect(leaveCommunityEventTeam('event-1', 'team-1')).resolves.toMatchObject({
      ok: true,
      left: true,
      roster: { myTeamId: null },
    });

    const [createUrl, createInit] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(createUrl).toBe('https://api.example.com/v1/community-events/event-1/teams');
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body as string)).toEqual({ client_id: 'client-1', name: 'Chmelouni' });
    expect((fetchSpy.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe('POST');
    expect((fetchSpy.mock.calls[2] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('preserves capacity errors from moderation and rejects incomplete team payloads', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ code: 'capacity_full', detail: 'Kapacita je plná.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ created: true, team: RAW_TEAM }),
      }) as unknown as typeof fetch;

    await expect(decideCommunityJoinRequest('event-1', 'request-1', 'approve')).resolves.toEqual({
      ok: false,
      code: 'capacity_full',
      detail: 'Kapacita je plná.',
    });
    await expect(
      createCommunityEventTeam('event-1', { clientId: 'client-1', name: 'Chmelouni' }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_response' });
  });
});
