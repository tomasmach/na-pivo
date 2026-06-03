import React from 'react';
import { useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { GlowButton } from '@/components/shared/GlowButton';
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

jest.mock('@/components/celebration/FoamDrip', () => ({
  FoamDrip: jest.fn(() => null),
}));

jest.mock('@/components/celebration/BeerBubbles', () => ({
  BeerBubbles: jest.fn(() => null),
}));

jest.mock('@/components/celebration/SoftGlow', () => ({
  SoftGlow: jest.fn(() => null),
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
    (useWindowDimensions as jest.Mock).mockReturnValue({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1,
    });
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

  it('scales controls down on a genuinely short viewport', async () => {
    (useWindowDimensions as jest.Mock).mockReturnValue({
      width: 390,
      height: 560,
      scale: 3,
      fontScale: 1,
    });

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(CelebrationScreen));
      await Promise.resolve();
    });

    const glowButtonMock = GlowButton as unknown as jest.Mock;
    // Full-size button is 64; a short viewport must shrink it (but never below
    // the 48pt touch-target floor).
    expect(
      glowButtonMock.mock.calls.some(
        ([props]) => props.height >= 48 && props.height < 64
      )
    ).toBe(true);
  });

  it('keeps full-size controls on a normal phone viewport', async () => {
    (useWindowDimensions as jest.Mock).mockReturnValue({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1,
    });

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(CelebrationScreen));
      await Promise.resolve();
    });

    const glowButtonMock = GlowButton as unknown as jest.Mock;
    expect(glowButtonMock.mock.calls.some(([props]) => props.height === 64)).toBe(true);
  });
});
