import {
  fetchAllFriendsDashboard,
  fetchFriendsDashboard,
  fetchFriendsLive,
  fetchNextFriendsDashboardPage,
  mergeFriendsDashboardPage,
  type FriendsDashboard,
} from '../friendsClient';
import {
  saveFriendsDashboardSnapshot,
  snapshotGeneration,
} from '../friendsSnapshot';

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

const mockedSnapshotGeneration = snapshotGeneration as jest.Mock;
const mockedSaveSnapshot = saveFriendsDashboardSnapshot as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** Flush microtasks so ensureAccount resolves and global.fetch gets called. */
async function pump() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSnapshotGeneration.mockReturnValue(0);
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

const livePayload = JSON.stringify({
  active_friends: [{ id: 'a1', display_name: 'Live' }],
  my_active_activity: null,
  plans: [],
  my_plan: null,
  presence: [],
  my_presence: null,
  incoming_count: 1,
  unread_count: 2,
  server_time: '2026-08-23T10:00:00Z',
});

it('drops a dashboard response that resolves after the account boundary moved', async () => {
  const gate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest.fn(() => gate.promise) as jest.Mock;
  const pending = fetchFriendsDashboard();
  await pump();
  mockedSnapshotGeneration.mockReturnValue(1);
  gate.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ friends: [] }) });

  const result = await pending;

  expect(result).toBeNull();
  expect(mockedSaveSnapshot).not.toHaveBeenCalled();
});

it('keeps an out-of-order older dashboard response from overwriting a newer snapshot', async () => {
  const friend = (id: string) => ({ id, nickname: id, display_name: id, avatar_url: null, is_public: true });
  const olderGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  const newerGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest
    .fn()
    .mockImplementationOnce(() => olderGate.promise)
    .mockImplementationOnce(() => newerGate.promise) as jest.Mock;

  const older = fetchFriendsDashboard();
  const newer = fetchFriendsDashboard();
  await pump();

  newerGate.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('new')] }),
  });
  const newerDashboard = await newer;

  expect(newerDashboard?.friends.map((f) => f.id)).toEqual(['new']);
  expect(mockedSaveSnapshot).toHaveBeenCalledTimes(1);
  expect(
    (mockedSaveSnapshot.mock.calls[0]?.[0] as FriendsDashboard).friends.map((f) => f.id),
  ).toEqual(['new']);

  olderGate.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('old')] }),
  });
  const olderDashboard = await older;

  expect(olderDashboard?.friends.map((f) => f.id)).toEqual(['old']);
  const savedFriendIds = mockedSaveSnapshot.mock.calls.map(
    (call) => (call[0] as FriendsDashboard).friends.map((f) => f.id),
  );
  expect(savedFriendIds).not.toContainEqual(['old']);
});

it('keeps a stale page response from overwriting a newer full-dashboard snapshot', async () => {
  const friend = (id: string) => ({ id, nickname: id, display_name: id, avatar_url: null, is_public: true });
  const pageGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  const fullGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest
    .fn()
    .mockImplementationOnce(() => pageGate.promise)
    .mockImplementationOnce(() => fullGate.promise) as jest.Mock;

  const current = {
    friends: [friend('f1')],
    following: [],
    friendStats: {},
    incomingRequests: [],
    outgoingRequests: [],
    relationshipPage: {
      friendsCount: 2,
      followingCount: 0,
      nextCursor: 100,
      followingNextCursor: null,
      friendsTruncated: true,
      followingTruncated: false,
    },
  } as unknown as FriendsDashboard;

  // The page request starts first (older); the full dashboard starts second
  // and becomes the newest snapshot producer.
  const pendingPage = fetchNextFriendsDashboardPage(current);
  const pendingFull = fetchFriendsDashboard();
  await pump();

  fullGate.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('full')] }),
  });
  const fullDashboard = await pendingFull;

  expect(fullDashboard?.friends.map((f) => f.id)).toEqual(['full']);
  expect(mockedSaveSnapshot).toHaveBeenCalledTimes(1);
  expect(
    (mockedSaveSnapshot.mock.calls[0]?.[0] as FriendsDashboard).friends.map((f) => f.id),
  ).toEqual(['full']);

  pageGate.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('page')] }),
  });
  const pageResult = await pendingPage;

  // Caller still gets the merged result; only the snapshot save is suppressed.
  expect(pageResult?.friends.map((f) => f.id)).toEqual(['f1', 'page']);
  expect(mockedSaveSnapshot).toHaveBeenCalledTimes(1);
});

it('parses and saves the dashboard when the generation holds', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      friends: [{ id: 'f1', display_name: 'A' }],
    }),
  })) as jest.Mock;

  const dashboard = await fetchFriendsDashboard();

  expect(dashboard?.friends.map((f) => f.id)).toEqual(['f1']);
  expect(mockedSaveSnapshot).toHaveBeenCalledWith(dashboard, 0);
});

it('drops a direct live response after the account boundary moved', async () => {
  const gate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest.fn(() => gate.promise) as jest.Mock;
  const pending = fetchFriendsLive();
  await pump();
  mockedSnapshotGeneration.mockReturnValue(1);
  gate.resolve({ ok: true, status: 200, text: async () => livePayload });

  const result = await pending;

  expect(result).toBeNull();
});

it('skips the dashboard fallback when the boundary moved before the live 404 resolved', async () => {
  const gate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest.fn(() => gate.promise) as jest.Mock;
  const pending = fetchFriendsLive();
  await pump();
  mockedSnapshotGeneration.mockReturnValue(1);
  gate.resolve({ ok: false, status: 404, text: async () => '' });

  const result = await pending;

  expect(result).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('drops the live slice when the boundary moves during the 404 fallback', async () => {
  const first = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  const fallback = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => fallback.promise) as jest.Mock;
  const pending = fetchFriendsLive();
  await pump();
  first.resolve({ ok: false, status: 404, text: async () => '' });
  await pump();
  mockedSnapshotGeneration.mockReturnValue(1);
  fallback.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ friends: [] }) });

  const result = await pending;

  expect(result).toBeNull();
  expect(mockedSaveSnapshot).not.toHaveBeenCalled();
});

it('persists the newest dashboard as the final snapshot even when the older write completes last', async () => {
  const friend = (id: string) => ({ id, nickname: id, display_name: id, avatar_url: null, is_public: true });
  const oldWriteGate = deferred<void>();
  // Completion-state log: entries appear only once a write actually finished.
  const persistedFriendIds: string[][] = [];
  mockedSaveSnapshot.mockImplementation(async (dashboard: FriendsDashboard) => {
    if (dashboard.friends[0]?.id === 'old') await oldWriteGate.promise;
    persistedFriendIds.push(dashboard.friends.map((f) => f.id));
  });
  const olderGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  const newerGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest
    .fn()
    .mockImplementationOnce(() => olderGate.promise)
    .mockImplementationOnce(() => newerGate.promise) as jest.Mock;

  // The older request must START and RESOLVE success BEFORE the newer one even
  // begins, so today's start-based guard lets the older save physically begin
  // and park inside storage. Only then does the newer request start and succeed.
  const older = fetchFriendsDashboard();
  await pump();
  olderGate.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('old')] }),
  });
  const olderDashboard = await older;

  expect(olderDashboard?.friends.map((f) => f.id)).toEqual(['old']);
  expect(mockedSaveSnapshot).toHaveBeenCalledTimes(1);
  expect(
    (mockedSaveSnapshot.mock.calls[0]?.[0] as FriendsDashboard).friends.map((f) => f.id),
  ).toEqual(['old']);
  expect(persistedFriendIds).toEqual([]);

  const newer = fetchFriendsDashboard();
  await pump();
  newerGate.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('new')] }),
  });
  const newerDashboard = await newer;
  await pump();

  expect(newerDashboard?.friends.map((f) => f.id)).toEqual(['new']);

  // Release the parked older write and drain the write queue. Whatever order
  // the writes complete in, the final persisted state must be the newer data.
  oldWriteGate.resolve();
  await pump();

  expect(persistedFriendIds[persistedFriendIds.length - 1]).toEqual(['new']);
});

it('saves the older dashboard as the only valid cache result when the newer request fails', async () => {
  const friend = (id: string) => ({ id, nickname: id, display_name: id, avatar_url: null, is_public: true });
  const persistedFriendIds: string[][] = [];
  mockedSaveSnapshot.mockImplementation(async (dashboard: FriendsDashboard) => {
    persistedFriendIds.push(dashboard.friends.map((f) => f.id));
  });
  const olderGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  const newerGate = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
  global.fetch = jest
    .fn()
    .mockImplementationOnce(() => olderGate.promise)
    .mockImplementationOnce(() => newerGate.promise) as jest.Mock;

  const older = fetchFriendsDashboard();
  const newer = fetchFriendsDashboard();
  await pump();

  newerGate.resolve({ ok: false, status: 503, text: async () => '' });
  expect(await newer).toBeNull();
  expect(mockedSaveSnapshot).not.toHaveBeenCalled();

  olderGate.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ friends: [friend('old')] }),
  });
  const olderDashboard = await older;
  await pump();

  expect(olderDashboard?.friends.map((f) => f.id)).toEqual(['old']);
  expect(mockedSaveSnapshot).toHaveBeenCalledTimes(1);
  expect(
    (mockedSaveSnapshot.mock.calls[0]?.[0] as FriendsDashboard).friends.map((f) => f.id),
  ).toEqual(['old']);
  expect(persistedFriendIds).toEqual([['old']]);
});
