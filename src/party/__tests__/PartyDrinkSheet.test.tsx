import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';

import { cs } from '@/i18n/cs';
import { PartyDrinkSheet } from '@/party/PartyDrinkSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <View>{children}</View> : null,
}));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CameraIcon: () => null,
  HistoryIcon: () => null,
  PlusIcon: () => null,
}));
jest.mock('@/theme/fonts', () => ({
  FontScaleCap: { heading: 1.2, body: 1.3 },
}));

it('captures the backdate clock at the user action after the sheet closes', () => {
  jest.useFakeTimers();
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_777_000_000_000);
  const onClose = jest.fn();
  const onBackdate = jest.fn();
  const screen = render(
    <PartyDrinkSheet
      visible
      choices={[]}
      onClose={onClose}
      onPick={jest.fn()}
      onNew={jest.fn()}
      onBackdate={onBackdate}
      onScan={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByLabelText(cs.counter.backdateLink));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onBackdate).not.toHaveBeenCalled();

  act(() => jest.advanceTimersByTime(300));
  expect(onBackdate).toHaveBeenCalledWith(1_777_000_000_000);

  now.mockRestore();
  jest.useRealTimers();
});
