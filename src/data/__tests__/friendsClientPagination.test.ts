import {
  fetchAllFriendsDashboard,
  fetchFriendsDashboard,
  mergeFriendsDashboardPage,
  type FriendsDashboard,
} from '../friendsClient';

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

it('parses relationship page metadata from a paginated dashboard payload', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      friends: [{ id: 'f1', nickname: 'a', display_name: 'A', avatar_url: null, is_public: true }],
      following: [],
      friends_count: 250,
      following_count: 0,
      next_cursor: 100,
      following_next_cursor: null,
      friends_truncated: true,
      following_truncated: false,
    }),
  })) as jest.Mock;

  const dashboard = await fetchFriendsDashboard();
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.test/v1/friends?limit=100',
    expect.anything(),
  );
  expect(dashboard?.relationshipPage).toEqual({
    friendsCount: 250,
    followingCount: 0,
    nextCursor: 100,
    followingNextCursor: null,
    friendsTruncated: true,
    followingTruncated: false,
  });
});

it('defaults relationship page counts and flags on a legacy payload without metadata', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      friends: [
        { id: 'f1', nickname: 'a', display_name: 'A', avatar_url: null, is_public: true },
        { id: 'f2', nickname: 'b', display_name: 'B', avatar_url: null, is_public: true },
      ],
      following: [
        { id: 'g1', nickname: 'c', display_name: 'C', avatar_url: null, is_public: true, last_drink: null },
      ],
    }),
  })) as jest.Mock;

  const dashboard = await fetchFriendsDashboard();
  expect(dashboard?.relationshipPage).toEqual({
    friendsCount: 2,
    followingCount: 1,
    nextCursor: null,
    followingNextCursor: null,
    friendsTruncated: false,
    followingTruncated: false,
  });
});

it('fetchAll follows cursors once and preserves completed relationship branch', async () => {
  const friend = (id: string) => ({ id, nickname: id, display_name: id, avatar_url: null, is_public: true });
  const following = (id: string) => ({ ...friend(id), last_drink: null });
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        friends: [friend('f1')],
        following: [following('g1')],
        friends_count: 2,
        following_count: 1,
        next_cursor: 100,
        following_next_cursor: null,
        friends_truncated: true,
        following_truncated: false,
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        friends: [friend('f2')],
        following: [],
        friends_count: 2,
        following_count: 1,
        next_cursor: null,
        following_next_cursor: null,
        friends_truncated: false,
        following_truncated: false,
      }),
    }) as jest.Mock;

  const dashboard = await fetchAllFriendsDashboard();

  expect(dashboard?.friends.map((f) => f.id)).toEqual(['f1', 'f2']);
  expect(dashboard?.following.map((f) => f.id)).toEqual(['g1']);
  expect(dashboard?.relationshipPage).toEqual({
    friendsCount: 2,
    followingCount: 1,
    nextCursor: null,
    followingNextCursor: null,
    friendsTruncated: false,
    followingTruncated: false,
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect((global.fetch as jest.Mock).mock.calls[0]?.[0]).toBe('https://api.test/v1/friends?limit=100');
  expect((global.fetch as jest.Mock).mock.calls[1]?.[0]).toBe('https://api.test/v1/friends?limit=100&cursor=100');

  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('legacy')], following: [] }),
  })) as jest.Mock;

  const legacy = await fetchAllFriendsDashboard();

  expect(legacy?.friends.map((f) => f.id)).toEqual(['legacy']);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('fetchAll stops on a repeating cursor cycle', async () => {
  const body = (nextCursor: number | null) =>
    JSON.stringify({
      friends: [],
      following: [],
      friends_count: 0,
      following_count: 0,
      next_cursor: nextCursor,
      following_next_cursor: null,
      friends_truncated: true,
      following_truncated: false,
    });
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => body(100),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => body(200),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => body(100),
    })
    .mockRejectedValue(new Error('unexpected fourth request')) as jest.Mock;

  const result = await fetchAllFriendsDashboard();

  expect(result).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

it('merge keeps current live slices while appending relationship pages', () => {
  const profile = (id: string, name: string) => ({
    id,
    nickname: name,
    displayName: name,
    avatarUrl: null,
    isPublic: true,
  });
  const current = {
    friends: [profile('f1', 'Old')],
    following: [{ ...profile('g1', 'Old'), lastDrink: null }],
    friendStats: { f1: { sharedPubCount: 1 } },
    activeFriends: [{ id: 'live-current' }],
    plans: [{ id: 'plan-current' }],
    presence: [{ account: profile('live', 'Live'), pubName: 'Current pub' }],
    myPresence: { account: profile('me', 'Me'), pubName: 'Mine' },
    settings: { ghostMode: true },
    notifications: [{ id: 'notice-current' }],
    incomingRequests: [],
    outgoingRequests: [],
    relationshipPage: {
      friendsCount: 2,
      followingCount: 2,
      nextCursor: 100,
      followingNextCursor: 200,
      friendsTruncated: true,
      followingTruncated: true,
    },
  } as unknown as FriendsDashboard;
  const page = {
    friends: [profile('f1', 'New'), profile('f2', 'Two')],
    following: [{ ...profile('g1', 'New'), lastDrink: null }, { ...profile('g2', 'Four'), lastDrink: null }],
    friendStats: { f1: { sharedPubCount: 9 }, f2: { sharedPubCount: 2 } },
    activeFriends: [],
    plans: [],
    presence: [],
    myPresence: null,
    settings: { ghostMode: false },
    notifications: [],
    incomingRequests: [],
    outgoingRequests: [],
    relationshipPage: {
      friendsCount: 2,
      followingCount: 2,
      nextCursor: null,
      followingNextCursor: null,
      friendsTruncated: false,
      followingTruncated: false,
    },
  } as unknown as FriendsDashboard;

  const merged = mergeFriendsDashboardPage(current, page);

  expect(merged.friends.map((f) => f.id)).toEqual(['f1', 'f2']);
  expect(merged.following.map((f) => f.id)).toEqual(['g1', 'g2']);
  expect(merged.friends[0]?.nickname).toBe('New');
  expect(merged.following[0]?.nickname).toBe('New');
  expect((merged.friendStats as Record<string, { sharedPubCount: number }>).f1.sharedPubCount).toBe(9);
  expect(merged.relationshipPage).toEqual(page.relationshipPage);
  expect(merged.activeFriends).toBe(current.activeFriends);
  expect(merged.plans).toBe(current.plans);
  expect(merged.presence).toBe(current.presence);
  expect(merged.myPresence).toBe(current.myPresence);
  expect(merged.settings).toBe(current.settings);
  expect(merged.notifications).toBe(current.notifications);
});
