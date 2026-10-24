import React from 'react';

import FriendProfileScreen from '@/friends/FriendProfileScreen';
import { blockFriend, fetchFriendProfile, removeFriend, type FriendProfileDetail } from '@/data/friendsClient';
import { DetailContext } from '@/layout/detail';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { t } from '@/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dialogs: { buttons: { text: string; onPress?: () => void }[] }[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({
  useShowAppDialog: () => (options: (typeof dialogs)[number]) => dialogs.push(options),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  withSpring: (value: number) => value,
  withTiming: (value: number) => value,
}));
jest.mock('@/components/shared/IconGlyph', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/friends/SkeletonBlock', () => () => null);
jest.mock('@/navigation/TabScreen', () => ({ useTabBarInset: () => 0 }));
jest.mock('@/data/beerPhotosClient', () => ({ fetchFriendBeerPhotos: jest.fn(async () => null) }));
jest.mock('@/data/friendsClient', () => ({
  blockFriend: jest.fn(),
  fetchFriendProfile: jest.fn(),
  removeFriend: jest.fn(),
  respondFriendRequest: jest.fn(),
  sendFriendRequest: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const DETAIL: FriendProfileDetail = {
  profile: { id: 'acc-2', nickname: 'pepa', displayName: 'Pepa', avatarUrl: null, isPublic: false },
  isFriend: true,
  friendshipId: 'f-1',
  stats: { sharedPubCount: 0, nightsTogether: 0, lastSharedAt: null, lastPubName: '', streakWeeks: 0, rituals: [] },
  liveActivity: null,
  plan: null,
  recentTogether: [],
  latestBeers: [],
  blocked: false,
  friendshipStatus: 'accepted',
  incomingRequestId: null,
  publicStats: null,
  badgeProgress: null,
  publicTours: [],
};

/** The friend's profile in Parta's right half, with its overflow menu open on `action`. */
async function choose(action: string, confirm: string) {
  const nav = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), showCompass: jest.fn() };
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(
      <DetailContext.Provider value={{ params: { id: 'acc-2' }, nav }}>
        <FriendProfileScreen />
      </DetailContext.Provider>,
    );
  });
  act(() => renderer.root.findByProps({ accessibilityLabel: t.friends.profileActionsA11y }).props.onPress());
  act(() => dialogs.at(-1)!.buttons.find((button) => button.text === action)!.onPress!());
  await act(async () => dialogs.at(-1)!.buttons.find((button) => button.text === confirm)!.onPress!());
  act(() => renderer.unmount());
  return nav;
}

describe('FriendProfileScreen in the right half', () => {
  beforeEach(() => {
    dialogs.length = 0;
    usePartaSignalStore.setState({ pendingRefresh: false, focusTarget: null });
    (fetchFriendProfile as jest.Mock).mockResolvedValue(DETAIL);
  });

  it('asks Parta to reload after removing the friend, since closing the page does not refocus it', async () => {
    (removeFriend as jest.Mock).mockResolvedValue({ ok: true });
    const nav = await choose(t.friends.profileRemove, t.friends.removeConfirm);
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(usePartaSignalStore.getState().pendingRefresh).toBe(true);
  });

  it('asks Parta to reload after blocking', async () => {
    (blockFriend as jest.Mock).mockResolvedValue({ ok: true });
    await choose(t.friends.blockAction, t.friends.blockConfirm);
    expect(usePartaSignalStore.getState().pendingRefresh).toBe(true);
  });

  it('leaves Parta alone when the removal failed', async () => {
    (removeFriend as jest.Mock).mockResolvedValue({ ok: false, detail: 'Nejde to.' });
    const nav = await choose(t.friends.profileRemove, t.friends.removeConfirm);
    expect(nav.back).not.toHaveBeenCalled();
    expect(usePartaSignalStore.getState().pendingRefresh).toBe(false);
  });
});
