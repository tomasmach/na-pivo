import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { AccountProfile } from '@/data/auth';
import { t } from '@/i18n';
import { NICKNAME_NUDGE_SEEN_VERSION_KEY } from '@/profile/nicknameNudge';
import { useAccountStore } from '@/stores/accountStore';
import { useLaunchModalMutex } from '@/stores/launchModalMutex';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useReleaseStore } from '@/stores/releaseStore';

import { NicknameNudgeModal } from '../NicknameNudgeModal';

type MockRootState = { routes: { name: string; state?: { routes: { name: string }[] } }[] };

let mockRootState: MockRootState;
const mockModalVisibility: boolean[] = [];

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({ useRootNavigationState: () => mockRootState }));
jest.mock('react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ...ReactNative,
    Modal: ({ children, visible, ...props }: { children?: React.ReactNode; visible: boolean }) => {
      mockModalVisibility.push(visible);
      return React.createElement('Modal', { ...props, visible }, children);
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  withSpring: (value: number) => value,
  withTiming: (value: number) => value,
}));
jest.mock('@/components/shared/GlowButton', () => ({ GlowButton: () => null }));
jest.mock('@/profile/NicknameField', () => ({ NicknameField: () => null }));

const modalVisible = () => mockModalVisibility[mockModalVisibility.length - 1];

// The root navigator holds a single `__root` route wrapping the app's Stack.
function rootStack(...routes: string[]): MockRootState {
  return { routes: [{ name: '__root', state: { routes: routes.map((name) => ({ name })) } }] };
}

function navigate(...routes: string[]) {
  mockRootState = rootStack(...routes);
  screen.rerender(<NicknameNudgeModal />);
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function signIn(nickname: string | null) {
  act(() => {
    useAccountStore.setState({
      session: { deviceId: 'device', accountId: 'account', token: 'token', authenticated: true },
      profile: { nickname } as AccountProfile,
    });
  });
}

describe('NicknameNudgeModal', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    mockModalVisibility.length = 0;
    mockRootState = rootStack('(tabs)');
    useLaunchModalMutex.setState({ holder: null });
    useReleaseStore.setState({ checkSettled: true, pendingNote: null });
    useOnboardingStore.setState({ firstLaunchSession: false });
    useAccountStore.setState({ session: null, profile: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays hidden while registration and the privacy screen cover the tabs', async () => {
    mockRootState = rootStack('(tabs)', 'auth/index');
    render(<NicknameNudgeModal />);
    await advance(600);

    // register() signs the session in before the nickname PATCH returns.
    signIn(null);
    await advance(600);
    signIn('pivar');
    navigate('(tabs)', 'profile/privacy');
    await advance(600);
    // profile/privacy leaves with router.replace('/(tabs)').
    navigate('(tabs)', '(tabs)');
    await advance(1200);

    expect(mockModalVisibility).not.toContain(true);
  });

  it('appears on the tabs after the settle delay when the nickname is still missing', async () => {
    mockRootState = rootStack('(tabs)', 'auth/index');
    render(<NicknameNudgeModal />);
    await advance(600);
    signIn(null);
    navigate('(tabs)', 'profile/privacy');
    await advance(600);
    expect(modalVisible()).toBe(false);

    navigate('(tabs)', '(tabs)');
    await advance(599);
    expect(modalVisible()).toBe(false);
    await advance(1);
    expect(modalVisible()).toBe(true);

    fireEvent.press(screen.getByLabelText(t.nicknameNudge.skip));
    await advance(0);
    expect(modalVisible()).toBe(false);
    expect(await AsyncStorage.getItem(NICKNAME_NUDGE_SEEN_VERSION_KEY)).toBe('1.1.5');
  });

  it('stays hidden while a tab route is pushed above a full-screen route', async () => {
    mockRootState = { routes: [{ name: '__root' }] };
    signIn(null);
    render(<NicknameNudgeModal />);
    await advance(1200);
    navigate('(tabs)', 'profile/privacy');
    await advance(600);

    // A notification tap pushes /beer while profile/privacy is still up.
    navigate('(tabs)', 'profile/privacy', '(tabs)');
    await advance(1200);
    expect(mockModalVisibility).not.toContain(true);

    navigate('(tabs)');
    await advance(600);
    expect(modalVisible()).toBe(true);
  });

  it('keeps showing and holds the launch slot when a route opens above it', async () => {
    signIn(null);
    render(<NicknameNudgeModal />);
    await advance(600);
    expect(modalVisible()).toBe(true);

    navigate('(tabs)', 'settings');
    expect(modalVisible()).toBe(true);
    expect(useLaunchModalMutex.getState().holder).toBe('nickname-nudge');

    fireEvent.press(screen.getByLabelText(t.nicknameNudge.skip));
    await advance(0);
    expect(modalVisible()).toBe(false);
    expect(useLaunchModalMutex.getState().holder).toBeNull();
  });
});
