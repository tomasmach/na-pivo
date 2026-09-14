import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MenuChip, RowMenu } from '@/mocks/MenuChip';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));

jest.mock('@expo/ui/swift-ui', () => ({
  Button: () => null,
  HStack: () => null,
  Host: () => null,
  Image: () => null,
  Menu: () => null,
  Picker: () => null,
  Text: () => null,
}));

jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  environment: jest.fn(),
  font: jest.fn(),
  foregroundStyle: jest.fn(),
  glassEffect: jest.fn(),
  padding: jest.fn(),
  pickerStyle: jest.fn(),
  tag: jest.fn(),
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
  }) => (
    <View testID="android-menu-sheet" accessibilityState={{ expanded: visible }}>
      {visible ? children : null}
      {visible ? <Pressable testID="android-menu-backdrop" onPress={onClose} /> : null}
    </View>
  ),
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: ({ onPress }: { onPress: () => void }) => (
    <Pressable testID="android-menu-close" onPress={onPress} />
  ),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
  EllipsisIcon: () => null,
  ChevronDownIcon: () => null,
}));

describe('Android MenuChip and RowMenu', () => {
  const originalOS = Platform.OS;

  beforeAll(() => {
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  it('opens the filter sheet, marks the current value and closes after selection', () => {
    const onChange = jest.fn();
    render(
      <MenuChip
        value="Týden"
        options={['Týden', 'Měsíc']}
        title="Období"
        onChange={onChange}
      />,
    );

    fireEvent.press(screen.getByLabelText('Období: Týden'));

    expect(screen.getByTestId('android-menu-sheet').props.accessibilityState).toEqual({
      expanded: true,
    });
    expect(screen.getByLabelText('Týden').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByLabelText('Měsíc').props.accessibilityState).toEqual({ selected: false });

    fireEvent.press(screen.getByLabelText('Měsíc'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Měsíc');
    expect(screen.getByTestId('android-menu-sheet').props.accessibilityState).toEqual({
      expanded: false,
    });
    expect(screen.queryByLabelText('Měsíc')).toBeNull();
  });

  it('closes before returning from every row action and routes each callback once', () => {
    const onRepeat = jest.fn();
    const onAction = jest.fn();
    const onChange = jest.fn();
    const onDelete = jest.fn();
    render(
      <RowMenu
        value="Pivo"
        options={['Pivo', 'Víno']}
        title="Akce se zápisem"
        onChange={onChange}
        repeat={{ label: 'Dát si znovu', onPress: onRepeat }}
        actions={[{ label: 'Upravit', onPress: onAction }]}
        destructive={{ label: 'Smazat', onPress: onDelete }}
      />,
    );

    const pressAction = (label: string, callback: jest.Mock, expected?: string) => {
      fireEvent.press(screen.getByLabelText('Akce se zápisem'));
      expect(screen.getByTestId('android-menu-sheet').props.accessibilityState).toEqual({
        expanded: true,
      });

      fireEvent.press(screen.getByLabelText(label));

      expect(callback).toHaveBeenCalledTimes(1);
      if (expected) expect(callback).toHaveBeenCalledWith(expected);
      expect(screen.getByTestId('android-menu-sheet').props.accessibilityState).toEqual({
        expanded: false,
      });
      expect(screen.queryByLabelText(label)).toBeNull();
    };

    pressAction('Dát si znovu', onRepeat);
    pressAction('Upravit', onAction);
    pressAction('Víno', onChange, 'Víno');
    pressAction('Smazat', onDelete);
  });

  it('closes without invoking an action from the close affordances', () => {
    const onChange = jest.fn();
    render(
      <MenuChip value="Týden" options={['Týden', 'Měsíc']} title="Období" onChange={onChange} />,
    );

    fireEvent.press(screen.getByLabelText('Období: Týden'));
    fireEvent.press(screen.getByTestId('android-menu-close'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('android-menu-sheet').props.accessibilityState).toEqual({
      expanded: false,
    });

    fireEvent.press(screen.getByLabelText('Období: Týden'));
    fireEvent.press(screen.getByTestId('android-menu-backdrop'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('android-menu-sheet').props.accessibilityState).toEqual({
      expanded: false,
    });
  });
});
