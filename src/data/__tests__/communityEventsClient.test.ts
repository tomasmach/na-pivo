import {
  cancelCommunityEvent,
  createCommunityEventTeam,
  createCommunityEvent,
  decideCommunityJoinRequest,
  fetchCommunityEvent,
  fetchCommunityEventTeams,
  fetchCommunityEvents,
  joinCommunityEventTeam,
  leaveCommunityEvent,
  leaveCommunityEventTeam,
  reportCommunityEvent,
  requestCommunityEventJoin,
} from '../communityEventsClient';
import { ensureAccount } from '../account';
import {
  clearUgcConsentStateForTests,
  CURRENT_UGC_POLICY_VERSION,
  subscribeUgcConsentRequired,
  UGC_POLICY_HEADER,
} from '../ugcConsent';

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

const CREATE_EVENT_INPUT = {
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
};

function jsonResponse(ok: boolean, status: number, body: string) {
  return { ok, status, text: async () => body };
}

function jsonOk(body: unknown) {
  return jsonResponse(true, 200, JSON.stringify(body));
}

type StubResponse = { ok: boolean; status: number; text: () => Promise<string> };

function headerRecorder(
  respond: (url: RequestInfo | URL) => StubResponse | Promise<StubResponse>,
) {
  const headers: Record<string, unknown>[] = [];
  const bodies: unknown[] = [];
  const spy = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    headers.push((init?.headers ?? {}) as Record<string, unknown>);
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
    return respond(_url);
  });
  return { spy, headers, bodies };
}

beforeEach(() => {
  clearUgcConsentStateForTests();
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
  clearUgcConsentStateForTests();
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

  describe('ugc gating', () => {
    it('sends the UGC policy header exactly on the three authored actions', async () => {
      const first = headerRecorder(() => jsonOk(RAW_EVENT));
      global.fetch = first.spy as unknown as typeof fetch;
      await createCommunityEvent(CREATE_EVENT_INPUT);

      const second = headerRecorder(() => jsonOk({}));
      global.fetch = second.spy as unknown as typeof fetch;
      await requestCommunityEventJoin('event-1', 'Beru karty.');

      const third = headerRecorder(() =>
        jsonOk({ created: true, team: RAW_TEAM, team_roster: RAW_ROSTER }),
      );
      global.fetch = third.spy as unknown as typeof fetch;
      await createCommunityEventTeam('event-1', { clientId: 'client-1', name: 'Chmelouni' });

      for (const recorder of [first, second, third]) {
        expect(recorder.spy).toHaveBeenCalledTimes(1);
        expect(recorder.headers[0][UGC_POLICY_HEADER]).toBe(CURRENT_UGC_POLICY_VERSION);
      }
      expect(second.bodies[0]).toEqual({ message: 'Beru karty.', adults_confirmed: true });
    });

    it('keeps reads and ungated mutations free of the UGC policy header', async () => {
      const recorder = headerRecorder(async (url) => {
        const target = String(url);
        if (target.endsWith('/discover')) {
          return jsonOk({ nearby: [RAW_EVENT], hosted: [], joined: [] });
        }
        if (/\/v1\/community-events$/.test(target)) {
          return jsonOk({ nearby: [], hosted: [], joined: [] });
        }
        if (/\/teams\/[^/]+\/join$/.test(target)) {
          return jsonOk({ joined: false, team: RAW_TEAM, team_roster: RAW_ROSTER });
        }
        if (target.endsWith('/teams')) return jsonOk(RAW_ROSTER);
        return jsonOk(RAW_EVENT);
      });
      global.fetch = recorder.spy as unknown as typeof fetch;

      await fetchCommunityEvent('event-1');
      await fetchCommunityEventTeams('event-1');
      await fetchCommunityEvents({ lat: 50.0755, lng: 14.4378 });
      await fetchCommunityEvents();
      await requestCommunityEventJoin('event-1');
      await requestCommunityEventJoin('event-1', '   ');
      await decideCommunityJoinRequest('event-1', 'request-1', 'approve');
      await decideCommunityJoinRequest('event-1', 'request-1', 'reject');
      await joinCommunityEventTeam('event-1', 'team-1');
      await leaveCommunityEventTeam('event-1', 'team-1');
      await leaveCommunityEvent('event-1');
      await cancelCommunityEvent('event-1');
      await reportCommunityEvent('event-1');

      expect(recorder.spy).toHaveBeenCalledTimes(13);
      for (const headers of recorder.headers) {
        expect(headers[UGC_POLICY_HEADER]).toBeUndefined();
      }
      expect(recorder.bodies).toContainEqual({ message: '', adults_confirmed: true });
      expect(recorder.bodies).toContainEqual({ message: '   ', adults_confirmed: true });
    });

    it('notifies consent listeners exactly once for semantic 428 on gated actions', async () => {
      const seen: string[] = [];
      const unsubscribe = subscribeUgcConsentRequired(({ code }) => seen.push(code));

      global.fetch = jest.fn(async () =>
        jsonResponse(
          false,
          428,
          JSON.stringify({ code: 'ugc_consent_required', detail: 'Nejdřív potvrď pravidla.' }),
        ),
      ) as unknown as typeof fetch;
      await expect(requestCommunityEventJoin('event-1', 'Beru karty.')).resolves.toEqual({
        ok: false,
        code: 'ugc_consent_required',
        detail: 'Nejdřív potvrď pravidla.',
      });

      global.fetch = jest.fn(async () =>
        jsonResponse(
          false,
          428,
          JSON.stringify({ code: 'ugc_policy_update_required', detail: 'Potvrď nová pravidla.' }),
        ),
      ) as unknown as typeof fetch;
      await expect(createCommunityEvent(CREATE_EVENT_INPUT)).resolves.toEqual({
        ok: false,
        code: 'ugc_policy_update_required',
        detail: 'Potvrď nová pravidla.',
      });

      unsubscribe();
      expect(seen).toEqual(['ugc_consent_required', 'ugc_policy_update_required']);
    });

    it('keeps a stable http_428 result and stays silent for malformed or bare payloads', async () => {
      const seen: string[] = [];
      const unsubscribe = subscribeUgcConsentRequired(({ code }) => seen.push(code));

      global.fetch = jest.fn(async () => jsonResponse(false, 428, '{nope')) as unknown as typeof fetch;
      await expect(requestCommunityEventJoin('event-1', 'Beru karty.')).resolves.toEqual({
        ok: false,
        code: 'http_428',
        detail: 'Tohle se teď nepovedlo.',
      });

      global.fetch = jest.fn(async () => jsonResponse(false, 428, '')) as unknown as typeof fetch;
      await expect(
        createCommunityEventTeam('event-1', { clientId: 'client-1', name: 'Chmelouni' }),
      ).resolves.toEqual({ ok: false, code: 'http_428', detail: 'Tohle se teď nepovedlo.' });

      global.fetch = jest.fn(async () =>
        jsonResponse(false, 428, JSON.stringify({ detail: 'bez kodu' })),
      ) as unknown as typeof fetch;
      await expect(createCommunityEvent(CREATE_EVENT_INPUT)).resolves.toEqual({
        ok: false,
        code: 'http_428',
        detail: 'bez kodu',
      });

      unsubscribe();
      expect(seen).toEqual([]);
    });

    it('returns the same semantic 428 result on ungated actions without notifying', async () => {
      const seen: string[] = [];
      const unsubscribe = subscribeUgcConsentRequired(({ code }) => seen.push(code));
      global.fetch = jest.fn(async () =>
        jsonResponse(
          false,
          428,
          JSON.stringify({ code: 'ugc_consent_required', detail: 'Nejdřív potvrď pravidla.' }),
        ),
      ) as unknown as typeof fetch;

      await expect(leaveCommunityEvent('event-1')).resolves.toEqual({
        ok: false,
        code: 'ugc_consent_required',
        detail: 'Nejdřív potvrď pravidla.',
      });
      await expect(reportCommunityEvent('event-1')).resolves.toEqual({
        ok: false,
        code: 'ugc_consent_required',
        detail: 'Nejdřív potvrď pravidla.',
      });

      unsubscribe();
      expect(seen).toEqual([]);
    });

    it('reads the non-ok body exactly once', async () => {
      const text = jest.fn(async () =>
        JSON.stringify({ code: 'ugc_consent_required', detail: 'Nejdřív potvrď pravidla.' }),
      );
      global.fetch = jest.fn(async () => ({ ok: false, status: 428, text })) as unknown as typeof fetch;

      await requestCommunityEventJoin('event-1', 'Beru karty.');
      expect(text).toHaveBeenCalledTimes(1);
    });

    it('returns the exact network result when a successful join body is malformed', async () => {
      const text = jest.fn(async () => '{nope');
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, text })) as unknown as typeof fetch;

      await expect(requestCommunityEventJoin('event-1')).resolves.toEqual({
        ok: false,
        code: 'network',
        detail: 'Síť se netváří. Zkus to za chvíli.',
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(text).toHaveBeenCalledTimes(1);
    });

    it('returns the same network result when reading a successful body rejects', async () => {
      const text = jest.fn(async () => {
        throw new Error('stream gone');
      });
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, text })) as unknown as typeof fetch;

      await expect(requestCommunityEventJoin('event-1')).resolves.toEqual({
        ok: false,
        code: 'network',
        detail: 'Síť se netváří. Zkus to za chvíli.',
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(text).toHaveBeenCalledTimes(1);
    });

    it('turns an account lookup failure into the network result without fetching', async () => {
      (ensureAccount as jest.Mock).mockRejectedValueOnce(new Error('account boom'));
      global.fetch = jest.fn() as unknown as typeof fetch;

      await expect(requestCommunityEventJoin('event-1', 'Beru karty.')).resolves.toEqual({
        ok: false,
        code: 'network',
        detail: 'Síť se netváří. Zkus to za chvíli.',
      });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(ensureAccount).toHaveBeenCalledTimes(1);
    });
  });
});
