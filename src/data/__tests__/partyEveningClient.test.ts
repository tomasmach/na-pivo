import {
  createPartyEvening,
  fetchCurrentPartyEvening,
  sharePartyEveningDrink,
} from '../friendsClient';
import { ensureAccount } from '../account';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => true),
  generateUuidV4: jest.fn(() => 'generated-id'),
}));

jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const RAW_EVENING = {
  id: 'evening-1',
  join_code: 'STUL24',
  join_url: 'https://na-pivo.cz/party/STUL24',
  host: { id: 'host-1', nickname: 'host', display_name: 'Host' },
  pub_name: 'U Testu',
  pub_city: 'Praha',
  active: true,
  started_at: '2026-07-19T18:00:00.000Z',
  ended_at: null,
  is_host: true,
  members: [{ id: 'host-1', nickname: 'host' }],
  events: [
    {
      id: 'drink:1',
      kind: 'drink',
      at: '2026-07-19T18:05:00.000Z',
      account: { id: 'host-1', nickname: 'host' },
      beer_name: 'Plzeň',
      quantity: 2,
    },
  ],
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  (ensureAccount as jest.Mock).mockResolvedValue({
    deviceId: 'device',
    accountId: 'account',
    token: 'secret',
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  jest.clearAllMocks();
});

describe('party evening client', () => {
  it('parses the explicit member and chronological drink feed', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ evening: RAW_EVENING }),
    })) as unknown as typeof fetch;

    const result = await fetchCurrentPartyEvening();

    expect(result).toMatchObject({
      ok: true,
      evening: {
        joinCode: 'STUL24',
        pubName: 'U Testu',
        members: [{ id: 'host-1', nickname: 'host' }],
        events: [{ kind: 'drink', beerName: 'Plzeň', quantity: 2 }],
      },
    });
  });

  it('creates an evening without sending location or private diary data', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify(RAW_EVENING),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await createPartyEvening({
      clientId: 'client-1',
      joinCode: 'STUL24',
      pubName: 'U Testu',
      pubCity: 'Praha',
      startedAt: '2026-07-19T18:00:00.000Z',
    });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/party-evenings');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: 'client-1',
      join_code: 'STUL24',
      pub_name: 'U Testu',
      pub_city: 'Praha',
      started_at: '2026-07-19T18:00:00.000Z',
    });
  });

  it('shares only the explicitly supplied drink and preserves machine errors', async () => {
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => '{}' })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ detail: 'Skryto.', code: 'ghost_mode' }),
      });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      sharePartyEveningDrink('STUL24', {
        clientId: 'drink-1',
        beerName: 'Kozel',
        quantity: 1,
        sharedAt: '2026-07-19T18:10:00.000Z',
      }),
    ).resolves.toEqual({ ok: true });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string)).toEqual({
      client_id: 'drink-1',
      beer_name: 'Kozel',
      quantity: 1,
      shared_at: '2026-07-19T18:10:00.000Z',
    });

    await expect(
      sharePartyEveningDrink('STUL24', { clientId: 'drink-2', beerName: 'Kozel' }),
    ).resolves.toEqual({ ok: false, code: 'ghost_mode', detail: 'Skryto.' });
  });
});
