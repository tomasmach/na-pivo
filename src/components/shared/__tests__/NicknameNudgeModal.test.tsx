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

let mockSegments: string[] = ['(tabs)'];
const mockModalVisibility: boolean[] = [];

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({ useSegments: () => mockSegments }));
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

function navigate(segments: string[]) {
  mockSegments = segments;
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
    mockSegments = ['(tabs)'];
    useLaunchModalMutex.setState({ holder: null });
    useReleaseStore.setState({ checkSettled: true, pendingNote: null });
    useOnboardingStore.setState({ firstLaunchSession: false });
    useAccountStore.setState({ session: null, profile: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays hidden while registration and the privacy screen cover the tabs', async () => {
    mockSegments = ['auth'];
    render(<NicknameNudgeModal />);
    await advance(600);

    // register() signs the session in before the nickname PATCH returns.
    signIn(null);
    await advance(600);
    signIn('pivar');
    navigate(['profile', 'privacy']);
    await advance(600);
    navigate(['(tabs)']);
    await advance(1200);

    expect(mockModalVisibility).not.toContain(true);
  });

  it('appears on the tabs after the settle delay when the nickname is still missing', async () => {
    mockSegments = ['auth'];
    render(<NicknameNudgeModal />);
    await advance(600);
    signIn(null);
    navigate(['profile', 'privacy']);
    await advance(600);
    expect(modalVisible()).toBe(false);

    navigate(['(tabs)']);
    await advance(599);
    expect(modalVisible()).toBe(false);
    await advance(1);
    expect(modalVisible()).toBe(true);

    fireEvent.press(screen.getByLabelText(t.nicknameNudge.skip));
    await advance(0);
    expect(modalVisible()).toBe(false);
    expect(await AsyncStorage.getItem(NICKNAME_NUDGE_SEEN_VERSION_KEY)).toBe('1.1.5');
  });

  it('hides as soon as a full-screen route covers the tabs', async () => {
    signIn(null);
    render(<NicknameNudgeModal />);
    await advance(600);
    expect(modalVisible()).toBe(true);

    navigate(['settings']);
    expect(modalVisible()).toBe(false);

    navigate(['(tabs)']);
    expect(modalVisible()).toBe(false);
    await advance(600);
    expect(modalVisible()).toBe(true);
  });
});
