import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { TabBar } from '../TabBar';
import { usePartaSignalStore } from '@/stores/partaSignalStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-glass-effect', () => ({
  GlassView: (props: Record<string, unknown>) => React.createElement('GlassView', props),
  isLiquidGlassAvailable: () => false,
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  cancelAnimation: jest.fn(),
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => true,
  useSharedValue: (value: number) => ({ value }),
  withRepeat: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  Easing: {
    out: (value: unknown) => value,
    inOut: (value: unknown) => value,
    quad: jest.fn(),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CompassIcon: () => null,
  BeerIcon: () => null,
  UserIcon: () => null,
  CheersIcon: () => null,
  TrophyIcon: () => null,
}));
jest.mock('@/utils/haptics', () => ({ fireLightImpactHaptic: jest.fn() }));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { hapticEnabled: boolean }) => unknown) =>
    selector({ hapticEnabled: false }),
}));
jest.mock('@/mocks/livePartyStore', () => ({
  useLivePartyStore: (selector: (state: { live: boolean }) => unknown) =>
    selector({ live: false }),
}));

describe('TabBar Kocoviny badge', () => {
  const renderers: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(() => {
    usePartaSignalStore.setState({ pendingRequests: 0, unread: 0, liveNow: false });
  });

  afterEach(async () => {
    await act(async () => {
      renderers.splice(0).forEach((renderer) => renderer.unmount());
    });
  });

  async function renderFriendsTab() {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TabBar
          state={{ index: 0, routes: [{ key: 'friends-key', name: 'friends' }] }}
          navigation={{ emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() }}
        />,
      );
    });
    renderers.push(renderer);
    return renderer;
  }

  it.each([
    [1, 'Záložka Kocoviny, 1 nová žádost'],
    [2, 'Záložka Kocoviny, 2 nové žádosti'],
    [4, 'Záložka Kocoviny, 4 nové žádosti'],
    [5, 'Záložka Kocoviny, 5 nových žádostí'],
  ])('announces %i pending requests with Czech pluralization', async (count, label) => {
    usePartaSignalStore.setState({ pendingRequests: count });
    const renderer = await renderFriendsTab();

    expect(renderer.root.findByProps({ children: String(count) })).toBeDefined();
    expect(
      renderer.root.find((node) => node.props.accessibilityRole === 'tab').props.accessibilityLabel,
    ).toBe(label);
  });

  it('announces unread activity when the ambient dot is visible', async () => {
    usePartaSignalStore.setState({ unread: 1 });
    const renderer = await renderFriendsTab();

    expect(
      renderer.root.find((node) => node.props.accessibilityRole === 'tab').props.accessibilityLabel,
    ).toBe('Záložka Kocoviny, nové dění');
  });

  it('announces a live friend instead of generic unread activity', async () => {
    usePartaSignalStore.setState({ unread: 1, liveNow: true });
    const renderer = await renderFriendsTab();

    expect(
      renderer.root.find((node) => node.props.accessibilityRole === 'tab').props.accessibilityLabel,
    ).toBe('Záložka Kocoviny, kamarád právě sedí v hospodě');
  });

  it('announces the visible request pill when it hides the dot', async () => {
    usePartaSignalStore.setState({ pendingRequests: 2, unread: 1, liveNow: true });
    const renderer = await renderFriendsTab();

    expect(
      renderer.root.find((node) => node.props.accessibilityRole === 'tab').props.accessibilityLabel,
    ).toBe('Záložka Kocoviny, 2 nové žádosti');
  });
});
