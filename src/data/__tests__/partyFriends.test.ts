import { waitFor } from '@testing-library/react-native';
import { loadPartyFriends } from '../friendsClient';
import { loadFriendsDashboardSnapshot } from '../friendsSnapshot';

jest.mock('../account', () => ({ ensureAccount: jest.fn(async () => ({ token: 'test-token' })) }));
let mockGeneration = 0;
jest.mock('../friendsSnapshot', () => ({ snapshotGeneration: () => mockGeneration, saveFriendsDashboardSnapshot: jest.fn(), loadFriendsDashboardSnapshot: jest.fn(async () => null) }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://localhost${path}` }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const friend = { id: 'eva', nickname: 'eva', display_name: '', avatar_url: null, is_public: true };

it('answers from the saved party and still hands over the fresh one, fetches when nothing is saved, and gives up offline', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ friends: [friend], settings: { ghost_mode: false } }) })) as jest.Mock;
  jest.mocked(loadFriendsDashboardSnapshot).mockResolvedValueOnce({ savedAt: 1, dashboard: { friends: [], settings: { ghostMode: true } } as never });
  const onFresh = jest.fn();
  expect(await loadPartyFriends(undefined, onFresh)).toEqual({ friends: [], ghost: true });
  // Eva accepted since Parta was last open here.
  await waitFor(() => expect(onFresh).toHaveBeenCalledWith(expect.objectContaining({ friends: [expect.objectContaining({ id: 'eva' })] })));

  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ friends: [friend] }) })) as jest.Mock;
  expect(await loadPartyFriends()).toMatchObject({ friends: [{ id: 'eva', nickname: 'eva' }], ghost: false });

  global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as jest.Mock;
  expect(await loadPartyFriends()).toBeNull();
});

it('drops a party that arrives after the account changed', async () => {
  global.fetch = jest.fn(async () => {
    mockGeneration += 1; // signed out while the request was on its way
    return { ok: true, status: 200, text: async () => JSON.stringify({ friends: [friend] }) };
  }) as jest.Mock;
  expect(await loadPartyFriends()).toBeNull();
});
