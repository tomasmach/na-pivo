import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, TextInput } from 'react-native';

import { BeerList } from '@/party/BeerList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: (props: { children?: React.ReactNode }) =>
    React.createElement('BottomSheetModal', props, props.children),
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: (props: Record<string, unknown>) => React.createElement('CloseButton', props),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null,
  PlusIcon: () => null,
}));

describe('BeerList custom beer sheet', () => {
  let renderer: ReactTestRenderer | undefined;
  const onAdd = jest.fn();

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
  });

  function press(label: string): void {
    const target = renderer!.root.find(
      (node) =>
        node.type === Pressable && node.props.accessibilityLabel === label,
    );
    act(() => target.props.onPress({}));
  }

  it('lifts the custom beer dialog above the keyboard', async () => {
    await act(async () => {
      renderer = TestRenderer.create(
        <BeerList rows={[]} onTaps={[{ name: 'Svijany 10°', priceCzk: 52 }]} onAdd={onAdd} />,
      );
    });
    expect(renderer!.root.findByType('BottomSheetModal' as never).props.visible).toBe(false);

    press('Zapsat vlastní pivo');

    const sheet = renderer!.root.findByType('BottomSheetModal' as never);
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.keyboardLift).toBe(true);
  });

  it('commits a trimmed nonempty draft, then closes and resets', async () => {
    await act(async () => {
      renderer = TestRenderer.create(<BeerList rows={[]} onTaps={[]} onAdd={onAdd} />);
    });
    press('Zapsat vlastní pivo');

    let input = renderer!.root.findByType(TextInput);
    act(() => input.props.onChangeText('  Kozel 10  '));
    press('Zapsat');

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('Kozel 10');
    expect(renderer!.root.findByType('BottomSheetModal' as never).props.visible).toBe(false);

    press('Zapsat vlastní pivo');
    input = renderer!.root.findByType(TextInput);
    expect(input.props.value).toBe('');
  });
});
