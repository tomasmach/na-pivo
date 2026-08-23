import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchFriendsDashboard,
  fetchFriendsLive,
  fetchNextFriendsDashboardPage,
  markFriendNotificationsRead,
  mergeFriendsDashboardPage,
  type FriendsDashboard,
  type FriendsLiveSlice,
} from '@/data/friendsClient';
import { loadFriendsDashboardSnapshot, type FriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { useAccountStore } from '@/stores/accountStore';
import { useFocusEffect } from 'expo-router';
import { usePartaDashboard } from '@/friends/usePartaDashboard';

const mockFocusHarness = {
  activeCleanup: null as (() => void) | null,
  /** Simulates losing focus by running exactly the active cleanup, once, without remounting. */
  blur() {
    const cleanup = mockFocusHarness.activeCleanup;
    mockFocusHarness.activeCleanup = null;
    if (cleanup) cleanup();
  },
};

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    React.useEffect(() => {
      let hasRun = false;
      const rawCleanup = cb();
      // Idempotent runner: fires exactly once, whether via explicit blur()
      // or React cleanup on dependency change/unmount — never both.
      const runOnce = () => {
        if (hasRun) return;
        hasRun = true;
        if (typeof rawCleanup === 'function') rawCleanup();
      };
      mockFocusHarness.activeCleanup = runOnce;
      return () => {
        if (mockFocusHarness.activeCleanup === runOnce) {
          mockFocusHarness.activeCleanup = null;
        }
        runOnce();
      };
    }, [cb]);
  },
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('@/data/friendsSnapshot', () => ({
  loadFriendsDashboardSnapshot: jest.fn(async () => null),
}));

jest.mock('@/notifications/friendPush', () => ({
  ensureFriendPushRegisteredIfGranted: jest.fn(async () => undefined),
}));

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: jest.requireActual('zustand').create(() => ({ session: null })),
}));

jest.mock('@/data/friendsClient', () => ({
  fetchFriendsDashboard: jest.fn(),
  fetchFriendsLive: jest.fn(),
  fetchNextFriendsDashboardPage: jest.fn(),
  mergeFriendsDashboardPage: jest.fn(),
  markFriendNotificationsRead: jest.fn(async () => undefined),
}));

const TestRenderer = jest.requireActual('react-test-renderer');

function makeSession(accountId: string, token: string) {
  return { deviceId: 'device-1', accountId, token, authenticated: true };
}

function makeProfile(id: string) {
  return { id, nickname: null, displayName: id, avatarUrl: null, isPublic: true };
}

function makePresence(id: string): FriendsDashboard['presence'][number] {
  return {
    account: makeProfile(id),
    pubName: 'U Fleků',
    pubCity: 'Praha',
    cacheKey: `pub-${id}`,
    lat: null,
    lng: null,
    since: '2026-08-23T18:00:00Z',
    lastSeenAt: '2026-08-23T18:00:00Z',
    beers: 1,
    lastDrinkName: '',
    activityId: null,
  };
}

function makeNotification(id: string): FriendsDashboard['notifications'][number] {
  return {
    id,
    kind: 'friend_at_pub',
    title: 'Title',
    body: 'Body',
    actor: null,
    friendshipId: null,
    activityId: null,
    pubCacheKey: '',
    pubName: '',
    readAt: null,
    createdAt: '2026-08-23T18:00:00Z',
  };
}

function makeDashboard(
  friendId: string,
  opts: { live?: boolean; truncated?: boolean; unreadCount?: number } = {},
): FriendsDashboard {
  return {
    friends: [makeProfile(friendId)],
    friendStats: {},
    incomingRequests: [],
    outgoingRequests: [],
    following: [],
    followersCount: 0,
    activeFriends: [],
    myActiveActivity: null,
    plans: [],
    myPlan: null,
    presence: opts.live ? [makePresence('someone-else')] : [],
    myPresence: null,
    blockedIds: [],
    settings: {
      ghostMode: false,
      quietHoursEnabled: true,
      quietHoursStart: 23,
      quietHoursEnd: 9,
      shareDrinksWithParta: true,
    },
    streak: { currentWeeks: 0, thisWeekLit: false },
    leaderboard: [],
    notifications: [makeNotification(`${friendId}-notification`)],
    unreadCount: opts.unreadCount ?? 0,
    relationshipPage:
      opts.truncated === true
        ? {
            friendsCount: 1,
            followingCount: 0,
            nextCursor: 100,
            followingNextCursor: null,
            friendsTruncated: true,
            followingTruncated: false,
          }
        : undefined,
  };
}

function makeLiveSlice(overrides: Partial<FriendsLiveSlice> = {}): FriendsLiveSlice {
  return {
    activeFriends: [],
    myActiveActivity: null,
    plans: [],
    myPlan: null,
    presence: [],
    myPresence: null,
    incomingCount: 0,
    unreadCount: 0,
    serverTime: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface PendingDashboardCall {
  signal: AbortSignal | undefined;
  resolve: (value: FriendsDashboard | null) => void;
}

function queueDashboards(): PendingDashboardCall[] {
  const calls: PendingDashboardCall[] = [];
  (fetchFriendsDashboard as jest.Mock).mockImplementation((signal?: AbortSignal) => {
    return new Promise<FriendsDashboard | null>((resolve) => {
      calls.push({ signal, resolve });
    });
  });
  return calls;
}

const EMPTY_SIGNAL = { pendingRequests: 0, unread: 0, liveNow: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusHarness.activeCleanup = null;
  (loadFriendsDashboardSnapshot as jest.Mock).mockImplementation(async () => null);
  useAccountStore.setState({ session: null });
  usePartaSignalStore.setState({
    pendingRequests: 0,
    unread: 0,
    liveNow: false,
    pendingRefresh: false,
    focusTarget: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

test('account switch wipes A state immediately and late A async results never repopulate', async () => {
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'queueMicrotask'],
  });

  const dashboardCalls = queueDashboards();
  const snapshotCalls: ((value: FriendsDashboardSnapshot | null) => void)[] = [];
  (loadFriendsDashboardSnapshot as jest.Mock).mockImplementation(() => {
    return new Promise<FriendsDashboardSnapshot | null>((resolve) => {
      snapshotCalls.push(resolve);
    });
  });

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a') });
  });

  const { result } = renderHook(() => usePartaDashboard({ markRead: true }));

  expect(dashboardCalls.length).toBe(1);
  const aDashboard = makeDashboard('a-friend', { live: true, truncated: true, unreadCount: 4 });
  await act(async () => {
    dashboardCalls[0].resolve(aDashboard);
  });

  expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend');
  expect(result.current.loading).toBe(false);
  expect(markFriendNotificationsRead).toHaveBeenCalledTimes(1);
  expect(usePartaSignalStore.getState().liveNow).toBe(true);

  const pageDeferred = deferred<FriendsDashboard>();
  let pageSignal: AbortSignal | undefined;
  (fetchNextFriendsDashboardPage as jest.Mock).mockImplementationOnce(
    (_current: FriendsDashboard, signal?: AbortSignal) => {
      pageSignal = signal;
      return pageDeferred.promise;
    },
  );
  await act(async () => {
    result.current.loadMore();
  });
  expect(result.current.loadingMore).toBe(true);

  const liveDeferred = deferred<FriendsLiveSlice>();
  let liveSignal: AbortSignal | undefined;
  (fetchFriendsLive as jest.Mock).mockImplementationOnce((signal?: AbortSignal) => {
    liveSignal = signal;
    return liveDeferred.promise;
  });
  act(() => {
    jest.advanceTimersByTime(35_000);
  });
  expect(fetchFriendsLive).toHaveBeenCalledTimes(1);

  await act(async () => {
    result.current.refresh();
  });
  expect(result.current.refreshing).toBe(true);
  expect(dashboardCalls.length).toBe(2);

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-b', 'token-b') });
  });

  expect(result.current.dashboard).toBeNull();
  expect(result.current.loading).toBe(true);
  expect(result.current.refreshing).toBe(false);
  expect(result.current.stale).toBe(false);
  expect(result.current.loadingMore).toBe(false);
  expect(dashboardCalls[0].signal?.aborted).toBe(true);
  expect(dashboardCalls[1].signal?.aborted).toBe(true);
  expect(pageSignal?.aborted).toBe(true);
  expect(liveSignal?.aborted).toBe(true);
  expect(usePartaSignalStore.getState()).toMatchObject(EMPTY_SIGNAL);
  expect(dashboardCalls.length).toBe(3);

  await act(async () => {
    dashboardCalls[1].resolve(makeDashboard('a-late'));
  });
  await act(async () => {
    liveDeferred.resolve(
      makeLiveSlice({
        presence: [makePresence('a-live-friend')],
        incomingCount: 5,
        unreadCount: 7,
      }),
    );
  });
  await act(async () => {
    pageDeferred.resolve(makeDashboard('a-page-friend'));
  });
  await act(async () => {
    snapshotCalls[0]?.({ savedAt: Date.now(), dashboard: aDashboard });
  });
  await act(async () => {
    snapshotCalls[1]?.(null);
  });

  expect(result.current.dashboard).toBeNull();
  expect(markFriendNotificationsRead).toHaveBeenCalledTimes(1);
  expect(mergeFriendsDashboardPage).not.toHaveBeenCalled();
  expect(usePartaSignalStore.getState()).toMatchObject(EMPTY_SIGNAL);

  await act(async () => {
    dashboardCalls[2].resolve(null);
  });

  expect(result.current.dashboard).toBeNull();
  expect(result.current.loading).toBe(false);
  expect(result.current.stale).toBe(true);
});

test('account B reloads successfully through the focused flow after the switch', async () => {
  const dashboardCalls = queueDashboards();

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a') });
  });

  const { result } = renderHook(() => usePartaDashboard({ markRead: true }));

  await act(async () => {
    dashboardCalls[0].resolve(makeDashboard('a-friend'));
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend'));

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-b', 'token-b') });
  });
  expect(result.current.dashboard).toBeNull();
  expect(dashboardCalls.length).toBe(2);

  await act(async () => {
    dashboardCalls[1].resolve(makeDashboard('b-friend', { unreadCount: 2 }));
  });

  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('b-friend'));
  expect(result.current.loading).toBe(false);
  expect(result.current.stale).toBe(false);
  expect(markFriendNotificationsRead).toHaveBeenCalledTimes(2);
});

test('same-account token refresh is not a boundary and keeps the loaded dashboard', async () => {
  const dashboardCalls = queueDashboards();

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a1') });
  });

  const { result } = renderHook(() => usePartaDashboard());

  await act(async () => {
    dashboardCalls[0].resolve(makeDashboard('a-friend'));
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend'));

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a2') });
  });

  expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend');
  expect(result.current.loading).toBe(false);
  expect(result.current.stale).toBe(false);
  expect(dashboardCalls.length).toBe(1);
});

function queueSnapshots(): ((value: FriendsDashboardSnapshot | null) => void)[] {
  const resolvers: ((value: FriendsDashboardSnapshot | null) => void)[] = [];
  (loadFriendsDashboardSnapshot as jest.Mock).mockImplementation(() => {
    return new Promise<FriendsDashboardSnapshot | null>((resolve) => {
      resolvers.push(resolve);
    });
  });
  return resolvers;
}

test('account switch keeps exactly one snapshot read; B never reads it and waits for its network response', async () => {
  const dashboardCalls = queueDashboards();
  const snapshotCalls = queueSnapshots();

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a') });
  });

  const { result } = renderHook(() => usePartaDashboard({ markRead: true }));
  expect(snapshotCalls.length).toBe(1);
  expect(loadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);

  const aDashboard = makeDashboard('a-friend', { live: true, unreadCount: 4 });
  await act(async () => {
    dashboardCalls[0].resolve(aDashboard);
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend'));

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-b', 'token-b') });
  });
  expect(result.current.dashboard).toBeNull();
  expect(dashboardCalls.length).toBe(2);
  expect(snapshotCalls.length).toBe(1);
  expect(loadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);

  await act(async () => {
    snapshotCalls[0]?.({ savedAt: Date.now(), dashboard: aDashboard });
  });

  expect(result.current.dashboard).toBeNull();

  await act(async () => {
    dashboardCalls[1].resolve(makeDashboard('b-friend'));
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).not.toBe('a-friend'));
});

test('snapshot resolved null under A stays the only read; B hydrates only from its own network response', async () => {
  const dashboardCalls = queueDashboards();
  const snapshotCalls = queueSnapshots();

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a') });
  });

  const { result } = renderHook(() => usePartaDashboard({ markRead: true }));
  expect(snapshotCalls.length).toBe(1);

  await act(async () => {
    snapshotCalls[0]?.(null);
  });

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-b', 'token-b') });
  });
  expect(dashboardCalls.length).toBe(2);
  expect(snapshotCalls.length).toBe(1);
  expect(loadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);

  await act(async () => {
    dashboardCalls[0].resolve(makeDashboard('a-friend'));
  });

  expect(result.current.dashboard).toBeNull();

  await act(async () => {
    dashboardCalls[1].resolve(makeDashboard('b-friend'));
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('b-friend'));
});

test('null accountId at mount never reads the snapshot nor shows a private dashboard', async () => {
  const aDashboard = makeDashboard('a-friend');
  (loadFriendsDashboardSnapshot as jest.Mock).mockImplementation(async () => ({
    savedAt: Date.now(),
    dashboard: aDashboard,
  }));
  const dashboardCalls = queueDashboards();

  const { result } = renderHook(() => usePartaDashboard());

  await act(async () => {});

  expect(loadFriendsDashboardSnapshot).not.toHaveBeenCalled();
  expect(result.current.dashboard).toBeNull();
  expect(result.current.loading).toBe(true);
  expect(dashboardCalls.length).toBe(1);
});

test('StrictMode effect replay: aborted first focused request never blocks the replayed one', async () => {
  const dashboardCalls = queueDashboards();

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a') });
  });

  let latestResult: ReturnType<typeof usePartaDashboard> | undefined;
  function Harness() {
    latestResult = usePartaDashboard({ markRead: true });
    return null;
  }

  let renderer: { unmount: () => void } | undefined;
  try {
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(React.StrictMode, null, React.createElement(Harness)),
      );
    });

    expect(dashboardCalls.length).toBe(2);
    expect(dashboardCalls[0].signal?.aborted).toBe(true);
    expect(dashboardCalls[1].signal?.aborted).toBe(false);

    await act(async () => {
      dashboardCalls[1].resolve(makeDashboard('replayed-friend'));
    });

    expect(latestResult?.dashboard?.friends[0]?.id).toBe('replayed-friend');
    expect(latestResult?.loading).toBe(false);
  } finally {
    act(() => {
      renderer?.unmount();
    });
  }
});

test('explicit blur aborts an in-flight live poll; late live response stays inert', async () => {
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'queueMicrotask'],
  });

  const dashboardCalls = queueDashboards();
  let liveSignal: AbortSignal | undefined;
  const liveDeferred = deferred<FriendsLiveSlice>();
  (fetchFriendsLive as jest.Mock).mockImplementation((signal?: AbortSignal) => {
    liveSignal = signal;
    return liveDeferred.promise;
  });

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a') });
  });

  const { result } = renderHook(() => usePartaDashboard());

  expect(dashboardCalls.length).toBe(1);
  await act(async () => {
    dashboardCalls[0].resolve(makeDashboard('a-friend', { live: true, unreadCount: 4 }));
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend'));
  expect(usePartaSignalStore.getState().liveNow).toBe(true);

  act(() => {
    jest.advanceTimersByTime(35_000);
  });
  expect(fetchFriendsLive).toHaveBeenCalledTimes(1);
  expect(liveSignal?.aborted).toBe(false);

  act(() => {
    mockFocusHarness.blur();
  });

  expect(liveSignal?.aborted).toBe(true);

  await act(async () => {
    liveDeferred.resolve(
      makeLiveSlice({
        presence: [makePresence('late-live-friend')],
        incomingCount: 9,
        unreadCount: 11,
      }),
    );
  });

  expect(result.current.dashboard?.presence[0]?.account.id).toBe('someone-else');
  expect(usePartaSignalStore.getState()).toMatchObject({
    pendingRequests: 0,
    unread: 4,
    liveNow: true,
  });

  act(() => {
    jest.advanceTimersByTime(120_000);
  });
  expect(fetchFriendsLive).toHaveBeenCalledTimes(1);
});

test('refresh aborting an in-flight live poll keeps its null response inert while reload is pending', async () => {
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'queueMicrotask'],
  });

  const dashboardCalls = queueDashboards();
  let liveSignal: AbortSignal | undefined;
  const liveDeferred = deferred<FriendsLiveSlice | null>();
  (fetchFriendsLive as jest.Mock).mockImplementation((signal?: AbortSignal) => {
    liveSignal = signal;
    return liveDeferred.promise;
  });

  act(() => {
    useAccountStore.setState({ session: makeSession('acc-a', 'token-a') });
  });

  const { result } = renderHook(() => usePartaDashboard());

  expect(dashboardCalls.length).toBe(1);
  await act(async () => {
    dashboardCalls[0].resolve(makeDashboard('a-friend', { live: true }));
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend'));
  expect(result.current.stale).toBe(false);

  act(() => {
    jest.advanceTimersByTime(35_000);
  });
  expect(fetchFriendsLive).toHaveBeenCalledTimes(1);
  expect(liveSignal?.aborted).toBe(false);

  await act(async () => {
    result.current.refresh();
  });
  expect(dashboardCalls.length).toBe(2);
  expect(liveSignal?.aborted).toBe(true);

  await act(async () => {
    liveDeferred.resolve(null);
  });

  expect(result.current.stale).toBe(false);
  expect(result.current.refreshing).toBe(true);

  await act(async () => {
    dashboardCalls[1].resolve(makeDashboard('a-friend-2'));
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('a-friend-2'));
  expect(result.current.stale).toBe(false);
});

test('focus harness: callback cleanup runs exactly once across explicit blur and unmount', () => {
  let cleanupRuns = 0;
  const { unmount } = renderHook(() =>
    useFocusEffect(() => {
      return () => {
        cleanupRuns += 1;
      };
    }),
  );

  expect(cleanupRuns).toBe(0);

  act(() => {
    mockFocusHarness.blur();
  });
  expect(cleanupRuns).toBe(1);

  act(() => {
    mockFocusHarness.blur();
  });
  expect(cleanupRuns).toBe(1);

  act(() => {
    unmount();
  });
  expect(cleanupRuns).toBe(1);
});

test('focus harness: dependency change runs the previous callback cleanup exactly once', () => {
  const runs: string[] = [];
  let callbackId = 'first';
  const { rerender } = renderHook(() =>
    useFocusEffect(() => {
      const id = callbackId;
      return () => {
        runs.push(id);
      };
    }),
  );

  act(() => {
    callbackId = 'second';
    rerender(undefined);
  });

  expect(runs).toEqual(['first']);
});
