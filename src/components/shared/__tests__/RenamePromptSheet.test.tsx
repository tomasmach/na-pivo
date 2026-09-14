import React from 'react';
import { RenamePromptSheet } from '@/components/shared/RenamePromptSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/BottomSheetModal', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    BottomSheetModal: (props: { children?: React.ReactNode }) =>
      ReactModule.createElement('BottomSheetModal', props, props.children),
  };
});
jest.mock('@/components/shared/CloseButton', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    CloseButton: (props: Record<string, unknown>) =>
      ReactModule.createElement('CloseButton', props),
  };
});
jest.mock('@/theme/shadows', () => ({ softDrop: () => ({}) }));

const TestRenderer: typeof import('react-test-renderer') = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

function renderPrompt(canSubmit: boolean, onSubmit = jest.fn()) {
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(
      <RenamePromptSheet
        visible
        title="Opravit název"
        value="Ležák"
        placeholder="Název"
        inputLabel="Nový název"
        cancelLabel="Zrušit"
        saveLabel="Uložit"
        canSubmit={canSubmit}
        onChange={jest.fn()}
        onCancel={jest.fn()}
        onSubmit={onSubmit}
      />,
    );
  });
  return { renderer: renderer!, onSubmit };
}

it('uses one keyboard-lifted intent sheet for rename prompts', () => {
  const { renderer } = renderPrompt(true);
  expect(renderer.root.findByType('BottomSheetModal' as never).props).toMatchObject({
    visible: true,
    keyboardLift: true,
  });
});

it('keeps the single save action disabled until the rename is valid', () => {
  const { renderer, onSubmit } = renderPrompt(false);
  const button = renderer.root.findByProps({ accessibilityLabel: 'Uložit' });
  expect(button.props.accessibilityState).toEqual({ disabled: true });
  expect(button.props.disabled).toBe(true);
  expect(onSubmit).not.toHaveBeenCalled();
});
