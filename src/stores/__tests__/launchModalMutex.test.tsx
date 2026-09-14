import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

import {
  MODAL_DISMISS_MS,
  useLaunchModalMutex,
  useModalPresentation,
} from '@/stores/launchModalMutex';

function PresentationProbe({ first, second }: { first: boolean; second: boolean }) {
  const one = useModalPresentation(first, 'first');
  const two = useModalPresentation(second, 'second');
  return (
    <View>
      <Text testID="first-visible">{String(one.visible)}</Text>
      <Text testID="second-visible">{String(two.visible)}</Text>
      <Pressable testID="first-dismissed" onPress={one.onDismiss} />
    </View>
  );
}

describe('modal presentation mutex', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) act(() => useLaunchModalMutex.getState().release(holder));
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) act(() => useLaunchModalMutex.getState().release(holder));
    jest.useRealTimers();
  });

  it('queues a sibling until native dismissal and the full safety delay', () => {
    const screen = render(<PresentationProbe first second />);

    expect(screen.getByTestId('first-visible').props.children).toBe('true');
    expect(screen.getByTestId('second-visible').props.children).toBe('false');

    screen.rerender(<PresentationProbe first={false} second />);
    fireEvent.press(screen.getByTestId('first-dismissed'));

    act(() => jest.advanceTimersByTime(MODAL_DISMISS_MS - 1));
    expect(screen.getByTestId('second-visible').props.children).toBe('false');

    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByTestId('second-visible').props.children).toBe('true');
  });
});
