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

it('skips server stats it knows would still count some removed drinks', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => `removed-${index}`);

  await expect(fetchMyStats(undefined, ids)).resolves.toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(ensureAccount).not.toHaveBeenCalled();
});
