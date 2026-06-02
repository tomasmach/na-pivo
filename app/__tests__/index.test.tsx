import React from 'react';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
  })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })),
}));

jest.mock('react-native-reanimated', () => ({
  useAnimatedReaction: jest.fn(),
  useSharedValue: jest.fn((value) => ({ value })),
}));

jest.mock('@/components/compass/CompassContainer', () => ({
  CompassContainer: jest.fn(() => null),
}));

jest.mock('@/components/shared/TitleBar', () => ({
  TitleBar: jest.fn(() => null),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: jest.fn(() => null),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  BeerOffIcon: jest.fn(() => null),
  LockKeyholeIcon: jest.fn(() => null),
  EyeIcon: jest.fn(() => null),
  MapPinIcon: jest.fn(() => null),
  ExternalLinkIcon: jest.fn(() => null),
  RefreshCwIcon: jest.fn(() => null),
  SettingsIcon: jest.fn(() => null),
}));

jest.mock('@/utils/maps', () => ({
  openPubInMaps: jest.fn(),
}));

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: {
      extrabold: 'display-extrabold',
    },
    ui: {
      regular: 'ui-regular',
      medium: 'ui-medium',
      semibold: 'ui-semibold',
      bold: 'ui-bold',
    },
  },
}));

jest.mock('@/hooks/useCompass', () => ({
  useCompass: jest.fn(),
}));

const CompassScreen = require('../index').default;
const { useCompass } = require('@/hooks/useCompass') as {
  useCompass: jest.Mock;
};

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function baseCompassState() {
  return {
    arrowRotation: { value: null },
    distanceFormatted: '750 m',
    pub: {
      id: 'osm:1',
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
    },
    revealed: false,
    reveal: jest.fn(),
    mode: 'nearest',
    setMode: jest.fn(),
    reroll: jest.fn(),
    retrySearch: jest.fn(),
    arrived: false,
    dismissArrival: jest.fn(),
    headingAccuracy: null,
    hasMagnetometer: true,
    permissionState: 'granted',
    requestPermission: jest.fn(),
    isLoading: false,
  };
}

describe('CompassScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows empty state instead of a reveal button when no pub is selected', () => {
    useCompass.mockReturnValue({
      ...baseCompassState(),
      pub: null,
    });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.a11y.pubPillHidden })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.empty.retry }).length).toBeGreaterThan(0);
  });

  it('wires the hidden pub pill to reveal when a pub exists', () => {
    const reveal = jest.fn();
    useCompass.mockReturnValue({
      ...baseCompassState(),
      reveal,
    });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    const hiddenPill = renderer!.root.findByProps({ accessibilityLabel: cs.a11y.pubPillHidden });

    act(() => {
      hiddenPill.props.onPress();
    });

    expect(reveal).toHaveBeenCalledTimes(1);
  });
});
