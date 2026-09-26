import { loadPartyFriends } from '../friendsClient';
import { loadFriendsDashboardSnapshot } from '../friendsSnapshot';

jest.mock('../account', () => ({ ensureAccount: jest.fn(async () => ({ token: 'test-token' })) }));
jest.mock('../friendsSnapshot', () => ({ snapshotGeneration: () => 0, saveFriendsDashboardSnapshot: jest.fn(), loadFriendsDashboardSnapshot: jest.fn(async () => null) }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://localhost${path}` }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const friend = { id: 'eva', nickname: 'eva', display_name: '', avatar_url: null, is_public: true };

it('reads the saved party first, fetches it once when there is none, and gives up offline', async () => {
  global.fetch = jest.fn() as jest.Mock;
  jest.mocked(loadFriendsDashboardSnapshot).mockResolvedValueOnce({ savedAt: 1, dashboard: { friends: [{ id: 'pepa' }], settings: { ghostMode: true } } as never });
  expect(await loadPartyFriends()).toEqual({ friends: [{ id: 'pepa' }], ghost: true });
  expect(global.fetch).not.toHaveBeenCalled();

  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ friends: [friend] }) })) as jest.Mock;
  expect(await loadPartyFriends()).toMatchObject({ friends: [{ id: 'eva', nickname: 'eva' }], ghost: false });

  global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as jest.Mock;
  expect(await loadPartyFriends()).toBeNull();
});
