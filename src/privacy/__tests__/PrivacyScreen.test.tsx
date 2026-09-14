import React from 'react';

import PrivacyScreen from '../PrivacyScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockOpenURL = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock('react-native', () => {
  const actual = jest.requireActual('@/__mocks__/react-native');
  return { ...actual, Linking: { openURL: (...args: unknown[]) => mockOpenURL(...args) } };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const TestRenderer = jest.requireActual('react-test-renderer');

describe('PrivacyScreen complete policy link', () => {
  beforeEach(() => {
    mockOpenURL.mockReset().mockResolvedValue(undefined);
  });

  it('exposes the complete policy link that opens the full policy URL', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<PrivacyScreen />);
    });

    const link = renderer!.root.findByProps({
      accessibilityLabel: 'Kompletní zásady ochrany osobních údajů',
    });
    expect(link.props.accessibilityRole).toBe('link');

    TestRenderer.act(() => {
      void link.props.onPress();
    });
    expect(mockOpenURL).toHaveBeenCalledWith(
      'https://tomasmach.github.io/na-pivo/privacy.html',
    );
  });
});
