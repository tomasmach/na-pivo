import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Colors } from '@/theme/colors';
import { Radius } from '@/theme/layout';
import { MockLayout } from '@/mocks/mockTheme';

import { LoginMethodsSheet } from '../LoginMethodsSheet';
import { PasswordSheet } from '../PasswordSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/shared/BrandIcon', () => ({
  AppleIcon: () => null,
  GoogleIcon: () => null,
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
  KeyRoundIcon: () => null,
  XIcon: () => null,
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: (props: Record<string, unknown>) => React.createElement('GlowButton', props),
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: (props: Record<string, unknown>) => React.createElement('CloseButton', props),
}));

function expectNoRolelessContentPressable(renderer: TestRenderer.ReactTestRenderer): void {
  const offenders = renderer.root.findAllByType(Pressable).filter(
    (node) => !node.props.accessibilityRole && !node.props.accessibilityElementsHidden,
  );
  expect(offenders).toHaveLength(0);
}

function expectCanonicalIntentSheet(renderer: TestRenderer.ReactTestRenderer): void {
  const views = renderer.root.findAllByType(View);
  const wrapper = views.find((node) => {
    const style = StyleSheet.flatten(node.props.style);
    return style?.width === '100%' && style?.maxHeight === '92%';
  });
  expect(StyleSheet.flatten(wrapper?.props.style).minHeight).toBeUndefined();

  const card = views.find((node) => {
    const style = StyleSheet.flatten(node.props.style);
    return style?.backgroundColor === Colors.stout && style?.borderTopLeftRadius === Radius.card;
  });
  expect(StyleSheet.flatten(card?.props.style)).toEqual(expect.objectContaining({
    flexShrink: 1,
    paddingHorizontal: MockLayout.screenPad,
  }));

  const scroll = renderer.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.style)).toEqual(expect.objectContaining({
    flexGrow: 0,
    flexShrink: 1,
  }));
}

describe('account sheet accessibility grouping', () => {
  it('does not wrap all login methods in an unlabeled Pressable', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <LoginMethodsSheet
          visible
          providers={['email']}
          appleSupported={false}
          busy={null}
          onClose={jest.fn()}
          onSetPassword={jest.fn()}
          onLink={jest.fn()}
          onUnlink={jest.fn()}
        />,
      );
    });
    expectNoRolelessContentPressable(renderer);
    expectCanonicalIntentSheet(renderer);
  });

  it('does not wrap the password form in an unlabeled Pressable', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <PasswordSheet
          visible
          hasProfileEmail
          email="pivo@example.cz"
          password=""
          error=""
          busy={false}
          onChangeEmail={jest.fn()}
          onChangePassword={jest.fn()}
          onSave={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });
    expectNoRolelessContentPressable(renderer);
    expectCanonicalIntentSheet(renderer);
    const footerButton = renderer.root.find(
      (node) => node.props.glow === 'none' && node.props.height === 52,
    );
    let parent = footerButton.parent;
    while (parent) {
      expect(parent.type).not.toBe(ScrollView);
      parent = parent.parent;
    }
  });
});
