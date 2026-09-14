import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import SettingsScreen from '../settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFetchFriendSettings = jest.fn();
const mockShowToast = jest.fn();
const mockRouterPush = jest.fn();
let mockAccountState: {
  session: { accountId: string; authenticated: boolean } | null;
  profile: { displayName: string; email: string; emailVerified: boolean } | null;
} = {
  session: { accountId: 'account-a', authenticated: true },
  profile: { displayName: 'A', email: 'a@example.test', emailVerified: true },
};
const mockSettingsState = {
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
  setPubReminderEnabled: jest.fn(),
  setBeerCountReminderIntervalMinutes: jest.fn(),
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockRouterPush }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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
    useDerivedValue: (factory: () => unknown) => factory,
    useReducedMotion: () => false,
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
jest.mock('@/counter/CounterCta', () => {
  const ReactModule = jest.requireActual('react');
  return {
    CounterCta: (props: Record<string, unknown>) =>
      ReactModule.createElement('CounterCta', props),
  };
});
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: {} })),
}));
jest.mock('expo-glass-effect', () => ({
  GlassView: ({ children }: { children?: React.ReactNode }) => children,
  isLiquidGlassAvailable: () => false,
}));
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
  fetchFriendSettings: (...args: unknown[]) => mockFetchFriendSettings(...args),
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
  disablePubReminderNotifications: jest.fn(),
  enablePubReminderNotifications: jest.fn(),
}));
jest.mock('@/stores/accountStore', () => {
  const useAccountStore = Object.assign(
    (selector: (state: typeof mockAccountState) => unknown) => selector(mockAccountState),
    { getState: () => mockAccountState },
  );
  return {
    selectIsSignedIn: (state: typeof mockAccountState) =>
      state.session?.authenticated === true,
    selectNickname: () => 'tester',
    useAccountStore,
  };
});
jest.mock('@/stores/settingsStore', () => ({
  BEER_COUNT_REMINDER_INTERVAL_OPTIONS: [15, 20, 30, 45],
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) =>
    selector(mockSettingsState),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));
jest.mock('@/utils/appVersion', () => ({ getAppVersionLabel: () => '2.0.0' }));


const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

const socialSettings = {
  ghostMode: true,
  quietHoursEnabled: false,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  shareDrinksWithParta: false,
};

const defaultMockAccountState = () => ({
  session: { accountId: 'account-a', authenticated: true } as
    | { accountId: string; authenticated: boolean }
    | null,
  profile: { displayName: 'A', email: 'a@example.test', emailVerified: true } as {
    displayName: string;
    email: string;
    emailVerified: boolean;
  } | null,
});

beforeEach(() => {
  mockRouterPush.mockClear();
  mockAccountState = defaultMockAccountState();
  mockSettingsState.beerCountReminderEnabled = false;
  (useWindowDimensions as jest.Mock).mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
});

it('opens the account-keyed privacy switches from Settings', async () => {
  mockFetchFriendSettings.mockResolvedValue(socialSettings);
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(<SettingsScreen />);
  });

  expect(
    renderer!.root
      .findAllByType('Text')
      .filter((node: { props: { children?: unknown } }) => node.props.children === 'Kdy se ozvu'),
  ).toHaveLength(1);
  await act(async () => {
    renderer!.root.findByProps({ accessibilityLabel: 'Kdo tě vidí' }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockFetchFriendSettings).toHaveBeenCalledWith(expect.any(AbortSignal));
  const sheet = renderer!.root.findByType('FriendSettingsSheet');
  expect(sheet.props.visible).toBe(true);
  expect(sheet.props.settings).toEqual(socialSettings);

  mockAccountState = {
    session: { accountId: 'account-b', authenticated: true },
    profile: { displayName: 'B', email: 'b@example.test', emailVerified: true },
  };
  act(() => renderer!.update(<SettingsScreen />));
  expect(renderer!.root.findByType('FriendSettingsSheet').props.visible).toBe(false);
});

it('keeps the header and compact reminder choices readable with large type', () => {
  (useWindowDimensions as jest.Mock).mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 2,
  });
  mockSettingsState.beerCountReminderEnabled = true;
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(<SettingsScreen />);
  });

  const header = renderer!.root
    .findAllByType('Text')
    .find((node: { props: { children?: unknown } }) => node.props.children === 'Nastavení');
  expect(header?.props.adjustsFontSizeToFit).toBe(true);
  expect(header?.props.minimumFontScale).toBe(0.8);

  for (const label of ['15 min', '20 min', '30 min', '45 min']) {
    const option = renderer!.root
      .findAllByType('Text')
      .find((node: { props: { children?: unknown } }) => node.props.children === label);
    expect(option?.props.adjustsFontSizeToFit).toBe(true);
    expect(option?.props.minimumFontScale).toBe(0.72);
  }
  const firstChoice = renderer!.root.findByProps({
    accessibilityLabel: 'Zkontrolovat deníček za 15 minut',
  });
  expect(StyleSheet.flatten(firstChoice.props.style).width).toBe('48%');
  mockSettingsState.beerCountReminderEnabled = false;
  (useWindowDimensions as jest.Mock).mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
});

it('routes anonymous and claimed accounts to data controls', async () => {
  mockFetchFriendSettings.mockResolvedValue(socialSettings);
  let renderer: ReturnType<typeof TestRenderer.create>;
  mockAccountState = {
    session: { accountId: 'anonymous', authenticated: false },
    profile: null,
  };
  act(() => {
    renderer = TestRenderer.create(<SettingsScreen />);
  });

  const anonymousCta = renderer!.root.findByType('CounterCta');
  expect(anonymousCta.props.label).toBe('Účet a data');
  expect(anonymousCta.props.subLabel).toBe('Správa dat nebo přihlášení');
  expect(anonymousCta.props.accessibilityLabel).toBe('Spravovat účet a moje data');
  await act(async () => {
    await anonymousCta.props.onPress();
  });
  expect(mockRouterPush).toHaveBeenCalledWith('/account');

  mockAccountState = {
    session: { accountId: 'claimed', authenticated: true },
    profile: { displayName: 'C', email: 'c@example.test', emailVerified: true },
  };
  act(() => renderer!.update(<SettingsScreen />));
  const claimedCta = renderer!.root.findByType('CounterCta');
  expect(claimedCta.props.label).toBe('Účet a data');
  expect(claimedCta.props.subLabel).toBe('Správa dat nebo přihlášení');
  await act(async () => {
    await claimedCta.props.onPress();
  });
  expect(mockRouterPush).toHaveBeenLastCalledWith('/account');

  mockAccountState = { session: null, profile: null };
  act(() => renderer!.update(<SettingsScreen />));
  const signedOutCta = renderer!.root.findByType('CounterCta');
  await act(async () => {
    await signedOutCta.props.onPress();
  });
  expect(mockRouterPush).toHaveBeenLastCalledWith('/auth');

  await act(async () => {
    renderer!.unmount();
  });
});
