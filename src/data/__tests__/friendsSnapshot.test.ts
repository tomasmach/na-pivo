import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  clearFriendsDashboardSnapshot,
  loadFriendsDashboardSnapshot,
  loadPartaPlansSnapshot,
  PARTA_PLANS_SNAPSHOT_KEY,
  saveFriendsDashboardSnapshot,
  savePartaPlansSnapshot,
  snapshotGeneration,
} from '../friendsSnapshot';
import type { FriendsDashboard } from '../friendsClient';
import type { PartaPlan } from '../partaPlansClient';

function dashboard(overrides: Partial<FriendsDashboard> = {}): FriendsDashboard {
  return {
    friends: [],
    friendStats: {},
    incomingRequests: [],
    outgoingRequests: [],
    activeFriends: [],
    myActiveActivity: null,
    presence: [],
    myPresence: null,
    settings: {
      ghostMode: false,
      quietHoursEnabled: true,
      quietHoursStart: 23,
      quietHoursEnd: 9,
      shareDrinksWithParta: true,
    },
    notifications: [],
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

it('still opens a snapshot an older build saved with the leaderboard', async () => {
  const legacy = { ...withFriend('alice'), leaderboard: [{ visits30d: 0 }], streak: { currentWeeks: 2 }, unreadCount: 3 };
  await AsyncStorage.setItem('na-pivo-friends-dashboard', JSON.stringify({ savedAt: Date.now(), dashboard: legacy, leaderboardVersion: 1 }));
  const snap = await loadFriendsDashboardSnapshot();
  expect(snap?.dashboard.friends).toEqual(legacy.friends);
  expect(snap?.dashboard.presence).toEqual([]);
});

function plan(id: string, expiresAt: string): PartaPlan {
  return {
    id,
    account: { id: 'klara', nickname: 'klara', displayName: 'Klára', avatarUrl: null, isPublic: true },
    expiresAt,
    responses: { going: 0, maybe: 0, cant: 0, goingProfiles: [] },
  } as unknown as PartaPlan;
}

it('keeps saved invitations until they expire and skips unreadable ones', async () => {
  const now = Date.parse('2026-11-05T18:00:00Z');
  await savePartaPlansSnapshot([plan('saturday', '2026-11-08T03:00:00Z'), plan('yesterday', '2026-11-05T03:00:00Z')], snapshotGeneration());
  expect((await loadPartaPlansSnapshot(now))?.map((p) => p.id)).toEqual(['saturday']);

  await AsyncStorage.setItem(PARTA_PLANS_SNAPSHOT_KEY, JSON.stringify([{ id: 'broken' }, { ...plan('no-name', ''), account: {} }, plan('ok', '')]));
  expect((await loadPartaPlansSnapshot(now))?.map((p) => p.id)).toEqual(['ok']);

  await AsyncStorage.setItem(PARTA_PLANS_SNAPSHOT_KEY, '{not json');
  expect(await loadPartaPlansSnapshot(now)).toBeNull();
});

it('wipes saved invitations at an account boundary and drops a stale write', async () => {
  const before = snapshotGeneration();
  await savePartaPlansSnapshot([plan('mine', '')], before);
  await clearFriendsDashboardSnapshot();
  expect(await loadPartaPlansSnapshot()).toBeNull();

  await savePartaPlansSnapshot([plan('previous-account', '')], before);
  expect(await loadPartaPlansSnapshot()).toBeNull();
});
