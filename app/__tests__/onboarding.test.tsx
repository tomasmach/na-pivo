/**
 * Interaction tests for the first-run onboarding pager (app/onboarding.tsx):
 * CTA label swap on the last slide, finish/skip marking the store complete,
 * navigation to the tabs and the emitted telemetry.
 *
 * The FlatList never measures in the test renderer, so the focused index is
 * driven by invoking the list's onViewableItemsChanged prop directly.
 */

import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: mockReplace, push: mockPush })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: jest.fn(() => null),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  CompassIcon: jest.fn(() => null),
  UserIcon: jest.fn(() => null),
  UsersIcon: jest.fn(() => null),
}));

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { extrabold: 'display-extrabold' },
    ui: { regular: 'ui-regular', semibold: 'ui-semibold' },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock('@/data/telemetryClient', () => ({
  trackClientEvent: jest.fn(),
}));

import { GlowButton } from '@/components/shared/GlowButton';
import { trackClientEvent } from '@/data/telemetryClient';
import { useOnboardingStore } from '@/stores/onboardingStore';
import OnboardingScreen from '../onboarding';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const mockGlowButton = GlowButton as unknown as jest.Mock;
const mockTrack = trackClientEvent as jest.MockedFunction<typeof trackClientEvent>;

function lastGlowButtonProps(): { label: string; onPress: () => void } {
  const calls = mockGlowButton.mock.calls;
  return calls[calls.length - 1][0];
}

function findPager(root: ReturnType<typeof TestRenderer.create>['root']) {
  return root.findAll(
    (node: { props: Record<string, unknown> }) =>
      typeof node.props.onViewableItemsChanged === 'function',
  )[0];
}

describe('OnboardingScreen', () => {
  let renderer: { unmount: () => void; root: any } | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    useOnboardingStore.setState({
      completed: false,
      pendingShow: true,
      decision: 'show',
      firstLaunchSession: true,
    });
  });

  afterEach(() => {
    if (!renderer) return;
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  async function render() {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(OnboardingScreen));
      await Promise.resolve();
    });
  }

  async function focusSlide(index: number) {
    const pager = findPager(renderer!.root);
    await act(async () => {
      pager.props.onViewableItemsChanged({ viewableItems: [{ index }] });
      await Promise.resolve();
    });
  }

  it('tracks onboarding_started on mount and starts with the next CTA', async () => {
    await render();

    expect(mockTrack).toHaveBeenCalledWith({ event: 'onboarding_started' });
    expect(lastGlowButtonProps().label).toBe('Pokračovat');
  });

  it('swaps to the account CTA on the last slide and opens auth over the tabs', async () => {
    await render();
    await focusSlide(4);

    expect(lastGlowButtonProps().label).toBe('Založit účet');

    await act(async () => {
      lastGlowButtonProps().onPress();
      await Promise.resolve();
    });

    expect(useOnboardingStore.getState().completed).toBe(true);
    expect(useOnboardingStore.getState().pendingShow).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockPush).toHaveBeenCalledWith('/auth');
    expect(mockTrack).toHaveBeenCalledWith({
      event: 'onboarding_completed',
      context: { slide: 5 },
    });
    expect(mockTrack).toHaveBeenCalledWith({ event: 'onboarding_auth_opened' });
  });

  it('"Zatím bez účtu" finishes into the tabs without opening auth', async () => {
    await render();
    await focusSlide(4);

    const later = renderer!.root.findAll(
      (node: { props: Record<string, unknown> }) =>
        node.props.accessibilityLabel === 'Zatím bez účtu' &&
        node.props.accessibilityRole === 'button',
    )[0];
    await act(async () => {
      later.props.onPress();
      await Promise.resolve();
    });

    expect(useOnboardingStore.getState().completed).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith({
      event: 'onboarding_completed',
      context: { slide: 5 },
    });
  });

  it('skip completes the onboarding from the first slide', async () => {
    await render();

    const skip = renderer!.root.findAll(
      (node: { props: Record<string, unknown> }) =>
        node.props.accessibilityLabel === 'Přeskočit' && node.props.accessibilityRole === 'button',
    )[0];
    await act(async () => {
      skip.props.onPress();
      await Promise.resolve();
    });

    expect(useOnboardingStore.getState().completed).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockTrack).toHaveBeenCalledWith({
      event: 'onboarding_skipped',
      context: { slide: 1 },
    });
  });

  it('a double tap on the last-slide CTA navigates only once', async () => {
    await render();
    await focusSlide(4);

    await act(async () => {
      const { onPress } = lastGlowButtonProps();
      onPress();
      onPress();
      await Promise.resolve();
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
