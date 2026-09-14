/**
 * The Souboj client, with the privacy defaults as the point.
 *
 * A malformed or truncated body must never end up drawing spend that nobody
 * agreed to share, and an unavailable duel must come back without numbers
 * rather than with zeroes.
 */

import { fetchFriendDuel, updateFriendSettings } from '../friendsClient';

import { ensureAccount } from '../account';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
  generateUuidV4: jest.fn(() => 'uuid-fixed'),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordFetch(body: unknown, status = 200): RecordedCall[] {
  const calls: RecordedCall[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
  return calls;
}

const FRIEND = { id: 'pepa-id', nickname: 'pepa', display_name: 'Pepa', avatar_url: null };

const FULL_DUEL = {
  friend: FRIEND,
  window: '180d',
  available: true,
  unavailable_reason: null,
  spend_available: true,
  spend_blocked_by_me: false,
  me: { beers: 146, evenings: 31, pubs: 18, beers_per_evening: 4.7, spend_czk: 6240, priced_beers: 140 },
  them: { beers: 152, evenings: 26, pubs: 11, beers_per_evening: 5.8, spend_czk: 5110, priced_beers: 150 },
  series: [
    { month: '2026-08-01', me: 24, friend: 31 },
    { month: '2026-09-01', me: 29, friend: 22 },
  ],
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  (ensureAccount as jest.Mock).mockResolvedValue({
    deviceId: 'device',
    accountId: 'account-1',
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

describe('fetchFriendDuel', () => {
  it('asks for the requested window and parses both sides', async () => {
    const calls = recordFetch(FULL_DUEL);

    const duel = await fetchFriendDuel('pepa-id', '180d');

    expect(calls[0].url).toBe('https://api.test/v1/friends/pepa-id/duel?window=180d');
    expect(duel?.me).toEqual({
      beers: 146,
      evenings: 31,
      pubs: 18,
      beersPerEvening: 4.7,
      spendCzk: 6240,
      pricedBeers: 140,
    });
    expect(duel?.them?.beers).toBe(152);
    expect(duel?.series).toHaveLength(2);
  });

  it('drops the numbers when the friend does not share', async () => {
    recordFetch({
      friend: FRIEND,
      window: '30d',
      available: false,
      unavailable_reason: 'not_sharing',
      spend_available: false,
      me: null,
      them: null,
      series: [],
    });

    const duel = await fetchFriendDuel('pepa-id', '30d');

    expect(duel?.available).toBe(false);
    expect(duel?.unavailableReason).toBe('not_sharing');
    expect(duel?.me).toBeNull();
    expect(duel?.them).toBeNull();
  });

  it('never reports spend on an unavailable duel, whatever the body claims', async () => {
    recordFetch({ ...FULL_DUEL, available: false, spend_available: true });

    const duel = await fetchFriendDuel('pepa-id', 'all');

    expect(duel?.spendAvailable).toBe(false);
    expect(duel?.me).toBeNull();
  });

  it('leaves spend null when the backend omitted it', async () => {
    recordFetch({
      ...FULL_DUEL,
      spend_available: false,
      me: { beers: 10, evenings: 3, pubs: 2, beers_per_evening: 3.3 },
      them: { beers: 8, evenings: 3, pubs: 1, beers_per_evening: 2.7 },
    });

    const duel = await fetchFriendDuel('pepa-id', '30d');

    expect(duel?.spendAvailable).toBe(false);
    expect(duel?.me?.spendCzk).toBeNull();
    expect(duel?.me?.pricedBeers).toBeNull();
  });

  it('falls back to the half-year window when the backend sends something else', async () => {
    recordFetch({ ...FULL_DUEL, window: 'forever' });

    expect((await fetchFriendDuel('pepa-id', 'all'))?.window).toBe('180d');
  });

  it('skips malformed months instead of drawing a chart of NaN', async () => {
    recordFetch({ ...FULL_DUEL, series: [{ me: 4, friend: 2 }, { month: '2026-09-01' }] });

    const duel = await fetchFriendDuel('pepa-id', '30d');

    expect(duel?.series).toEqual([{ month: '2026-09-01', me: 0, friend: 0 }]);
  });

  it('returns null on an error response', async () => {
    recordFetch({ detail: 'nope' }, 404);

    expect(await fetchFriendDuel('pepa-id', '30d')).toBeNull();
  });
});

describe('updateFriendSettings', () => {
  it('sends the spend consent flag', async () => {
    const calls = recordFetch({});

    await updateFriendSettings({ shareSpendWithParta: true });

    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ share_spend_with_parta: true });
  });
});
