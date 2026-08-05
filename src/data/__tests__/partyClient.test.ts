/**
 * Tests for the party-evening client (src/data/partyClient.ts).
 *
 * Two things are worth pinning down. The join code, because it is read out loud
 * across a loud table and the server's own regex is stricter than "six
 * characters". And the failure shapes, because the UI has to say something
 * specific when you are already sitting at another table — "zkus to znovu" is
 * useless advice for a conflict that will never resolve itself.
 */

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

import {
  createPartyEvening,
  fetchCurrentPartyEvening,
  generateJoinCode,
  joinPartyEvening,
  leavePartyEvening,
} from '../partyClient';

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
    await createPartyEvening({ clientId: 'c-1', joinCode: 'pivoxy', pubName: 'U Fleků' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ client_id: 'c-1', join_code: 'PIVOXY', pub_name: 'U Fleků' });
  });

  it('survives a pub with no signal', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
    const result = await fetchCurrentPartyEvening();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('network');
  });
});
