import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { cs } from '@/i18n/cs';

import { UgcConsentSheet } from '../UgcConsentSheet';

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

describe('UgcConsentSheet', () => {
  it('renders the rules, the terms link and both actions', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(UgcConsentSheet, {
          visible: true,
          busy: false,
          onAccept: jest.fn(),
          onLater: jest.fn(),
        }),
      );
    });

    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain(cs.ugcConsent.title);
    for (const line of cs.ugcConsent.lines) expect(texts).toContain(line);
    expect(texts).toContain(cs.ugcConsent.termsLink);
    expect(texts).toContain(cs.ugcConsent.accept);
    expect(texts).toContain(cs.ugcConsent.later);
  });
});
