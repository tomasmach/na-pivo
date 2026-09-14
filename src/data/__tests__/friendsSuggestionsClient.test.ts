import { fetchFriendSuggestions } from '../friendsClient';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'me', token: 'token' })),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
  generateUuidV4: jest.fn(() => 'uuid'),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));
jest.mock('../friendsSnapshot', () => ({
  saveFriendsDashboardSnapshot: jest.fn(),
  snapshotGeneration: jest.fn(() => 0),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

it('parses explainable friend suggestions and drops legacy rows without a reason', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      results: [
        {
          id: 'shared-1',
          nickname: 'honza',
          display_name: 'Honza',
          avatar_url: null,
          is_public: true,
          suggestion_reason: { kind: 'shared_pubs', count: 2 },
        },
        {
          id: 'legacy-1',
          nickname: 'bezduvodu',
          display_name: 'Bez důvodu',
          avatar_url: null,
          is_public: true,
        },
      ],
    }),
  })) as jest.Mock;

  await expect(fetchFriendSuggestions()).resolves.toEqual([
    {
      id: 'shared-1',
      nickname: 'honza',
      displayName: 'Honza',
      avatarUrl: null,
      isPublic: true,
      suggestionReason: { kind: 'shared_pubs', count: 2 },
    },
  ]);
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.test/v1/friends/search?suggest=true',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );
});
