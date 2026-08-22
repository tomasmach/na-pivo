import React from 'react';
import { Modal } from 'react-native';
import { act, cleanup, render } from '@testing-library/react-native';

import { ContestResultsModal } from '@/photos/ContestResultsModal';
import { MODAL_DISMISS_MS, useLaunchModalMutex } from '@/stores/launchModalMutex';

const dismissResult = jest.fn();
const contestState = {
  pendingResult: {
    contestId: 'contest-1',
    rank: 1,
    votes: 12,
    xpAwarded: 20,
    winsCount: 1,
    imageUrl: null,
  },
  ingestSnapshot: jest.fn(),
  dismissResult,
};

jest.mock('@/stores/contestResultsStore', () => ({
  useContestResultsStore: (selector: (state: typeof contestState) => unknown) =>
    selector(contestState),
}));
jest.mock('@/stores/releaseStore', () => ({
  useReleaseStore: (selector: (state: { checkSettled: boolean; pendingNote: null }) => unknown) =>
    selector({ checkSettled: true, pendingNote: null }),
}));
jest.mock('@/data/photoContestClient', () => ({
  fetchPhotoContestTeaser: jest.fn(() => new Promise(() => undefined)),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/components/celebration/BeerBubbles', () => ({ BeerBubbles: () => null }));
jest.mock('@/components/celebration/SoftGlow', () => ({ SoftGlow: () => null }));
jest.mock('@/utils/haptics', () => ({ fireSuccessHaptic: jest.fn() }));
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireMock('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (value: unknown) => value, quad: 'quad' },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: (_delay: number, value: unknown) => value,
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});

describe('ContestResultsModal dismissal lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    dismissResult.mockClear();
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) useLaunchModalMutex.getState().release(holder);
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) act(() => useLaunchModalMutex.getState().release(holder));
    jest.useRealTimers();
  });

  it('keeps the pending result until native dismissal and 260 ms both complete', () => {
    const screen = render(<ContestResultsModal />);
    const modal = screen.UNSAFE_getByType(Modal);
    const completeNativeDismiss = modal.props.onDismiss;

    act(() => modal.props.onRequestClose());
    expect(dismissResult).not.toHaveBeenCalled();
    expect(useLaunchModalMutex.getState().holder).toBe('contest-results');

    act(() => completeNativeDismiss());
    act(() => jest.advanceTimersByTime(MODAL_DISMISS_MS - 1));
    expect(dismissResult).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(dismissResult).toHaveBeenCalledTimes(1);
    expect(useLaunchModalMutex.getState().holder).toBeNull();
  });
});
