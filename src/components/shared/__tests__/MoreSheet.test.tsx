import React from 'react';
import { Pressable, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MoreSheet } from '@/components/shared/MoreSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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
      <>
        <Pressable accessibilityRole="button" accessibilityLabel="Pozadí panelu" onPress={onClose} />
        {children}
      </>
    ) : null,
}));

jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: 'CloseButton' }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
}));

it('closes through the canonical backdrop outside the card', () => {
  const onClose = jest.fn();
  const Icon = () => <Text>ikona</Text>;

  render(
    <MoreSheet
      visible
      rows={[{ key: 'settings', label: 'Nastavení', icon: Icon, onPress: jest.fn() }]}
      onClose={onClose}
    />,
  );

  fireEvent.press(screen.getByLabelText('Pozadí panelu'));

  expect(onClose).toHaveBeenCalledTimes(1);
});
