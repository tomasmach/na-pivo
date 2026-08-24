import React from 'react';
import { Modal, Text } from 'react-native';
import { act, cleanup, render } from '@testing-library/react-native';

import {
  BottomSheetModal,
  bottomSheetKeyboardOffset,
} from '@/components/shared/BottomSheetModal';
import { useLaunchModalMutex } from '@/stores/launchModalMutex';

let keyboardHeight = 0;

jest.mock('@/utils/useKeyboardHeight', () => ({
  useKeyboardHeight: () => keyboardHeight,
}));

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireMock('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    useSharedValue: (value: unknown) => ({ value }),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});

describe('BottomSheetModal lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    keyboardHeight = 0;
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

  it('lifts the card host by the exact keyboard height', () => {
    expect(bottomSheetKeyboardOffset(240)).toBe(240);
    expect(bottomSheetKeyboardOffset(0)).toBe(0);
  });

  it('does not present a sibling until iOS reports the native sheet dismissed', () => {
    function Sheets({ first, second }: { first: boolean; second: boolean }) {
      return (
        <>
          <BottomSheetModal visible={first} presentationId="first" onClose={jest.fn()}>
            <Text>První</Text>
          </BottomSheetModal>
          <BottomSheetModal visible={second} presentationId="second" onClose={jest.fn()}>
            <Text>Druhý</Text>
          </BottomSheetModal>
        </>
      );
    }

    const screen = render(<Sheets first second />);
    expect(useLaunchModalMutex.getState().holder).toBe('first');

    const firstNativeModal = screen.UNSAFE_getByType(Modal);
    const completeFirstDismiss = firstNativeModal.props.onDismiss;
    screen.rerender(<Sheets first={false} second />);
    act(() => jest.advanceTimersByTime(280));
    expect(useLaunchModalMutex.getState().holder).toBe('first');

    act(() => completeFirstDismiss());
    expect(useLaunchModalMutex.getState().holder).toBe('second');
  });
});
