/**
 * "Odeslané pozvánky" on PartaPeopleScreen.
 *
 * An invite you sent has to stay visible and cancellable, and `?focus=outgoing`
 * — the route the invite-claim screen hands out when the claim only queued —
 * has to scroll to it.
 */

import React from 'react';
import { Text } from 'react-native';

import PartaPeopleScreen from '../PartaPeopleScreen';
import { cancelFriendRequest } from '@/data/friendsClient';
import { showAppDialog } from '@/components/shared/AppDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;
const reload = jest.fn();
const showToast = jest.fn();
const scrollTo = jest.fn();
let params: { focus?: string } = { focus: 'outgoing' };

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => params,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
  PlusIcon: () => null,
  XIcon: () => null,
}));
jest.mock('@/data/friendsClient', () => ({
  respondFriendRequest: jest.fn(async () => ({ ok: true })),
  cancelFriendRequest: jest.fn(async () => ({ ok: true })),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: { session: { accountId: string } }) => unknown) =>
    selector({ session: { accountId: 'account-a' } }),
}));
jest.mock('../usePartaDashboard', () => ({
  usePartaDashboard: () => ({
    dashboard: {
      friends: [],
      friendStats: {},
      following: [],
      incomingRequests: [],
      outgoingRequests: [
        {
          id: 'invite-1',
          recipient: { id: 'person-9', nickname: 'pepa', displayName: 'Pepa', avatarUrl: null },
        },
      ],
    },
    loading: false,
    refreshing: false,
    stale: false,
    reload,
    refresh: jest.fn(),
  }),
}));
jest.mock('../friendSafety', () => ({ useFriendSafety: () => jest.fn() }));
jest.mock('../FriendMini', () => ({
  FriendMini: ({ profile }: { profile: { nickname: string } }) =>
    React.createElement(Text, null, `@${profile.nickname}`),
  friendDisplayName: (profile: { nickname: string }) => `@${profile.nickname}`,
}));
jest.mock('../FriendListRow', () => ({ FriendListRow: () => null }));
jest.mock('../FollowingRow', () => ({ FollowingRow: () => null }));
jest.mock('../FriendsSkeleton', () => ({ __esModule: true, default: () => null }));
jest.mock('../OfflineBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('../PartaScreenHeader', () => ({ PartaScreenHeader: () => null }));
jest.mock('@/mocks/SectionBreak', () => ({
  SectionBreak: ({ title }: { title: string }) => React.createElement(Text, null, title),
}));

const CANCEL_LABEL = 'Zrušit pozvánku: @pepa';

describe('PartaPeopleScreen outgoing requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    params = { focus: 'outgoing' };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists who you have asked and cancels the invite on confirmation', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PartaPeopleScreen));
    });

    expect(renderer.root.findByProps({ children: 'Odeslané pozvánky' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: '@pepa' })).toBeTruthy();

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: CANCEL_LABEL }).props.onPress();
    });

    // The dialog asks first — nothing is cancelled by the tap alone.
    expect(cancelFriendRequest).not.toHaveBeenCalled();
    const dialog = jest.mocked(showAppDialog).mock.calls[0][0];
    expect(dialog.title).toBe('Zrušit pozvánku?');

    await act(async () => {
      dialog.buttons?.find((button) => button.style === 'destructive')?.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelFriendRequest).toHaveBeenCalledWith('person-9');
    expect(showToast).toHaveBeenCalledWith('Pozvánka zrušená.');
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('scrolls to the section when the claim screen sends you to focus=outgoing', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PartaPeopleScreen), {
        createNodeMock: () => ({ scrollTo }),
      });
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(scrollTo).toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
