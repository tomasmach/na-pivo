import React from 'react';
import { useWindowDimensions } from 'react-native';

import SettingsScreen from '../settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEnablePubReminders = jest.fn();
const mockDisablePubReminders = jest.fn();
const mockGetBackgroundPermissions = jest.fn();
const mockSetPubReminderEnabled = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
// Real PubReminderOnboardingModal module runs — only its sheet chrome and the
// OS permission layer are fakes, so the gate → prompt order is proven on real code.
jest.mock('@/components/shared/BottomSheetModal', () => {
  const ReactModule = jest.requireActual('react');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? ReactModule.createElement('SheetSurface', null, children) : null,
  };
});
jest.mock('expo-location', () => ({
  getBackgroundPermissionsAsync: (...args: unknown[]) =>
    mockGetBackgroundPermissions(...args),
}));
// ESM-only package reached transitively via CloseButton/GlassIconButton.
jest.mock('expo-glass-effect', () => ({
  GlassView: ({ children }: { children?: React.ReactNode }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
jest.mock('react-native-gesture-handler', () => {
  const ReactModule = jest.requireActual('react');
  const chain = { onUpdate: () => chain, onEnd: () => chain };
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement('GestureDetector', null, children),
  };
});
jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement('AnimatedView', props, children),
    },
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => ({ value }),
    withSpring: (value: unknown) => value,
  };
});
jest.mock('@/components/shared/IconGlyph', () => {
  const icon = () => null;
  return {
    MenuIcon: icon,
    HouseIcon: icon,
    InfoIcon: icon,
    MapIcon: icon,
    MapPinIcon: icon,
    MessageSquareIcon: icon,
    PlusIcon: icon,
    ShieldIcon: icon,
    StarIcon: icon,
    ChevronLeftIcon: icon,
    ChevronRightIcon: icon,
  };
});
jest.mock('@/components/shared/MoreSheet', () => ({ MoreSheet: () => null }));
jest.mock('@/counter/CounterCta', () => ({ CounterCta: () => null }));
jest.mock('@/data/accountPreferencesQueue', () => ({
  enqueueAccountPreferences: jest.fn(async () => true),
}));
jest.mock('@/data/friendsClient', () => ({
  DEFAULT_FRIEND_SOCIAL_SETTINGS: {
    ghostMode: false,
    quietHoursEnabled: true,
    quietHoursStart: 23,
    quietHoursEnd: 9,
    shareDrinksWithParta: true,
  },
  fetchFriendSettings: jest.fn(),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/friends/FriendSettingsSheet', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const ReactModule = jest.requireActual('react');
    return ReactModule.createElement('FriendSettingsSheet', props);
  },
}));
jest.mock('@/notifications/beerCountReminder', () => ({
  disableBeerCountReminderNotifications: jest.fn(),
  enableBeerCountReminderNotifications: jest.fn(),
  reschedulePendingBeerCountReminder: jest.fn(),
}));
jest.mock('@/notifications/pubReminderEnableFailure', () => ({
  showPubReminderEnableFailure: jest.fn(),
}));
jest.mock('@/notifications/pubReminderNotifications', () => ({
  disablePubReminderNotifications: (...args: unknown[]) => mockDisablePubReminders(...args),
  enablePubReminderNotifications: (...args: unknown[]) => mockEnablePubReminders(...args),
}));
jest.mock('@/stores/accountStore', () => {
  const state = { session: { accountId: 'account-a' }, profile: { displayName: 'A', email: '', emailVerified: false } };
  const useAccountStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return {
    selectIsSignedIn: () => false,
    selectNickname: () => null,
    useAccountStore,
  };
});
jest.mock('@/stores/settingsStore', () => {
  const mockState = {
    maxDistanceKm: null,
    homePoint: null,
    navigationProvider: 'google',
    priceCurrency: 'CZK',
    hapticEnabled: true,
    soundEnabled: false,
    waterNudgeEnabled: false,
    hideClosedPubs: true,
    preferRatedPubs: false,
    hidePubNames: false,
    marketingEmailsEnabled: false,
    pubReminderEnabled: false,
    beerCountReminderEnabled: false,
    beerCountReminderIntervalMinutes: 20,
    setMaxDistanceKm: jest.fn(),
    setNavigationProvider: jest.fn(),
    setHapticEnabled: jest.fn(),
    setSoundEnabled: jest.fn(),
    setWaterNudgeEnabled: jest.fn(),
    setHideClosedPubs: jest.fn(),
    setPreferRatedPubs: jest.fn(),
    setHidePubNames: jest.fn(),
    setMarketingEmailsEnabled: jest.fn(),
    // Deferred so the factory can run before the test body initializes mocks.
    setPubReminderEnabled: (...args: unknown[]) => mockSetPubReminderEnabled(...args),
    setBeerCountReminderIntervalMinutes: jest.fn(),
  };
  const useSettingsStore = Object.assign(
    (selector: (state: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState },
  );
  return {
    BEER_COUNT_REMINDER_INTERVAL_OPTIONS: [15, 20, 30, 45],
    useSettingsStore,
  };
});
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));
jest.mock('@/utils/appVersion', () => ({ getAppVersionLabel: () => '2.0.0' }));


const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;
const { cs } = jest.requireActual('@/i18n/cs');

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe('settings pub-reminder toggle disclosure gate', () => {
  beforeEach(() => {
    mockEnablePubReminders.mockReset().mockResolvedValue({ ok: true });
    mockDisablePubReminders.mockReset().mockResolvedValue(undefined);
    mockSetPubReminderEnabled.mockReset();
    mockGetBackgroundPermissions.mockReset().mockResolvedValue({ status: 'undetermined' });
    (useWindowDimensions as jest.Mock).mockReturnValue({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1,
    });
  });

  it('shows the prominent disclosure before any permission flow and enables only after consent', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<SettingsScreen />);
    });

    const toggle = renderer!.root.findByProps({
      accessibilityLabel: `${cs.settings.pubReminders.title}: vypnuto`,
    });
    expect(mockGetBackgroundPermissions).not.toHaveBeenCalled();
    expect(mockEnablePubReminders).not.toHaveBeenCalled();

    await act(async () => {
      toggle.props.onToggle();
      await flush();
    });

    // The real gate ran; nothing reached the permission flow yet.
    expect(mockGetBackgroundPermissions).toHaveBeenCalledTimes(1);
    expect(mockEnablePubReminders).not.toHaveBeenCalled();

    // Disclosure copy is on screen with allow/deny actions.
    const texts = renderer!.root
      .findAllByType('Text')
      .map((node: { props: { children?: unknown } }) => node.props.children);
    expect(texts).toContain(cs.pubReminderOnboarding.backgroundDisclosureTitle);
    expect(texts).toContain(cs.pubReminderOnboarding.backgroundDisclosureBody);
    const confirm = renderer!.root.findByProps({
      accessibilityLabel: cs.pubReminderOnboarding.backgroundDisclosureConfirm,
    });
    await act(async () => {
      void confirm.props.onPress();
      await flush();
    });

    expect(mockEnablePubReminders).toHaveBeenCalledTimes(1);
    expect(mockSetPubReminderEnabled).toHaveBeenCalledWith(true);

    // Call-order proof: the background-permission gate strictly precedes
    // anything that can reach requestBackgroundPermissionsAsync.
    expect(mockGetBackgroundPermissions.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnablePubReminders.mock.invocationCallOrder[0],
    );
  });

  it('never prompts when the user declines the disclosure', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<SettingsScreen />);
    });

    const toggle = renderer!.root.findByProps({
      accessibilityLabel: `${cs.settings.pubReminders.title}: vypnuto`,
    });
    await act(async () => {
      toggle.props.onToggle();
      await flush();
    });
    const deny = renderer!.root.findByProps({
      accessibilityLabel: cs.pubReminderOnboarding.backgroundDisclosureDeny,
    });
    await act(async () => {
      void deny.props.onPress();
      await flush();
    });

    expect(mockEnablePubReminders).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('SheetSurface')).toHaveLength(0);
  });

  it('enables directly when background location is already granted', async () => {
    mockGetBackgroundPermissions.mockResolvedValue({ status: 'granted' });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<SettingsScreen />);
    });

    const toggle = renderer!.root.findByProps({
      accessibilityLabel: `${cs.settings.pubReminders.title}: vypnuto`,
    });
    await act(async () => {
      toggle.props.onToggle();
      await flush();
    });

    expect(mockEnablePubReminders).toHaveBeenCalledTimes(1);
    expect(mockSetPubReminderEnabled).toHaveBeenCalledWith(true);
  });
});
