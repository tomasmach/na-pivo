import React from 'react';

import SettingsScreen from '../settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFetchFriendSettings = jest.fn();
const mockShowToast = jest.fn();
let mockAccountState: {
  session: { accountId: string } | null;
  profile: { displayName: string; email: string; emailVerified: boolean } | null;
} = {
  session: { accountId: 'account-a' },
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
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-gesture-handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  const chain = { onUpdate: () => chain, onEnd: () => chain };
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement('GestureDetector', null, children),
  };
});
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
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
  fetchFriendSettings: (...args: unknown[]) => mockFetchFriendSettings(...args),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/friends/FriendSettingsSheet', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react');
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
    selectIsSignedIn: (state: typeof mockAccountState) => state.session !== null,
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const socialSettings = {
  ghostMode: true,
  quietHoursEnabled: false,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  shareDrinksWithParta: false,
};

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
    session: { accountId: 'account-b' },
    profile: { displayName: 'B', email: 'b@example.test', emailVerified: true },
  };
  act(() => renderer!.update(<SettingsScreen />));
  expect(renderer!.root.findByType('FriendSettingsSheet').props.visible).toBe(false);
});
