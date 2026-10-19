import { fetchLeaderboard } from '../leaderboardsClient';
import { clearLocalPrivateAccountData } from '../privateAccountData';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../telemetryClient', () => ({
  setTelemetrySession: jest.fn(),
  trackApiFailure: jest.fn(),
  trackClientEvent: jest.fn(async () => undefined),
}));

jest.mock('../backendConfig', () => ({
  ...jest.requireActual('../backendConfig'),
  getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}`,
}));

jest.mock('../account', () => ({
  ...jest.requireActual('../account'),
  ensureAccount: jest.fn(async () => ({ token: 'token', accountId: 'account' })),
}));

function board(rank: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      category: 'beers',
      period: 'week',
      period_start: null,
      total_ranked: 10,
      entries: [],
      me: { rank, score: 5, listed: false, eligible: true },
    }),
  };
}

it('does not show the outgoing account its cached rank', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(board(7))
    .mockResolvedValueOnce(board(3));
  global.fetch = fetchMock as unknown as typeof fetch;

  expect((await fetchLeaderboard('beers', 'week'))?.me.rank).toBe(7);
  expect((await fetchLeaderboard('beers', 'week'))?.me.rank).toBe(7);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await clearLocalPrivateAccountData();

  expect((await fetchLeaderboard('beers', 'week'))?.me.rank).toBe(3);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
