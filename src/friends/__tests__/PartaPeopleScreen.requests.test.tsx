import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import PartaPeopleScreen from '../PartaPeopleScreen';
import { respondFriendRequest } from '@/data/friendsClient';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '@/data/privateAccountBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;
const reload = jest.fn();
const showToast = jest.fn();
let accountId = 'account-a';
let params: { focus?: string; friendshipId?: string } = {
  focus: 'requests',
  friendshipId: 'request-1',
};

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected async work did not start.');
}

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => params,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
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
    selector({ session: { accountId } }),
}));
jest.mock('../usePartaDashboard', () => ({
  usePartaDashboard: () => ({
    dashboard: {
      friends: [],
      friendStats: {},
      following: [],
      incomingRequests: [
        {
          id: 'request-1',
          requester: { id: 'person-1', nickname: 'jana', displayName: 'Jana', avatarUrl: null },
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
}));
jest.mock('../FriendListRow', () => ({ FriendListRow: () => null }));
jest.mock('../FollowingRow', () => ({ FollowingRow: () => null }));
jest.mock('../FriendsSkeleton', () => ({ __esModule: true, default: () => null }));
jest.mock('../OfflineBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('../PartaScreenHeader', () => ({ PartaScreenHeader: () => null }));
jest.mock('@/mocks/SectionBreak', () => ({ SectionBreak: () => null }));

describe('PartaPeopleScreen incoming requests', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPrivateAccountBoundaryForTests();
    await AsyncStorage.clear();
    accountId = 'account-a';
    params = { focus: 'requests', friendshipId: 'request-1' };
    jest.mocked(respondFriendRequest).mockResolvedValue({ ok: true });
  });

  it('shows the requester and lets a push recipient accept the request', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PartaPeopleScreen));
    });

    expect(renderer.root.findByProps({ children: '@jana' })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: 'Nechat být' })).toBeTruthy();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Přijmout' }).props.onPress();
      await flushUntil(() => jest.mocked(respondFriendRequest).mock.calls.length > 0);
      await Promise.resolve();
    });

    expect(respondFriendRequest).toHaveBeenCalledWith('request-1', 'accept');
    expect(showToast).toHaveBeenCalledWith('Je v partě.');
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('lets the recipient reject the request from the same push destination', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PartaPeopleScreen));
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Nechat být' }).props.onPress();
      await flushUntil(() => jest.mocked(respondFriendRequest).mock.calls.length > 0);
      await Promise.resolve();
    });

    expect(respondFriendRequest).toHaveBeenCalledWith('request-1', 'decline');
    expect(showToast).toHaveBeenCalledWith('Pozvánka je pryč.');
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('allows only one accept-or-decline response while the request is pending', async () => {
    let resolveResponse!: (result: { ok: true }) => void;
    jest.mocked(respondFriendRequest).mockImplementation(
      () => new Promise((resolve) => { resolveResponse = resolve; }),
    );
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PartaPeopleScreen));
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Přijmout' }).props.onPress();
      renderer.root.findByProps({ accessibilityLabel: 'Nechat být' }).props.onPress();
      await flushUntil(() => jest.mocked(respondFriendRequest).mock.calls.length > 0);
    });

    expect(respondFriendRequest).toHaveBeenCalledTimes(1);
    expect(respondFriendRequest).toHaveBeenCalledWith('request-1', 'accept');
    expect(
      renderer.root.findByProps({ accessibilityLabel: 'Přijmout' }).props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });
    expect(
      renderer.root.findByProps({ accessibilityLabel: 'Nechat být' }).props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });

    await act(async () => {
      resolveResponse({ ok: true });
      await Promise.resolve();
    });
    act(() => renderer.unmount());
  });

  it('does not send an A response after an account transition freezes its queued mutation', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PartaPeopleScreen));
    });

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: 'Přijmout' }).props.onPress();
    });
    const transition = beginPrivateAccountTransition('test A to B', 'account-a');
    expect(transition).not.toBeNull();

    await act(async () => {
      await transition?.drain();
      transition?.release();
      await Promise.resolve();
    });

    expect(respondFriendRequest).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('drops a late A response after A to B to A and resets the new A controls', async () => {
    let resolveOldResponse!: (result: { ok: false; code: string; detail: string }) => void;
    jest.mocked(respondFriendRequest).mockImplementation(
      () => new Promise((resolve) => { resolveOldResponse = resolve; }),
    );
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PartaPeopleScreen));
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Přijmout' }).props.onPress();
      await flushUntil(() => typeof resolveOldResponse === 'function');
    });

    act(() => {
      accountId = 'account-b';
      renderer.update(React.createElement(PartaPeopleScreen));
    });
    act(() => {
      accountId = 'account-a';
      renderer.update(React.createElement(PartaPeopleScreen));
    });

    expect(renderer.root.findByProps({ accessibilityLabel: 'Přijmout' }).props.disabled).toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Nechat být' }).props.disabled).toBe(false);

    await act(async () => {
      resolveOldResponse({ ok: false, code: 'network_error', detail: 'stará chyba účtu A' });
      await Promise.resolve();
    });

    expect(showToast).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
