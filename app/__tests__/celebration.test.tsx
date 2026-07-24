import React from 'react';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

import { BeerGlass } from '@/counter/BeerGlass';
import { CounterCta } from '@/counter/CounterCta';
import { cs } from '@/i18n/cs';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fireSuccessHaptic } from '@/utils/haptics';
import { openPubInMaps } from '@/utils/maps';
import CelebrationScreen from '../celebration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRouterBack = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/utils/haptics', () => ({ fireSuccessHaptic: jest.fn() }));
jest.mock('@/utils/maps', () => ({ openPubInMaps: jest.fn() }));

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
  useReducedMotion: jest.fn(() => true),
}));

jest.mock('@/counter/BeerGlass', () => ({
  BeerGlass: jest.fn(() => null),
}));

jest.mock('@/counter/CounterCta', () => ({
  CounterCta: jest.fn(() => null),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  ChevronRightIcon: jest.fn(() => null),
}));

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: {
      extrabold: 'display-extrabold',
    },
    ui: {
      medium: 'ui-medium',
      semibold: 'ui-semibold',
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

  it('uses a full BeerGlass sized from the measured card body', async () => {
    useSettingsStore.setState({ hapticEnabled: false });
    await renderScreen();

    const layoutNode = renderer?.root.findAll(
      (node: ReactTestInstance) => typeof node.props.onLayout === 'function'
    )[0];

    act(() => {
      (layoutNode?.props.onLayout as (event: {
        nativeEvent: { layout: { height: number } };
      }) => void)({
        nativeEvent: { layout: { height: 480 } },
      });
    });

    expect(BeerGlass).toHaveBeenLastCalledWith(
      expect.objectContaining({ count: 10, width: 125 }),
      undefined
    );

    act(() => {
      (layoutNode?.props.onLayout as (event: {
        nativeEvent: { layout: { height: number } };
      }) => void)({
        nativeEvent: { layout: { height: 260 } },
      });
    });

    expect(BeerGlass).toHaveBeenLastCalledWith(
      expect.objectContaining({ count: 10, width: 80 }),
      undefined
    );
  });

  it('opens the revealed pub in maps from the card footer', async () => {
    useSettingsStore.setState({ hapticEnabled: false });
    usePubStore.setState({ revealedPub });
    await renderScreen();

    const mapButton = renderer?.root.findAll(
      (node: ReactTestInstance) =>
        node.props.accessibilityLabel ===
        cs.a11y.celebrationOpenMaps(revealedPub.name)
    )[0];

    act(() => {
      (mapButton?.props.onPress as () => void)();
    });

    expect(openPubInMaps).toHaveBeenCalledWith(revealedPub);
  });

  it('returns to the compass through the single primary CTA', async () => {
    useSettingsStore.setState({ hapticEnabled: false });
    await renderScreen();

    expect(CounterCta).toHaveBeenCalledWith(
      expect.objectContaining({
        label: cs.celebration.backToCompass,
        accessibilityLabel: cs.a11y.celebrationBackToCompass,
      }),
      undefined
    );

    const props = (CounterCta as unknown as jest.Mock).mock.calls.at(-1)?.[0];
    act(() => props.onPress());

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
