import React from 'react';
import { useWindowDimensions } from 'react-native';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

import { useSettingsStore } from '@/stores/settingsStore';
import { usePubStore } from '@/stores/pubStore';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import { fireSuccessHaptic } from '@/utils/haptics';
import { openPubInMaps } from '@/utils/maps';
import CelebrationScreen from '../celebration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/utils/haptics', () => ({ fireSuccessHaptic: jest.fn() }));
jest.mock('@/utils/maps', () => ({ openPubInMaps: jest.fn() }));

const mockRouterBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    back: mockRouterBack,
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

jest.mock('@/components/celebration/FoamDrops', () => ({
  FoamDrops: jest.fn(() => null),
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
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

const revealedPub = {
  id: 'pub-1',
  name: 'Restaurace U Zlatého Tygra na Starém Městě',
  lat: 50.087,
  lng: 14.421,
};

describe('CelebrationScreen', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    usePubStore.setState({ revealedPub: null });
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

  async function renderScreen() {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(CelebrationScreen));
      await Promise.resolve();
    });
  }

  it('does not fire arrival haptics when haptics are disabled', async () => {
    useSettingsStore.setState({ hapticEnabled: false });

    await renderScreen();

    expect(fireSuccessHaptic).not.toHaveBeenCalled();
  });

  it('fires arrival haptics once when haptics are enabled', async () => {
    useSettingsStore.setState({ hapticEnabled: true });

    await renderScreen();

    expect(fireSuccessHaptic).toHaveBeenCalledTimes(1);
  });

  it('scales controls down on a genuinely short viewport', async () => {
    (useWindowDimensions as jest.Mock).mockReturnValue({
      width: 390,
      height: 560,
      scale: 3,
      fontScale: 1,
    });

    await renderScreen();

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

    await renderScreen();

    const glowButtonMock = GlowButton as unknown as jest.Mock;
    expect(glowButtonMock.mock.calls.some(([props]) => props.height === 64)).toBe(true);
  });

  it('opens the revealed pub in maps from the pub card', async () => {
    useSettingsStore.setState({ hapticEnabled: false });
    usePubStore.setState({ revealedPub });
    await renderScreen();

    const mapButton = renderer?.root.findAll(
      (node: ReactTestInstance) =>
        node.props.accessibilityLabel === cs.celebration.openInMaps
    )[0];

    act(() => {
      (mapButton?.props.onPress as () => void)();
    });

    expect(openPubInMaps).toHaveBeenCalledWith(revealedPub);
  });

  it('returns to the compass through the primary CTA', async () => {
    useSettingsStore.setState({ hapticEnabled: false });
    await renderScreen();

    const glowButtonMock = GlowButton as unknown as jest.Mock;
    const props = glowButtonMock.mock.calls.at(-1)?.[0];

    expect(props).toEqual(
      expect.objectContaining({
        label: cs.celebration.backToCompass,
        variant: 'primary',
        glow: 'strong',
      })
    );

    act(() => props.onPress());

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
