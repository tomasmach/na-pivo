/**
 * Tests for the party-evening client (src/data/partyClient.ts).
 *
 * Two things are worth pinning down. The join code, because it is read out loud
 * across a loud table and the server's own regex is stricter than "six
 * characters". And the failure shapes, because the UI has to say something
 * specific when you are already sitting at another table — "zkus to znovu" is
 * useless advice for a conflict that will never resolve itself.
 */

import {
  createPartyEvening,
  fetchCurrentPartyEvening,
  fetchPartyEveningHistory,
  fetchPartyNightRecord,
  generateJoinCode,
  isRetriablePartyError,
  joinPartyEvening,
  leavePartyEvening,
  parsePartyNightRecord,
} from '../partyClient';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 'tok', accountId: 'a' })),
  generateUuidV4: () => 'uuid-1',
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `https://example.test${path}`,
}));
jest.mock('../apiFetch', () => ({
  ...jest.requireActual('../apiFetch'),
  classifyQueueHttpFailure: jest.fn(async () => 'retry'),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

const EVENING = {
  id: 'e1',
  join_code: 'PIVOXY',
  join_url: 'https://na-pivo.cz/party/PIVOXY',
  host: { id: 'h', nickname: 'honza', display_name: 'Honza' },
  pub_name: 'U Fleků',
  pub_city: 'Praha',
  active: true,
  started_at: '2026-08-05T18:00:00Z',
  ended_at: null,
  is_host: true,
  members: [{ id: 'h', nickname: 'honza', display_name: 'Honza' }],
  events: [],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generateJoinCode', () => {
  it('is six characters the server will accept', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateJoinCode()).toMatch(/^[A-Z2-9]{6}$/);
    }
  });

  it('leaves out the characters a table argues about', () => {
    // Read across a pub, O/0, I/1/L and S/5 are the same character.
    const codes = Array.from({ length: 200 }, () => generateJoinCode()).join('');

    expect(codes).not.toMatch(/[OILSZ015]/);
  });
});

describe('isRetriablePartyError', () => {
  it('keeps a durable action queued while credentials are being restored', () => {
    expect(isRetriablePartyError({ ok: false, code: 'auth', detail: 'Přihlas se.' })).toBe(true);
    expect(isRetriablePartyError({ ok: false, code: 'not_host', detail: 'Jen hostitel.' })).toBe(false);
  });
});

describe('partyClient', () => {
  it('reports no evening rather than an error when there is none', async () => {
    respond(200, { evening: null });
    const result = await fetchCurrentPartyEvening();

    expect(result).toEqual({ ok: true, evening: null });
  });

  it('parses the evening the phone is in', async () => {
    respond(200, { evening: EVENING });
    const result = await fetchCurrentPartyEvening();

    expect(result.ok && result.evening?.joinCode).toBe('PIVOXY');
    expect(result.ok && result.evening?.members[0].displayName).toBe('Honza');
  });

  it('preserves leave events instead of turning them into another join', async () => {
    respond(200, {
      evening: {
        ...EVENING,
        events: [
          {
            id: 'left:membership-1',
            kind: 'left',
            at: '2026-08-05T19:00:00Z',
            account: EVENING.host,
          },
          {
            id: 'future:event-1',
            kind: 'future-event',
            at: '2026-08-05T19:01:00Z',
            account: EVENING.host,
          },
        ],
      },
    });

    const result = await fetchCurrentPartyEvening();

    expect(result.ok && result.evening?.events.map((event) => event.kind)).toEqual(['left']);
  });

  it('fetches bounded ended history for cross-device recap recovery', async () => {
    respond(200, {
      evenings: [
        {
          id: 'ended-1',
          join_code: 'PIVOXY',
          pub_name: 'U Fleků',
          pub_city: 'Praha',
          started_at: '2026-08-05T18:00:00Z',
          ended_at: '2026-08-05T22:00:00Z',
          is_host: false,
        },
        { id: 'broken', join_code: null },
      ],
      truncated: true,
    });

    const result = await fetchPartyEveningHistory();

    expect(result).toEqual({
      ok: true,
      evenings: [
        {
          id: 'ended-1',
          joinCode: 'PIVOXY',
          pubName: 'U Fleků',
          pubCity: 'Praha',
          startedAt: '2026-08-05T18:00:00Z',
          endedAt: '2026-08-05T22:00:00Z',
          isHost: false,
        },
      ],
      truncated: true,
    });
    expect(mockFetch.mock.calls[0][0]).toContain('/party-evenings/history');
  });

  it('keeps the server code when you are already at another table', async () => {
    // The UI has to say "odejdi z toho druhého" — a retry never fixes this.
    respond(409, {
      detail: 'Leave the active party evening before joining another.',
      code: 'active_party_membership_exists',
    });
    const result = await joinPartyEvening('pivoxy');

    expect(result).toEqual({
      ok: false,
      code: 'active_party_membership_exists',
      detail: 'Leave the active party evening before joining another.',
    });
  });

  it('says a code nobody is using is not a table', async () => {
    respond(404, {});
    const result = await joinPartyEvening('ZZZZZZ');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('party_not_found');
  });

  it('upper-cases a code somebody typed in lower case', async () => {
    respond(200, EVENING);
    await joinPartyEvening('pivoxy');

    expect(mockFetch.mock.calls[0][0]).toContain('/party-evenings/PIVOXY/join');
  });

  it('leaves without ending, which is a DELETE on the same door', async () => {
    respond(204, {});
    const result = await leavePartyEvening('PIVOXY');

    expect(result).toEqual({ ok: true });
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('sends the client id so a retry does not start a second evening', async () => {
    respond(201, EVENING);
    await createPartyEvening({
      clientId: 'c-1',
      joinCode: 'pivoxy',
      pubName: 'U Fleků',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      client_id: 'c-1',
      join_code: 'PIVOXY',
      pub_name: 'U Fleků',
    });
  });

  it('survives a pub with no signal', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
    const result = await fetchCurrentPartyEvening();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('network');
  });

  it('parses the private record and puts this phone first', () => {
    const record = parsePartyNightRecord(
      {
        id: 'night-1',
        code: 'PIVOXY',
        started_at: '2026-08-05T18:00:00Z',
        ended_at: null,
        participants: [
          {
            id: 'friend',
            nickname: 'honza',
            display_name: 'Honza',
            joined_at: '2026-08-05T18:00:00Z',
          },
          {
            id: 'a',
            nickname: 'tomas',
            display_name: 'Tomáš',
            joined_at: '2026-08-05T18:01:00Z',
          },
        ],
        stops: [
          {
            id: 'stop-1',
            pub_name: 'U Fleků',
            cache_key: 'u2fkbn0r',
            arrived_at: '2026-08-05T18:00:00Z',
          },
        ],
        drinks: [
          {
            id: 'drink-1',
            at: '2026-08-05T18:30:00Z',
            by: 'a',
            beer_name: 'Flekovský',
            drink_type: 'beer',
            volume_ml: 500,
            stop_id: 'stop-1',
          },
        ],
        games: [
          {
            key: 'quiz',
            name: 'Pub kvíz',
            started_at: '2026-08-05T19:00:00Z',
            result: { winner: 'Tomáš', scores: [{ name: 'Tomáš', score: 7 }] },
          },
        ],
        photos: [
          {
            id: 'photo-1',
            url: 'https://example.test/photo.jpg',
            at: '2026-08-05T18:45:00Z',
            by: 'friend',
          },
          {
            id: 'photo-broken',
            url: null,
            at: '2026-08-05T18:46:00Z',
            by: 'friend',
          },
        ],
      },
      'a',
    );

    expect(record.people.map((person) => person.id)).toEqual(['a', 'friend']);
    expect(record.drinks[0]).toMatchObject({
      id: 'drink-1',
      drinkType: 'beer',
      volumeMl: 500,
    });
    expect(record.games[0].result?.scores).toEqual([{ name: 'Tomáš', score: 7 }]);
    expect(record.photos).toHaveLength(1);
    expect(record.stops[0]).not.toHaveProperty('lat');
  });

  it('fetches the record through the members-only endpoint', async () => {
    respond(200, {
      id: 'night-1',
      code: 'PIVOXY',
      started_at: '2026-08-05T18:00:00Z',
      participants: [],
      stops: [],
      drinks: [],
      games: [],
      photos: [],
    });

    const result = await fetchPartyNightRecord('pivoxy', 'a');

    expect(result.ok && result.record.code).toBe('PIVOXY');
    expect(mockFetch.mock.calls[0][0]).toContain('/party-evenings/PIVOXY/record');
  });
});
