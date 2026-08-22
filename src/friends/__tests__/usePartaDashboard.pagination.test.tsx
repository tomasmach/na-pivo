import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchFriendsDashboard,
  fetchNextFriendsDashboardPage,
  mergeFriendsDashboardPage,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { usePartaDashboard } from '@/friends/usePartaDashboard';

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    React.useEffect(() => {
      cb();
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

jest.mock('@/stores/partaSignalStore', () => ({
  hasLiveFriendSignal: jest.fn(() => false),
  usePartaSignalStore: Object.assign(jest.fn(() => undefined), {
    getState: () => ({
      consumeRefresh: jest.fn(() => null),
      setSignal: jest.fn(),
    }),
    subscribe: jest.fn(() => () => {}),
  }),
}));

jest.mock('@/data/friendsClient', () => ({
  fetchFriendsDashboard: jest.fn(),
  fetchFriendsLive: jest.fn(),
  fetchNextFriendsDashboardPage: jest.fn(),
  mergeFriendsDashboardPage: jest.fn(),
  markFriendNotificationsRead: jest.fn(async () => undefined),
}));

function makeProfile(id: string) {
  return { id, nickname: null, displayName: id, avatarUrl: null, isPublic: true };
}

function makeSettings() {
  return {
    ghostMode: false,
    quietHoursEnabled: false,
    quietHoursStart: 23,
    quietHoursEnd: 9,
    shareDrinksWithParta: true,
  };
}

function makeStreak() {
  return { currentWeeks: 0, thisWeekLit: false };
}

function makeRelationshipPage(kind: 'truncated' | 'complete'): FriendsDashboard['relationshipPage'] {
  if (kind === 'truncated') {
    return {
      friendsCount: 1,
      followingCount: 0,
      nextCursor: 100,
      followingNextCursor: null,
      friendsTruncated: true,
      followingTruncated: false,
    };
  }
  return undefined;
}

function makeDashboard(friendId = 'old', pageKind: 'truncated' | 'complete' = 'truncated'): FriendsDashboard {
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
    presence: [],
    myPresence: null,
    blockedIds: [],
    settings: makeSettings(),
    streak: makeStreak(),
    leaderboard: [],
    notifications: [],
    unreadCount: 0,
    relationshipPage: makeRelationshipPage(pageKind),
  };
}

test('loadMore coalesces concurrent calls; a refresh aborts the in-flight page and stale page data is dropped', async () => {
  (fetchFriendsDashboard as jest.Mock).mockResolvedValueOnce(makeDashboard('old'));
  (mergeFriendsDashboardPage as jest.Mock).mockImplementation(
    (current: FriendsDashboard, page: FriendsDashboard): FriendsDashboard => ({
      ...current,
      friends: [...current.friends, ...page.friends],
      following: [...current.following, ...page.following],
      incomingRequests: [...current.incomingRequests, ...page.incomingRequests],
      outgoingRequests: [...current.outgoingRequests, ...page.outgoingRequests],
      friendStats: { ...current.friendStats, ...page.friendStats },
      relationshipPage: page.relationshipPage ?? current.relationshipPage,
    }),
  );

  const { result } = renderHook(() => usePartaDashboard());

  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('old'));
  expect(result.current.hasMore).toBe(true);

  let capturedSignal: AbortSignal | undefined;
  let resolveNext!: (value: FriendsDashboard) => void;
  const pendingNext = new Promise<FriendsDashboard>((resolve) => {
    resolveNext = resolve;
  });
  (fetchNextFriendsDashboardPage as jest.Mock).mockImplementationOnce(
    (_current: FriendsDashboard, signal?: AbortSignal) => {
      capturedSignal = signal;
      return pendingNext;
    },
  );

  await act(async () => {
    result.current.loadMore();
    result.current.loadMore();
  });

  expect(fetchNextFriendsDashboardPage).toHaveBeenCalledTimes(1);
  expect(result.current.loadingMore).toBe(true);
  expect(capturedSignal?.aborted).toBe(false);

  const fresh = makeDashboard('fresh', 'complete');
  (fetchFriendsDashboard as jest.Mock).mockResolvedValueOnce(fresh);

  await act(async () => {
    result.current.refresh();
  });
  await waitFor(() => expect(result.current.dashboard?.friends[0]?.id).toBe('fresh'));

  expect(result.current.hasMore).toBe(false);
  expect(result.current.loadingMore).toBe(false);
  expect(capturedSignal?.aborted).toBe(true);

  const staleComplete = makeDashboard('stale', 'complete');
  await act(async () => {
    resolveNext(staleComplete);
    await pendingNext;
  });

  expect(mergeFriendsDashboardPage).not.toHaveBeenCalledWith(staleComplete, staleComplete);
  expect(result.current.dashboard?.friends[0]?.id).toBe('fresh');
  expect(result.current.loadingMore).toBe(false);
  expect(result.current.hasMore).toBe(false);
});
