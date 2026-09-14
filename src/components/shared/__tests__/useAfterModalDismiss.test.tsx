import React from 'react';
import { Pressable } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { useAfterModalDismiss } from '@/components/shared/useAfterModalDismiss';
import { MODAL_DISMISS_MS } from '@/stores/launchModalMutex';

function Harness({ action }: { action: () => void }) {
  const afterDismiss = useAfterModalDismiss();
  return <Pressable testID="run" onPress={() => afterDismiss(action)} />;
}

describe('useAfterModalDismiss', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('never shortens the native safety delay', () => {
    const action = jest.fn();
    const screen = render(<Harness action={action} />);

    fireEvent.press(screen.getByTestId('run'));
    act(() => jest.advanceTimersByTime(MODAL_DISMISS_MS - 1));
    expect(action).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending action when its owner unmounts', () => {
    const action = jest.fn();
    const screen = render(<Harness action={action} />);

    fireEvent.press(screen.getByTestId('run'));
    screen.unmount();
    act(() => jest.runOnlyPendingTimers());

    expect(action).not.toHaveBeenCalled();
  });
});
