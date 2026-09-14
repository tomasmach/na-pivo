import React from 'react';
import { Pressable, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
import { useReleaseStore } from '@/stores/releaseStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 18, left: 0 }),
}));

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({
    visible,
    onClose,
    children,
  }: {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
  }) =>
    visible ? (
      <View testID="bottom-sheet">
        <Pressable accessibilityRole="button" accessibilityLabel="Pozadí" onPress={onClose} />
        {children}
      </View>
    ) : null,
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: ({ onPress, label }: { onPress: () => void; label: string }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} />
  ),
}));

describe('WhatsNewModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useReleaseStore.setState({
      lastSeenVersion: '2.9.0',
      pendingNote: {
        version: '3.0.0',
        title: 'Nové Na pivo',
        items: [
          { icon: '🍺', text: 'Jedna novinka' },
          { icon: '', text: 'Druhá novinka' },
        ],
      },
      hasChecked: true,
      checkSettled: true,
    });
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    useReleaseStore.setState({
      lastSeenVersion: null,
      pendingNote: null,
      hasChecked: false,
      checkSettled: false,
    });
  });

  it('keeps the release gate occupied until the sheet has finished leaving', () => {
    render(<WhatsNewModal />);

    expect(screen.getByText('Nové Na pivo')).toBeTruthy();
    expect(screen.getByText('Jedna novinka')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Paráda!'));

    expect(screen.queryByTestId('bottom-sheet')).toBeNull();
    expect(useReleaseStore.getState().pendingNote).not.toBeNull();

    act(() => jest.advanceTimersByTime(259));
    expect(useReleaseStore.getState().pendingNote).not.toBeNull();

    act(() => jest.advanceTimersByTime(1));
    expect(useReleaseStore.getState().pendingNote).toBeNull();
    expect(useReleaseStore.getState().lastSeenVersion).toBe('3.0.0');
  });
});
