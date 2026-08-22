import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { JoinTableSheet } from '@/party/JoinTableSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: (props: { children: React.ReactNode; keyboardLift?: boolean }) =>
    React.createElement('BottomSheetModal', props, props.children),
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: () => null,
}));

describe('JoinTableSheet', () => {
  let renderer: ReactTestRenderer | undefined;
  const onJoin = jest.fn();
  const onClose = jest.fn();

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
  });

  function sheet(visible: boolean, initialCode: string | null) {
    return (
      <JoinTableSheet
        visible={visible}
        busy={false}
        error={null}
        initialCode={initialCode}
        onJoin={onJoin}
        onClose={onClose}
      />
    );
  }

  it('prefills a shared code and clears an old draft for the next manual opening', () => {
    act(() => {
      renderer = TestRenderer.create(sheet(true, 'ab-cd23'));
    });
    let input = renderer!.root.findByType(TextInput);
    expect(input.props.value).toBe('ABCD23');
    expect(input.props.caretHidden).toBe(true);
    expect(input.props.selectionColor).toBe('transparent');

    act(() => input.props.onChangeText('EFJ66G'));
    input = renderer!.root.findByType(TextInput);
    expect(input.props.value).toBe('EFJ66G');

    act(() => renderer!.update(sheet(false, null)));
    act(() => renderer!.update(sheet(true, null)));

    expect(renderer!.root.findByType(TextInput).props.value).toBe('');
    expect(renderer!.root.findByType('BottomSheetModal' as never).props.keyboardLift).toBe(true);
  });

  it('exposes only the real editable input and its current value to screen readers', () => {
    act(() => {
      renderer = TestRenderer.create(sheet(true, 'AB-CD23'));
    });

    const input = renderer!.root.findByType(TextInput);
    expect(input.props.accessible).not.toBe(false);
    expect(input.props.accessibilityLabel).toBe('Kód stolu');
    expect(input.props.accessibilityValue).toEqual({ text: 'ABCD23' });
    expect(
      renderer!.root.findAll(
        (node) => node.props.accessibilityLabel === 'Zadat kód stolu',
      ),
    ).toHaveLength(0);

    const decorativeBoxes = renderer!.root.find(
      (node) => node.props.testID === 'join-code-boxes',
    );
    expect(decorativeBoxes.props.accessibilityElementsHidden).toBe(true);
    expect(decorativeBoxes.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('does not render helper copy under the heading', () => {
    act(() => {
      renderer = TestRenderer.create(sheet(true, null));
    });

    const labels = renderer!.root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === 'string');
    expect(labels).not.toContain('Kód máš od toho, kdo večer založil.');
  });
});
