import React from 'react';
import { Linking } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { showAppDialog } from '@/components/shared/AppDialog';
import { PubReminderEnableFailureModal } from '@/components/shared/PubReminderEnableFailureModal';
import { usePubReminderEnableFailureStore } from '@/stores/pubReminderEnableFailureStore';

jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));

describe('PubReminderEnableFailureModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePubReminderEnableFailureStore.setState({ reason: null });
  });

  it('routes a denied permission through AppDialog and keeps the Settings action', () => {
    render(<PubReminderEnableFailureModal />);

    act(() => {
      usePubReminderEnableFailureStore.getState().show('notifications-denied');
    });

    expect(usePubReminderEnableFailureStore.getState().reason).toBeNull();
    expect(showAppDialog).toHaveBeenCalledTimes(1);

    const dialog = (showAppDialog as jest.Mock).mock.calls[0][0];
    expect(dialog.title).toBe('Notifikace zůstaly vypnuté');
    expect(dialog.buttons.map((button: { text: string }) => button.text)).toEqual([
      'OK',
      'Otevřít Nastavení',
    ]);

    const settingsButton = dialog.buttons[1];
    settingsButton.onPress();
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });
});
