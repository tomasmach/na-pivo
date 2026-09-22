import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform, TextInput, UIManager, findNodeHandle } from 'react-native';

import ManagePartaScreen from '../profile/parta';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/utils/useKeyboardHeight', () => ({ useKeyboardHeight: () => 200 }));
jest.mock('@/data/friendsClient', () => ({ fetchFriendsDashboard: async () => null }));
jest.mock('@/data/friendsSnapshot', () => ({ loadFriendsDashboardSnapshot: async () => null }));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: () => 'test-account' }));
jest.mock('@/stores/toastStore', () => ({ useToastStore: () => jest.fn() }));
jest.mock('@/friends/friendSafety', () => ({ useFriendSafety: () => jest.fn() }));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null, ChevronRightIcon: () => null, UserPlusIcon: () => null,
}));
jest.mock('@/friends/CodeSheet', () => () => null);
jest.mock('@/friends/FriendListRow', () => ({ FriendListRow: () => null }));
jest.mock('@/friends/FriendsSkeleton', () => () => null);
jest.mock('@/friends/OfflineBanner', () => () => null);
jest.mock('@/friends/OutgoingInvites', () => ({ OutgoingInvites: () => null }));
jest.mock('@/friends/SectionHeader', () => () => null);
jest.mock('@/friends/AddFriendTools', () => ({
  AddFriendTools: () => {
    const React = jest.requireActual<typeof import('react')>('react');
    const { TextInput } = jest.requireMock('react-native');
    return React.createElement(TextInput, { testID: 'nickname-search' });
  },
}));
jest.mock('react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  const scrollTo = jest.fn();
  const instance = { scrollTo };
  return {
    ...native,
    ScrollView: React.forwardRef(function ScrollView(
      { children, ...props }: { children?: React.ReactNode; [key: string]: unknown },
      ref: React.ForwardedRef<typeof instance>,
    ) {
      React.useImperativeHandle(ref, () => instance);
      return React.createElement('ScrollView', { ...props, testID: 'friends-scroll' }, children);
    }),
    TextInput: Object.assign(
      (props: object) => React.createElement('TextInput', props),
      { State: { currentlyFocusedInput: jest.fn() } },
    ),
    UIManager: { measureLayout: jest.fn() },
    findNodeHandle: jest.fn(),
    __scrollTo: scrollTo,
  };
});

describe('Správa party with the Android keyboard open', () => {
  const previousPlatform = Platform.OS;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Platform.OS = 'android';
    global.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 16) as unknown as number;
    global.cancelAnimationFrame = (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    const input = {};
    (TextInput.State.currentlyFocusedInput as jest.Mock).mockReturnValue(input);
    (findNodeHandle as jest.Mock).mockImplementation((node) => node === input ? 22 : 99);
    (UIManager.measureLayout as jest.Mock).mockImplementation((_target, _parent, _fail, done) => {
      done(0, 160, 200, 44);
    });
  });

  afterEach(() => {
    Platform.OS = previousPlatform;
    jest.useRealTimers();
  });

  it('keeps a visible nickname field in place after the parent shrinks for the keyboard', async () => {
    const screen = render(<ManagePartaScreen />);
    await act(async () => { jest.advanceTimersByTime(1); });
    const scroll = screen.getByTestId('friends-scroll');
    // KeyboardAvoidingView has already reduced this viewport by 200 pixels.
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } } });
    fireEvent(scroll, 'contentSizeChange', 320, 700);
    fireEvent(screen.getByTestId('nickname-search'), 'focus', { target: 22, nativeEvent: { target: 22 } });
    act(() => { jest.advanceTimersByTime(350); });

    expect((jest.requireMock('react-native') as { __scrollTo: jest.Mock }).__scrollTo).not.toHaveBeenCalled();
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(false);
  });
});
