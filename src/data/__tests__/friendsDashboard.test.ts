import { fetchFriendsDashboard } from '../friendsClient';

jest.mock('../account', () => ({ ensureAccount: jest.fn(async () => ({ token: 'test-token' })) }));
jest.mock('../friendsSnapshot', () => ({ snapshotGeneration: () => 0, saveFriendsDashboardSnapshot: jest.fn() }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://localhost${path}` }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('asks for the compact dashboard and reads the unread notifications from it', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        friends: [{ id: 'f1', nickname: 'petr', display_name: 'Petr' }],
        friend_stats: { f1: { shared_pub_count: 2, last_shared_at: '2026-11-10T19:00:00Z', last_pub_name: 'U Pinkasů' } },
        incoming_requests: [],
        notifications: [{ id: 'n1', kind: 'friend_request', read_at: null }],
        settings: { ghost_mode: false },
      }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;

  const dashboard = await fetchFriendsDashboard();

  expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('http://localhost/v1/friends?view=compact');
  expect(dashboard?.friends.map((f) => f.id)).toEqual(['f1']);
  expect(dashboard?.friendStats.f1.lastPubName).toBe('U Pinkasů');
  expect(dashboard?.notifications.map((n) => n.id)).toEqual(['n1']);
});
