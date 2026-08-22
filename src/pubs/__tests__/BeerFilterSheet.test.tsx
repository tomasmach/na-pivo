import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { BeerFilterSheet } from '../BeerFilterSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: () => null,
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
}));

describe('BeerFilterSheet', () => {
  it('renders canonical labels but applies canonical brand keys', () => {
    const onApply = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <BeerFilterSheet
          visible
          options={[
            { key: 'pilsner-urquell', label: 'Pilsner Urquell' },
            { key: 'radegast', label: 'Radegast' },
          ]}
          value={[]}
          onClose={jest.fn()}
          onApply={onApply}
        />,
      );
    });

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: 'Pilsner Urquell' }).props.onPress();
      renderer.root.findByProps({ accessibilityLabel: 'Radegast' }).props.onPress();
    });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: 'Použít filtr' }).props.onPress();
    });

    expect(onApply).toHaveBeenCalledWith(['pilsner-urquell', 'radegast']);
  });
});
