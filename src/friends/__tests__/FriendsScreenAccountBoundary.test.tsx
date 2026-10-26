import React from 'react';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAccountStore } from '@/stores/accountStore';
import { fetchFriendsDashboard } from '@/data/friendsClient';
import { trackApiFailure, trackClientEvent } from '@/data/telemetryClient';
import { FRIENDS_DASHBOARD_SNAPSHOT_KEY, saveFriendsDashboardSnapshot, snapshotGeneration } from '@/data/friendsSnapshot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({ deviceId: 'b-device', accountId: 'b', token: 'b-token', authenticated: false })),
  fetchAccountPreferences: jest.fn(async () => null),
  setAnonymousSessionEvictionListener: jest.fn(),
}));
jest.mock('@/data/auth', () => ({
  fetchAccountProfile: jest.fn(async () => null),
  logout: jest.fn(async () => {
    await require('@/data/privateAccountData').clearLocalPrivateAccountData();
    return { ok: true };
  }),
}));
jest.mock('@/data/telemetryClient', () => ({
  setTelemetrySession: jest.fn(), trackApiFailure: jest.fn(), trackClientEvent: jest.fn(),
}));
jest.mock('@/data/diarySync', () => ({
  reconcileDiarySnapshot: jest.fn(async () => null), restoreAccountDiary: jest.fn(),
}));
jest.mock('@/data/friendsClient', () => ({
  DEFAULT_FRIEND_SOCIAL_SETTINGS: {},
  fetchFriendsDashboard: jest.fn(async () => null),
  fetchFriendsLive: jest.fn(async () => null),
  endFriendPubActivity: jest.fn(), markFriendNotificationsRead: jest.fn(), respondFriendRequest: jest.fn(),
}));
jest.mock('@/data/beerCheckinsClient', () => ({ fetchBeerCheckInFeed: jest.fn(async () => null) }));
jest.mock('@/data/partaFeedClient', () => ({ fetchPartaFeed: jest.fn(async () => null) }));
jest.mock('@/data/leaderboardsClient', () => ({
  fetchLeaderboard: jest.fn(async () => null), clearLeaderboardsCache: jest.fn(),
}));
jest.mock('@/data/photoContestClient', () => ({
  fetchPhotoContestTeaser: jest.fn(async () => null),
  clearPhotoContestTeaserCache: jest.fn(),
}));
jest.mock('@/notifications/friendPush', () => ({
  ensureFriendPushRegisteredIfGranted: jest.fn(), registerFriendPush: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    SafeAreaInsetsContext: R.createContext(null), SafeAreaProvider: ({ children }: any) => children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

let focused = false;
jest.doMock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    React.useEffect(() => focused ? effect() : undefined, [effect, focused]);
  },
}));
jest.doMock('@/navigation/TabScreen', () => ({ useFirstFocus: () => focused, useBottomInset: () => 0 }));
jest.doMock('@/components/shared/AppDialog', () => ({ useShowAppDialog: () => jest.fn() }));
jest.doMock('@/friends/friendSafety', () => ({ useFriendSafety: () => jest.fn() }));

// The real screen, stores, snapshot and account cleanup run; only the UI
// leaves it imports are replaced, so the test reads what the screen passes them.
const file = path.join(__dirname, '..', 'FriendsScreen.tsx');
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const keep = new Set(['./partyLeaderboard', './sharedTable', './partaFeedMerge', './friendSafety']);
for (const statement of source.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
  const specifier = statement.moduleSpecifier.text;
  const ui = specifier.startsWith('./') && !keep.has(specifier)
    || specifier.startsWith('@/components/') && !specifier.endsWith('/AppDialog')
    || specifier.startsWith('@/photos/') || specifier === '@/counter/NudgeSlot'
    || specifier === '@/tours/TourGlanceLine' || specifier === '@/layout/TwoColumns';
  if (!ui) continue;
  const exports: Record<string, unknown> = { __esModule: true };
  const clause = statement.importClause;
  if (clause?.name) {
    const name = clause.name.text;
    exports.default = (props: any) => React.createElement(name, props, props.children);
  }
  if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const binding of clause.namedBindings.elements) {
      if (binding.isTypeOnly) continue;
      const name = (binding.propertyName ?? binding.name).text;
      exports[name] = name === 'TwoColumns'
        ? ({ first, second }: any) => <>{first}{second}</>
        : name === 'Modal'
          ? ({ visible, children }: any) => visible ? children : null
          : name === 'friendDisplayName'
            ? (account: any) => account.nickname || account.displayName || 'friend'
            : (props: any) => React.createElement(name, props, props.children);
    }
  }
  const mockPath = specifier.startsWith('./') ? `@/friends/${specifier.slice(2)}` : specifier;
  jest.doMock(mockPath, () => exports);
}
const FriendsScreen = require('@/friends/FriendsScreen').default;
const Renderer = require('react-test-renderer');
const { act } = Renderer;

let renderer: any;
afterEach(() => act(() => renderer?.unmount()));

function dashboardWith(pub: string) {
  const account = { id: `${pub}-friend`, nickname: `${pub}-friend` };
  return {
    friends: [{ id: `${pub}-friendship`, account }],
    activeFriends: [{ id: `${pub}-activity`, account, name: pub, responses: { maybe: 0, going: 0, goingProfiles: [] } }],
    myActiveActivity: null, plans: [], myPlan: null,
    presence: [], myPresence: null, incomingRequests: [], outgoingRequests: [],
    notifications: [], unreadCount: 0, settings: { ghostMode: false },
    streak: { currentWeeks: 0, thisWeekLit: false }, leaderboard: [],
  };
}

it('drops account A social data when the hidden tab outlives logout and sign-in', async () => {
  await AsyncStorage.clear();
  await saveFriendsDashboardSnapshot(dashboardWith('A pub') as never, snapshotGeneration());
  useAccountStore.setState({
    session: { deviceId: 'a-device', accountId: 'a', token: 'a-token', authenticated: true },
    profile: null, status: 'ready',
  });

  await act(async () => { renderer = Renderer.create(<FriendsScreen />); });
  const activeCards = () => renderer.root.findAllByType('FriendActiveCard')
    .map((card: any) => card.props.activity.name);
  expect(activeCards()).toEqual(['A pub']);
  // The tab mounts with the app; nothing reaches the server before its first focus.
  expect(fetchFriendsDashboard).not.toHaveBeenCalled();
  expect(trackApiFailure).not.toHaveBeenCalled();
  expect(trackClientEvent).not.toHaveBeenCalled();

  await act(async () => { await useAccountStore.getState().logout(); });
  expect(useAccountStore.getState().session?.accountId).toBe('b');
  expect(await AsyncStorage.getItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY)).toBeNull();

  // First visit as account B with the dashboard fetch failing.
  focused = true;
  await act(async () => { renderer.update(<FriendsScreen />); });
  expect(fetchFriendsDashboard).toHaveBeenCalledTimes(1);
  expect(activeCards()).toEqual([]);

  // Signing in to account C while on the tab shows C's dashboard.
  jest.mocked(fetchFriendsDashboard).mockResolvedValue(dashboardWith('C pub') as never);
  await act(async () => {
    useAccountStore.setState({
      session: { deviceId: 'b-device', accountId: 'c', token: 'c-token', authenticated: true },
    });
  });
  expect(fetchFriendsDashboard).toHaveBeenCalledTimes(2);
  expect(activeCards()).toEqual(['C pub']);
});
