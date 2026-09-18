import { fetchFriendsDashboard } from '../friendsClient';

jest.mock('../account', () => ({ ensureAccount: jest.fn(async () => ({ token: 'test-token' })) }));
jest.mock('../friendsSnapshot', () => ({ snapshotGeneration: () => 0, saveFriendsDashboardSnapshot: jest.fn() }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://localhost${path}` }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it('keeps private tallies null and distinguishes omitted legacy beer counts', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
    leaderboard: [
      { visits_30d: null, beers_30d: null },
      { visits_30d: 3 },
      { visits_30d: 0, beers_30d: 0 },
    ],
  }) })) as jest.Mock;
  const dashboard = await fetchFriendsDashboard();
  expect(dashboard?.leaderboard.map(({ visits30d, beers30d }) => ({ visits30d, beers30d }))).toEqual([
    { visits30d: null, beers30d: null },
    { visits30d: 3, beers30d: undefined },
    { visits30d: 0, beers30d: 0 },
  ]);
});
