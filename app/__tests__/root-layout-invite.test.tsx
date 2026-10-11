/**
 * Cold start from a Parta invite link (app/_layout.tsx).
 *
 * expo-router answers a push made before the root layout renders its Stack by
 * pushing a second root route, which remounts the layout. In 2.1.1 each
 * remount re-read the launch URL and pushed again while fonts loaded, so one
 * tap sent up to 46 claims and launch syncs. The harness below reproduces
 * that remount; one invite link must still claim and sync exactly once.
 */

import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockStackMounted = false;
let mockRemountRoot: (() => void) | null = null;
let mockRemounts = 0;
let mockFontsLoaded = false;
const mockFontListeners = new Set<() => void>();

const mockPush = jest.fn((..._args: unknown[]) => {
  // Bounded so the pre-fix loop ends instead of hanging the test.
  if (!mockStackMounted && mockRemounts < 25) {
    mockRemounts += 1;
    mockRemountRoot?.();
  }
});

function mockResolved(...names: string[]) {
  return Object.fromEntries(names.map((name) => [name, jest.fn(() => Promise.resolve(true))]));
}

function mockSubscriptions(...names: string[]) {
  return Object.fromEntries(names.map((name) => [name, jest.fn(() => ({ remove: jest.fn() }))]));
}

function mockComponents(...names: string[]) {
  return Object.fromEntries(names.map((name) => [name, () => null]));
}

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  return {
    ...rn,
    Linking: {
      ...rn.Linking,
      getInitialURL: jest.fn(() => Promise.resolve('https://na-pivo.cz/p/YVM4Q4rcJmNs')),
    },
  };
});

jest.mock('expo-router', () => {
  const { useLayoutEffect } = require('react');
  function Stack() {
    useLayoutEffect(() => {
      mockStackMounted = true;
      return () => {
        mockStackMounted = false;
      };
    }, []);
    return null;
  }
  Stack.Screen = function Screen() {
    return null;
  };
  const router = { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn() };
  return { Stack, useRouter: () => router, usePathname: () => '/' };
});

jest.mock('expo-font', () => ({
  useFonts: () => {
    const { useSyncExternalStore } = require('react');
    const loaded = useSyncExternalStore(
      (listener: () => void) => {
        mockFontListeners.add(listener);
        return () => mockFontListeners.delete(listener);
      },
      () => mockFontsLoaded,
    );
    return [loaded, null];
  },
}));
jest.mock('expo-splash-screen', () => mockResolved('preventAutoHideAsync', 'hideAsync'));
jest.mock('expo-status-bar', () => mockComponents('StatusBar'));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/theme/fonts', () => ({ fontAssets: {} }));

jest.mock('@/data/pubReportQueue', () => mockResolved('flushPubReportQueue'));
jest.mock('@/data/pubNameCorrectionsQueue', () => mockResolved('flushPubNameCorrectionsQueue'));
jest.mock('@/data/feedbackQueue', () => mockResolved('flushFeedbackQueue'));
jest.mock('@/data/communityQueue', () => mockResolved('flushCommunityQueue'));
jest.mock('@/data/addedPubsQueue', () => ({
  ...mockResolved('flushAddedPubsQueue', 'syncOwnAddedPubs'),
  restoreQueuedAddedPubs: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('@/data/drinksQueue', () => mockResolved('flushDrinksQueue'));
jest.mock('@/data/deleteDrinksQueue', () => mockResolved('flushDeleteDrinksQueue'));
jest.mock('@/data/updateDrinksQueue', () => mockResolved('flushUpdateDrinksQueue'));
jest.mock('@/data/pubRatingsSync', () => ({
  ...mockResolved('restorePubRatings'),
  installPubRatingsSync: jest.fn(() => () => undefined),
}));
jest.mock('@/data/pubFavoritesSync', () => ({
  ...mockResolved('restorePubFavorites'),
  installPubFavoritesSync: jest.fn(() => () => undefined),
}));
jest.mock('@/data/pubFavoritesQueue', () => mockResolved('flushPubFavoritesQueue'));
jest.mock('@/data/pubAmenitiesSync', () => ({
  ...mockResolved('restorePubAmenities'),
  installPubAmenitiesSync: jest.fn(() => () => undefined),
}));
jest.mock('@/data/pubRatingsQueue', () => mockResolved('flushPubRatingsQueue'));
jest.mock('@/data/pubAmenitiesQueue', () => mockResolved('flushPubAmenitiesQueue'));
jest.mock('@/data/foregroundPulls', () => ({
  pulledRecently: jest.fn(() => false),
  trackForegroundPull: jest.fn((_name: string, run: () => Promise<boolean>) => run()),
}));
jest.mock('@/data/visitsQueue', () => mockResolved('flushVisitsQueue'));
jest.mock('@/data/friendsQueue', () => ({
  ...mockResolved('flushFriendsQueue', 'enqueueFriendOp'),
  isRetriableFriendError: jest.fn(() => false),
}));
jest.mock('@/data/friendsClient', () => ({
  fetchFriendsLive: jest.fn(() => Promise.resolve(null)),
  sendFriendRequest: jest.fn(() => Promise.resolve({ ok: true })),
}));
jest.mock('@/data/beerCheckinsQueue', () => mockResolved('flushBeerCheckinsQueue'));
jest.mock('@/data/nightsQueue', () => mockResolved('flushNightsQueue'));
jest.mock('@/data/tourRunQueue', () => mockResolved('flushTourRunQueue'));
jest.mock('@/data/beerPhotosQueue', () => mockResolved('flushBeerPhotosQueue'));
jest.mock('@/data/drinksHistorySync', () => mockResolved('seedDrinksFromHistory'));
jest.mock('@/data/visitsSync', () => mockResolved('seedVisitsFromHistory'));
jest.mock('@/data/telemetryClient', () => ({
  ...mockResolved('trackClientEvent'),
  installClientTelemetry: jest.fn(),
  setTelemetrySession: jest.fn(),
}));
jest.mock('@/data/productTelemetry', () => ({
  productScreenFromPathname: jest.fn(() => undefined),
  trackScreenViewed: jest.fn(),
}));
jest.mock('@/data/walkingTelemetry', () => ({ flushWalkingDistance: jest.fn() }));
jest.mock('@/data/account', () => mockResolved('getCachedAuthenticationState'));
jest.mock('@/data/localeHeader', () => ({ installBackendLocaleHeader: jest.fn() }));
jest.mock('@/stores/accountStore', () => {
  const state = {
    session: { accountId: 'account-1' },
    initAccount: jest.fn(() => Promise.resolve()),
    resumeSession: jest.fn(() => Promise.resolve('valid')),
    refreshDiarySnapshot: jest.fn(() => Promise.resolve(true)),
  };
  return {
    useAccountStore: Object.assign((select: (s: typeof state) => unknown) => select(state), {
      getState: () => state,
    }),
    selectIsSignedIn: () => false,
  };
});
jest.mock('@/stores/onboardingStore', () => {
  const state = { decision: 'skip', decide: jest.fn(() => Promise.resolve()) };
  return {
    useOnboardingStore: Object.assign((select: (s: typeof state) => unknown) => select(state), {
      getState: () => state,
    }),
  };
});
jest.mock('@/stores/pubStore', () => ({
  usePubStore: { getState: () => ({ bumpCatalogRevision: jest.fn() }) },
}));
jest.mock('@/stores/releaseStore', () => ({
  useReleaseStore: { getState: () => mockResolved('checkForUpdate') },
}));
jest.mock('@/stores/tallyStore', () => ({
  useTallyStore: { getState: () => ({ current: null }), subscribe: jest.fn(() => () => undefined) },
}));
jest.mock('@/notifications/friendPush', () => ({
  ...mockResolved('consumeInitialTourInviteTap', 'ensureFriendPushRegisteredIfGranted'),
  ...mockSubscriptions('subscribeTourInviteTap'),
}));
jest.mock('@/location/locationCurrency', () => mockResolved('refreshCurrencyFromLastKnownLocation'));
jest.mock('@/components/shared/WhatsNewModal', () => mockComponents('WhatsNewModal'));
jest.mock('@/photos/ContestResultsModal', () => mockComponents('ContestResultsModal'));
jest.mock('@/components/shared/PubReminderOnboardingModal', () =>
  mockComponents('PubReminderOnboardingModal'),
);
jest.mock('@/components/shared/NicknameNudgeModal', () => mockComponents('NicknameNudgeModal'));
jest.mock('@/components/shared/PubReminderEnableFailureModal', () =>
  mockComponents('PubReminderEnableFailureModal'),
);
jest.mock('@/components/shared/AppDialog', () => mockComponents('AppDialogScreen'));
jest.mock('@/reviews/AppReviewPromptGate', () => mockComponents('AppReviewPromptGate'));
jest.mock('@/components/shared/Toast', () => mockComponents('Toast'));
jest.mock('@/notifications/pubReminderNotifications', () => ({
  ...mockResolved(
    'cancelPendingPubReminder',
    'consumeInitialPubReminderTap',
    'initializePubReminderNotifications',
    'refreshPubReminderGeofences',
  ),
  ...mockSubscriptions('subscribeFriendPushReceived', 'subscribePubReminderTap'),
}));
jest.mock('@/notifications/beerCountReminder', () => ({
  ...mockResolved('consumeInitialBeerCountReminderTap', 'initializeBeerCountReminderNotifications'),
  ...mockSubscriptions('subscribeBeerCountReminderTap'),
}));
jest.mock('@/notifications/tourReminder', () => ({
  ...mockResolved('consumeInitialTourReminderTap', 'syncTourReminders'),
  ...mockSubscriptions('subscribeTourReminderTap'),
}));
jest.mock('@/liveActivity/liveBeerActivity', () =>
  mockResolved('initializeLiveBeerActivity', 'reconcileLiveBeerActivityAndAutoArchive'),
);
jest.mock('@/notifications/homeTransitReminder', () => ({
  initializeHomeTransitReminder: jest.fn(),
}));
jest.mock('@/transit/homeTransitSync', () => ({
  initializeHomeTransit: jest.fn(),
  ...mockResolved('refreshHomeTransit'),
}));

import { sendFriendRequest } from '@/data/friendsClient';
import { restorePubAmenities } from '@/data/pubAmenitiesSync';
import { restorePubRatings } from '@/data/pubRatingsSync';
import { trackClientEvent } from '@/data/telemetryClient';
import RootLayout from '../_layout';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function Harness() {
  const [generation, setGeneration] = React.useState(0);
  React.useLayoutEffect(() => {
    mockRemountRoot = () => setGeneration((value) => value + 1);
  }, []);
  return <RootLayout key={generation} />;
}

async function settle() {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

function invitePushes() {
  return mockPush.mock.calls.filter(
    ([href]) => (href as { pathname?: string }).pathname === '/parta/pozvanka',
  );
}

it('claims, syncs and opens one invite link once while fonts load', async () => {
  let renderer: { unmount: () => void } | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<Harness />);
  });
  await settle();

  mockFontsLoaded = true;
  await act(async () => {
    mockFontListeners.forEach((listener) => listener());
  });
  await settle();

  expect(mockRemounts).toBe(0);
  expect(invitePushes()).toEqual([
    [{ pathname: '/parta/pozvanka', params: { code: 'YVM4Q4rcJmNs' } }],
  ]);
  expect(sendFriendRequest).toHaveBeenCalledTimes(1);
  expect(sendFriendRequest).toHaveBeenCalledWith({ inviteCode: 'YVM4Q4rcJmNs' });
  expect(restorePubRatings).toHaveBeenCalledTimes(1);
  expect(restorePubAmenities).toHaveBeenCalledTimes(1);
  expect(
    (trackClientEvent as jest.Mock).mock.calls.filter(([event]) => event.event === 'app_open'),
  ).toHaveLength(1);

  // A later remount, whatever its cause, must not reopen or re-claim the launch link.
  await act(async () => {
    mockRemountRoot?.();
  });
  await settle();
  expect(invitePushes()).toHaveLength(1);
  expect(sendFriendRequest).toHaveBeenCalledTimes(1);

  await act(async () => {
    renderer?.unmount();
  });
});
