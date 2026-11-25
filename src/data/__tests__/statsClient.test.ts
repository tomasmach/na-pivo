import { ensureAccount } from '../account';
import { fetchMyStats } from '../statsClient';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'tok',
    authenticated: false,
  })),
  clearCachedAnonymousAccount: jest.fn(async () => false),
}));

const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  global.fetch = jest.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  global.fetch = ORIGINAL_FETCH;
  jest.clearAllMocks();
});

it('asks the server to leave out removed drinks', async () => {
  await fetchMyStats(undefined, ['a1', 'b2']);

  const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
  expect(url).toContain('exclude_client_ids=a1,b2');
});

it('ignores stats from a server that cannot leave out removed drinks', async () => {
  const body = { total_beers: 3, periods: { timezone: 'Europe/Prague', months: [], years: [] } };
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  await expect(fetchMyStats(undefined, ['removed'])).resolves.toBeNull();

  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ...body, excluded_drink_count: 1 }),
  })) as unknown as typeof fetch;
  await expect(fetchMyStats(undefined, ['removed'])).resolves.toMatchObject({ totalBeers: 3 });
});

it('skips server stats it knows would still count some removed drinks', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => `removed-${index}`);

  await expect(fetchMyStats(undefined, ids)).resolves.toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(ensureAccount).not.toHaveBeenCalled();
});

it('reads the night numbers and per-pub evenings, and leaves them empty on an older server', async () => {
  const body = {
    total_beers: 5,
    total_nights: 2,
    top_pubs: [{ cache_key: 'u2fkbn12', name: 'Lokál', beers: 3, spent_czk: 0, last_drank_at: '2026-10-24T18:05:00Z', evenings: 2 }],
    night_records: { most_beers: 4, most_beers_date: '2026-10-24', most_beers_pub_names: ['Lokál', 'U Pinkasů'], longest_seconds: 19800, longest_date: '2026-10-24', longest_pub_names: ['Lokál', 'U Pinkasů'] },
    night_timeline: { months: [{ period: '2026-10', beers: 5, evenings: 2, distinct_pubs: 2, longest_evening_seconds: 19800 }] },
  };
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  await expect(fetchMyStats()).resolves.toMatchObject({
    totalNights: 2,
    topPubs: [{ evenings: 2 }],
    nightRecords: { mostBeers: 4, mostBeersPubNames: ['Lokál', 'U Pinkasů'], longestSeconds: 19800, longestDate: '2026-10-24' },
    nightMonths: [{ period: '2026-10', beers: 5, nights: 2 }],
  });

  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ total_beers: 5, top_pubs: [{ ...body.top_pubs[0], evenings: undefined }] }),
  })) as unknown as typeof fetch;
  await expect(fetchMyStats()).resolves.toMatchObject({ totalNights: null, topPubs: [{ evenings: null }], nightMonths: [] });
});
