import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearFriendsDashboardSnapshot,
  loadFriendsDashboardSnapshot,
  saveFriendsDashboardSnapshot,
  snapshotGeneration,
} from '../friendsSnapshot';
import type { FriendsDashboard } from '../friendsClient';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function dashboard(overrides: Partial<FriendsDashboard> = {}): FriendsDashboard {
  return {
    friends: [],
    friendStats: {},
    incomingRequests: [],
    outgoingRequests: [],
    following: [],
    followersCount: 0,
    activeFriends: [],
    myActiveActivity: null,
    plans: [],
    myPlan: null,
    blockedIds: [],
    presence: [],
    myPresence: null,
    settings: {
      ghostMode: false,
      quietHoursEnabled: true,
      quietHoursStart: 23,
      quietHoursEnd: 9,
      shareDrinksWithParta: true,
    },
    streak: { currentWeeks: 0, thisWeekLit: false },
    leaderboard: [],
    notifications: [],
    unreadCount: 0,
    ...overrides,
  };
}

/** A minimal friend profile so a stored graph is recognisably non-empty. */
function withFriend(id: string): FriendsDashboard {
  return dashboard({
    friends: [{ id, nickname: id, displayName: id, avatarUrl: null, isPublic: true }],
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('round-trips a snapshot written under the current generation', async () => {
  await saveFriendsDashboardSnapshot(withFriend('alice'), snapshotGeneration());
  const snap = await loadFriendsDashboardSnapshot();
  expect(snap?.dashboard.friends[0].id).toBe('alice');
  expect(typeof snap?.savedAt).toBe('number');
});

it('sanitizes every dashboard branch from malformed persisted JSON', async () => {
  await AsyncStorage.setItem('na-pivo-friends-dashboard', JSON.stringify({
    savedAt: Date.now(),
    dashboard: {
      friends: [null, { id: 'alice', displayName: 42, avatarUrl: 7 }],
      friendStats: { alice: { sharedPubCount: 'many', rituals: [null, { key: 'k', title: 'T' }] } },
      incomingRequests: 'bad',
      outgoingRequests: [],
      following: [{ id: 'bob', displayName: 'Bob', lastDrink: 123 }],
      followersCount: Number.NaN,
      activeFriends: [{ id: 'broken', account: null }],
      myActiveActivity: { id: 'broken', account: null },
      plans: null,
      myPlan: null,
      presence: [{ account: { id: 'alice', displayName: 'Alice' }, lat: '50', beers: -1 }],
      myPresence: { account: null },
      blockedIds: ['blocked', 42, ''],
      settings: { quietHoursStart: 99, quietHoursEnd: -1 },
      streak: { currentWeeks: 'five', thisWeekLit: 'yes' },
      leaderboard: [{ account: null }],
      notifications: [{ id: 'n1', kind: 42 }, null],
      unreadCount: -4,
    },
  }));

  const snapshot = await loadFriendsDashboardSnapshot();

  expect(snapshot?.dashboard).toMatchObject({
    friends: [{ id: 'alice', displayName: '', avatarUrl: null }],
    incomingRequests: [],
    activeFriends: [],
    myActiveActivity: null,
    plans: [],
    myPlan: null,
    myPresence: null,
    blockedIds: ['blocked'],
    settings: { quietHoursStart: 23, quietHoursEnd: 9 },
    streak: { currentWeeks: 0, thisWeekLit: false },
    leaderboard: [],
    notifications: [expect.objectContaining({ id: 'n1', kind: 'friend_at_pub' })],
    unreadCount: 0,
  });
  expect(snapshot?.dashboard.presence).toEqual([
    expect.objectContaining({ beers: 0, lat: null, lng: null }),
  ]);
});

it('drops a write whose generation predates an account-boundary clear', async () => {
  // Account A's dashboard fetch captured the generation before it began.
  const genA = snapshotGeneration();

  // Logout clears the snapshot and rotates the session (bumps the generation).
  await clearFriendsDashboardSnapshot();
  expect(await loadFriendsDashboardSnapshot()).toBeNull();

  // A's still-in-flight fetch now resolves and tries to persist A's graph. It must
  // be suppressed so B never hydrates A's friends behind the OfflineBanner.
  await saveFriendsDashboardSnapshot(withFriend('alice'), genA);
  expect(await loadFriendsDashboardSnapshot()).toBeNull();
});

it('persists a write made under the post-clear generation (guard is not permanent)', async () => {
  await clearFriendsDashboardSnapshot();
  // Account B fetches after the boundary → its write uses the new generation.
  await saveFriendsDashboardSnapshot(withFriend('bob'), snapshotGeneration());
  const snap = await loadFriendsDashboardSnapshot();
  expect(snap?.dashboard.friends[0].id).toBe('bob');
});

it('round-trips relationship pagination metadata for offline continuation', async () => {
  const relationshipPage = {
    friendsCount: 250,
    followingCount: 120,
    nextCursor: 100,
    followingNextCursor: 90,
    friendsTruncated: true,
    followingTruncated: true,
  };
  const d = dashboard({ friends: [{ id: 'f1', nickname: 'f1', displayName: 'f1', avatarUrl: null, isPublic: true }], relationshipPage });

  await saveFriendsDashboardSnapshot(d, snapshotGeneration());
  const snap = await loadFriendsDashboardSnapshot();

  expect(snap?.dashboard.relationshipPage).toEqual(relationshipPage);
});
