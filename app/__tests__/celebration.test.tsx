import React from 'react';
import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import CelebrationScreen from '../celebration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: {
    Success: 'success',
  },
  notificationAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    back: jest.fn(),
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
  __esModule: true,
  default: {
    View: 'AnimatedView',
  },
  useSharedValue: jest.fn((value) => ({ value })),
  useAnimatedStyle: jest.fn((factory) => factory()),
  withSpring: jest.fn((value) => value),
  withTiming: jest.fn((value) => value),
  useReducedMotion: jest.fn(() => true),
}));

jest.mock('@/components/celebration/Confetti', () => ({
  Confetti: jest.fn(() => null),
}));

jest.mock('@/components/celebration/ConfettiStatic', () => ({
  ConfettiStatic: jest.fn(() => null),
}));

jest.mock('@/components/celebration/FoamDrip', () => ({
  FoamDrip: jest.fn(() => null),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: jest.fn(() => null),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  MapPinIcon: jest.fn(() => null),
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

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

describe('CelebrationScreen', () => {
  let renderer: { unmount: () => void } | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (!renderer) return;

    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
  });

  it('does not fire arrival haptics when haptics are disabled', async () => {
    useSettingsStore.setState({ hapticEnabled: false });

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(CelebrationScreen));
      await Promise.resolve();
    });

    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('fires arrival haptics once when haptics are enabled', async () => {
    useSettingsStore.setState({ hapticEnabled: true });

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(CelebrationScreen));
      await Promise.resolve();
    });

    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
  });
});
