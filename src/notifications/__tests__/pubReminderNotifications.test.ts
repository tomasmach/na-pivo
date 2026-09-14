import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '@/data/privateAccountBoundary';
import { createInviteNavigationCoordinator } from '@/data/inviteNavigation';

const mockGetLastKnownPositionAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
const mockGetBackgroundPermissionsAsync = jest.fn();
const mockStartGeofencingAsync = jest.fn();
const mockHasStartedGeofencingAsync = jest.fn();
const mockStopGeofencingAsync = jest.fn();
const mockFetchPubsNear = jest.fn();
const mockFindNearbyPubs = jest.fn();
const mockSettingsGetState = jest.fn();
let mockGeofenceTask: ((event: unknown) => Promise<void>) | null = null;
const mockIsTaskRegisteredAsync = jest.fn();
const mockUnregisterTaskAsync = jest.fn();
const mockDefineTask = jest.fn((_name: string, task: (event: unknown) => Promise<void>) => {
  mockGeofenceTask = task;
});
const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockGetAllScheduledNotificationsAsync = jest.fn();
const mockDismissAllNotificationsAsync = jest.fn();
const mockGetPresentedNotificationsAsync = jest.fn();
const mockGetLastNotificationResponseAsync = jest.fn();
const mockClearLastNotificationResponseAsync = jest.fn(async () => undefined);
let mockNotificationResponseListener: ((response: unknown) => void) | null = null;
const mockAddNotificationResponseReceivedListener = jest.fn((listener: (response: unknown) => void) => {
  mockNotificationResponseListener = listener;
  return { remove: jest.fn() };
});

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'project-id' } } },
  easConfig: null,
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  cancelScheduledNotificationAsync: mockCancelScheduledNotificationAsync,
  getAllScheduledNotificationsAsync: mockGetAllScheduledNotificationsAsync,
  dismissAllNotificationsAsync: mockDismissAllNotificationsAsync,
  getPresentedNotificationsAsync: mockGetPresentedNotificationsAsync,
  getLastNotificationResponseAsync: mockGetLastNotificationResponseAsync,
  clearLastNotificationResponseAsync: mockClearLastNotificationResponseAsync,
  addNotificationResponseReceivedListener: mockAddNotificationResponseReceivedListener,
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: mockDefineTask,
  isTaskRegisteredAsync: mockIsTaskRegisteredAsync,
  unregisterTaskAsync: mockUnregisterTaskAsync,
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getLastKnownPositionAsync: mockGetLastKnownPositionAsync,
  getCurrentPositionAsync: mockGetCurrentPositionAsync,
  getBackgroundPermissionsAsync: mockGetBackgroundPermissionsAsync,
  hasStartedGeofencingAsync: mockHasStartedGeofencingAsync,
  stopGeofencingAsync: mockStopGeofencingAsync,
  startGeofencingAsync: mockStartGeofencingAsync,
}));

jest.mock('@/data/pushDeviceClient', () => ({
  PUSH_TOKEN_KEY: 'push-token',
  registerPushDevice: jest.fn(),
  disablePushDevice: jest.fn(),
}));

jest.mock('@/data/pubs', () => ({
  fetchPubsNear: mockFetchPubsNear,
  findNearbyPubs: mockFindNearbyPubs,
}));

jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: mockSettingsGetState },
  waitForSettingsHydration: jest.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import {
  clearPubReminderAccountData,
  initializePubReminderNotifications,
  isPubReminderEligible,
  refreshPubReminderGeofences,
  consumeInitialPubReminderTap,
  resetNotificationResponseDeduperForTests,
  subscribePubReminderTap,
} from '../pubReminderNotifications';

const HANDLED_RESPONSE_LEDGER_KEY = 'na-pivo-handled-notification-responses-v1';

async function waitForExpectation(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

function location(lat: number, lng: number) {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 30,
    },
    timestamp: Date.now(),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetPrivateAccountBoundaryForTests();
  resetNotificationResponseDeduperForTests();
  mockNotificationResponseListener = null;
  mockGetLastNotificationResponseAsync.mockResolvedValue(null);
  mockClearLastNotificationResponseAsync.mockResolvedValue(undefined);
  await AsyncStorage.clear();
  mockSettingsGetState.mockReturnValue({ pubReminderEnabled: true });
  mockGetBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockFetchPubsNear.mockResolvedValue(undefined);
  mockFindNearbyPubs.mockReturnValue([
    {
      pub: {
        id: 'mapy:pub',
        name: 'U Testu',
        lat: 50.081,
        lng: 14.419,
        venueKind: 'pub',
      },
    },
  ]);
  mockHasStartedGeofencingAsync.mockResolvedValue(false);
  mockStopGeofencingAsync.mockResolvedValue(undefined);
  mockStartGeofencingAsync.mockResolvedValue(undefined);
  mockScheduleNotificationAsync.mockResolvedValue('scheduled-default');
  mockCancelScheduledNotificationAsync.mockResolvedValue(undefined);
  mockGetAllScheduledNotificationsAsync.mockResolvedValue([]);
  mockDismissAllNotificationsAsync.mockResolvedValue(undefined);
  mockGetPresentedNotificationsAsync.mockResolvedValue([]);
});

function friendResponse(
  identifier: string,
  friendshipId?: string,
): {
  notification: { request: { identifier: string; content: { data: Record<string, string> } } };
} {
  return {
    notification: {
      request: {
        identifier,
        content: {
          data: {
            kind: 'friend_request',
            ...(friendshipId ? { friendship_id: friendshipId } : {}),
          },
        },
      },
    },
  };
}

function pubResponse(identifier: string) {
  return {
    notification: {
      request: {
        identifier,
        content: { data: { kind: 'pub_reminder' } },
      },
    },
  };
}

describe('notification response routing', () => {
  it.each(['friend', 'pub'] as const)(
    'retries one transient cold %s ledger write in the same launch',
    async (kind) => {
      const response = kind === 'friend'
        ? friendResponse('retry-a', 'friendship-a')
        : pubResponse('retry-a');
      let nativeLastResponse: typeof response | null = response;
      mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
      mockClearLastNotificationResponseAsync.mockImplementation(async () => {
        nativeLastResponse = null;
      });
      const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
      const originalSetItem = setItem.getMockImplementation()!;
      let failed = false;
      setItem.mockImplementation(async (key, value) => {
        if (key === HANDLED_RESPONSE_LEDGER_KEY && !failed) {
          failed = true;
          throw new Error('disk temporarily unavailable');
        }
        return originalSetItem(key, value);
      });
      const navigation = createInviteNavigationCoordinator();
      const ticket = navigation.beginExplicitLookup();
      const onPubTap = jest.fn();
      const onFriendTap = jest.fn();

      try {
        await consumeInitialPubReminderTap(onPubTap, onFriendTap, {
          claimPubReminder: (notificationId) =>
            navigation.reserveExplicitEntry(ticket, `notification:${notificationId}`),
          claimFriend: (payload) =>
            navigation.reserveExplicitEntry(ticket, `notification:${payload.notificationId}`),
        });
      } finally {
        setItem.mockImplementation(originalSetItem);
      }

      expect(failed).toBe(true);
      expect(onPubTap).toHaveBeenCalledTimes(kind === 'pub' ? 1 : 0);
      expect(onFriendTap).toHaveBeenCalledTimes(kind === 'friend' ? 1 : 0);
      expect(nativeLastResponse).toBeNull();
      expect(
        navigation.resolveRestoreLookup(navigation.beginRestoreLookup(), 'pending-code').action,
      ).toBe('none');
    },
  );

  it('lets newer B win when it lands during the retry after A ledger failure', async () => {
    const staleA = friendResponse('retry-race-a', 'friendship-a');
    const newerB = friendResponse('retry-race-b', 'friendship-b');
    let nativeLastResponse: typeof staleA | typeof newerB | null = staleA;
    mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
    mockClearLastNotificationResponseAsync.mockImplementation(async () => {
      nativeLastResponse = null;
    });
    const navigation = createInviteNavigationCoordinator();
    const ticket = navigation.beginExplicitLookup();
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    const originalSetItem = setItem.getMockImplementation()!;
    setItem.mockImplementation(async (key, value) => {
      if (key === HANDLED_RESPONSE_LEDGER_KEY) {
        nativeLastResponse = newerB;
        navigation.handleExplicitEntry('notification:retry-race-b');
        throw new Error('disk temporarily unavailable');
      }
      return originalSetItem(key, value);
    });
    const onFriendTap = jest.fn();

    try {
      await consumeInitialPubReminderTap(jest.fn(), onFriendTap, {
        claimPubReminder: (notificationId) =>
          navigation.reserveExplicitEntry(ticket, `notification:${notificationId}`),
        claimFriend: (payload) =>
          navigation.reserveExplicitEntry(ticket, `notification:${payload.notificationId}`),
      });
    } finally {
      setItem.mockImplementation(originalSetItem);
    }

    expect(onFriendTap).not.toHaveBeenCalled();
    expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
    expect(nativeLastResponse).toBe(newerB);
  });

  it('releases a persistently failed cold claim so pending restore can proceed', async () => {
    const response = friendResponse('persistent-ledger-failure', 'friendship-a');
    mockGetLastNotificationResponseAsync.mockResolvedValue(response);
    const navigation = createInviteNavigationCoordinator();
    const ticket = navigation.beginExplicitLookup();
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    const originalSetItem = setItem.getMockImplementation()!;
    let ledgerWriteAttempts = 0;
    setItem.mockImplementation(async (key, value) => {
      if (key === HANDLED_RESPONSE_LEDGER_KEY) {
        ledgerWriteAttempts += 1;
        throw new Error('disk unavailable');
      }
      return originalSetItem(key, value);
    });
    const onFriendTap = jest.fn();

    try {
      await consumeInitialPubReminderTap(jest.fn(), onFriendTap, {
        claimPubReminder: (notificationId) =>
          navigation.reserveExplicitEntry(ticket, `notification:${notificationId}`),
        claimFriend: (payload) =>
          navigation.reserveExplicitEntry(ticket, `notification:${payload.notificationId}`),
      });
    } finally {
      setItem.mockImplementation(originalSetItem);
    }

    expect(ledgerWriteAttempts).toBe(2);
    expect(onFriendTap).not.toHaveBeenCalled();
    expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
    expect(
      navigation.resolveRestoreLookup(navigation.beginRestoreLookup(), 'pending-code'),
    ).toEqual({ action: 'push', code: 'pending-code' });
  });

  it('drops a ledger timestamp beyond the clock-skew allowance', async () => {
    const response = friendResponse('future-ledger-a', 'friendship-a');
    await AsyncStorage.setItem(HANDLED_RESPONSE_LEDGER_KEY, JSON.stringify({
      version: 1,
      entries: [{ id: 'future-ledger-a', handledAt: Date.now() + 24 * 60 * 60 * 1000 }],
    }));
    const onFriendTap = jest.fn();
    const subscription = subscribePubReminderTap(jest.fn(), onFriendTap);

    mockNotificationResponseListener?.(response);
    await waitForExpectation(() => expect(onFriendTap).toHaveBeenCalledTimes(1));

    const ledger = JSON.parse(
      (await AsyncStorage.getItem(HANDLED_RESPONSE_LEDGER_KEY)) ?? 'null',
    ) as { entries: { id: string; handledAt: number }[] };
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.handledAt).toBeLessThanOrEqual(Date.now());
    subscription.remove();
  });

  it.each(['friend', 'pub'] as const)(
    'does not let an older warm %s tap overtake a newer invite URL during the ledger write',
    async (kind) => {
      const staleA = kind === 'friend'
        ? friendResponse('warm-race-a', 'friendship-a')
        : pubResponse('warm-race-a');
      let releaseLedgerWrite: () => void = () => undefined;
      let markLedgerWriteStarted: () => void = () => undefined;
      const ledgerWriteStarted = new Promise<void>((resolve) => {
        markLedgerWriteStarted = resolve;
      });
      const ledgerWriteMayFinish = new Promise<void>((resolve) => {
        releaseLedgerWrite = resolve;
      });
      const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
      const originalSetItem = setItem.getMockImplementation()!;
      setItem.mockImplementation(async (key, value) => {
        if (key === HANDLED_RESPONSE_LEDGER_KEY) {
          markLedgerWriteStarted();
          await ledgerWriteMayFinish;
        }
        return originalSetItem(key, value);
      });
      const navigation = createInviteNavigationCoordinator();
      const onPubTap = jest.fn();
      const onFriendTap = jest.fn();
      const subscription = subscribePubReminderTap(onPubTap, onFriendTap, {
        claimPubReminder: (notificationId) => navigation.prepareExplicitEntry(
          `notification:${notificationId}`,
        ),
        claimFriend: (payload) => navigation.prepareExplicitEntry(
          `notification:${payload.notificationId}`,
        ),
      });

      try {
        mockNotificationResponseListener?.(staleA);
        await ledgerWriteStarted;
        expect(navigation.handleExplicitInviteCode('newer-url-c').action).toBe('push');
        releaseLedgerWrite();
        await waitForExpectation(async () => {
          const ledger = JSON.parse(
            (await AsyncStorage.getItem(HANDLED_RESPONSE_LEDGER_KEY)) ?? 'null',
          ) as { entries: { id: string }[] };
          expect(ledger.entries.some((entry) => entry.id === 'warm-race-a')).toBe(true);
        });
        for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
      } finally {
        releaseLedgerWrite();
        setItem.mockImplementation(originalSetItem);
        subscription.remove();
      }

      expect(onPubTap).not.toHaveBeenCalled();
      expect(onFriendTap).not.toHaveBeenCalled();
      expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
      expect(
        navigation.resolveRestoreLookup(navigation.beginRestoreLookup(), 'pending-code').action,
      ).toBe('none');
    },
  );

  it.each(['friend', 'pub'] as const)(
    'handles concurrent duplicate warm %s response A exactly once with a navigation ticket',
    async (kind) => {
      const response = kind === 'friend'
        ? friendResponse('same-warm-a', 'friendship-a')
        : pubResponse('same-warm-a');
      const navigation = createInviteNavigationCoordinator();
      const onPubTap = jest.fn();
      const onFriendTap = jest.fn();
      mockGetLastNotificationResponseAsync.mockResolvedValue(response);
      const subscription = subscribePubReminderTap(onPubTap, onFriendTap, {
        claimPubReminder: (notificationId) => navigation.prepareExplicitEntry(
          `notification:${notificationId}`,
        ),
        claimFriend: (payload) => navigation.prepareExplicitEntry(
          `notification:${payload.notificationId}`,
        ),
      });

      mockNotificationResponseListener?.(response);
      mockNotificationResponseListener?.(response);
      await waitForExpectation(() => {
        expect(onPubTap).toHaveBeenCalledTimes(kind === 'pub' ? 1 : 0);
        expect(onFriendTap).toHaveBeenCalledTimes(kind === 'friend' ? 1 : 0);
        expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
      });

      subscription.remove();
    },
  );

  it('lets a newer warm friend B take over a delayed cold pub A', async () => {
    const coldA = pubResponse('cold-a');
    const warmB = friendResponse('warm-b', 'friendship-b');
    let releaseLedgerWrite: () => void = () => undefined;
    let markLedgerWriteStarted: () => void = () => undefined;
    const ledgerWriteStarted = new Promise<void>((resolve) => {
      markLedgerWriteStarted = resolve;
    });
    const ledgerWriteMayFinish = new Promise<void>((resolve) => {
      releaseLedgerWrite = resolve;
    });
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    const originalSetItem = setItem.getMockImplementation()!;
    let firstLedgerWrite = true;
    setItem.mockImplementation(async (key, value) => {
      if (key === HANDLED_RESPONSE_LEDGER_KEY && firstLedgerWrite) {
        firstLedgerWrite = false;
        markLedgerWriteStarted();
        await ledgerWriteMayFinish;
      }
      return originalSetItem(key, value);
    });
    mockGetLastNotificationResponseAsync
      .mockResolvedValueOnce(coldA)
      .mockResolvedValue(warmB);
    const navigation = createInviteNavigationCoordinator();
    const initialTicket = navigation.beginExplicitLookup();
    const onColdA = jest.fn();
    const onWarmB = jest.fn();
    const subscription = subscribePubReminderTap(jest.fn(), onWarmB, {
      claimPubReminder: (notificationId) => navigation.prepareExplicitEntry(
        `notification:${notificationId}`,
      ),
      claimFriend: (payload) => navigation.prepareExplicitEntry(
        `notification:${payload.notificationId}`,
      ),
    });

    try {
      const consuming = consumeInitialPubReminderTap(onColdA, jest.fn(), {
        claimPubReminder: (notificationId) => navigation.reserveExplicitEntry(
          initialTicket,
          `notification:${notificationId}`,
        ),
        claimFriend: () => null,
      });
      await ledgerWriteStarted;
      mockNotificationResponseListener?.(warmB);
      releaseLedgerWrite();
      await consuming;
      await waitForExpectation(() => expect(onWarmB).toHaveBeenCalledTimes(1));
    } finally {
      releaseLedgerWrite();
      setItem.mockImplementation(originalSetItem);
      subscription.remove();
    }

    expect(onColdA).not.toHaveBeenCalled();
    expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['friend', 'pub'] as const)(
    'serializes concurrent same-response %s clears so newer native B survives',
    async (kind) => {
      const staleA = kind === 'friend'
        ? friendResponse('same-a', 'friendship-a')
        : pubResponse('same-a');
      const newerB = friendResponse('newer-b', 'friendship-b');
      let nativeLastResponse: typeof staleA | typeof newerB | null = staleA;
      let releaseSecondClear: () => void = () => undefined;
      const secondClearMayFinish = new Promise<void>((resolve) => {
        releaseSecondClear = () => resolve();
      });
      let clearAttempt = 0;
      mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
      mockClearLastNotificationResponseAsync.mockImplementation(async () => {
        clearAttempt += 1;
        if (clearAttempt === 2) await secondClearMayFinish;
        nativeLastResponse = null;
      });
      const onPubTap = jest.fn();
      const onFriendTap = jest.fn();
      const subscription = subscribePubReminderTap(onPubTap, onFriendTap);

      mockNotificationResponseListener?.(staleA);
      mockNotificationResponseListener?.(staleA);
      for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
      nativeLastResponse = newerB;
      releaseSecondClear();
      for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();

      expect(onPubTap).toHaveBeenCalledTimes(kind === 'pub' ? 1 : 0);
      expect(onFriendTap).toHaveBeenCalledTimes(kind === 'friend' ? 1 : 0);
      expect(nativeLastResponse).toBe(newerB);
      subscription.remove();
    },
  );

  it.each([
    ['friend', 'getLast'],
    ['friend', 'clear'],
    ['pub', 'getLast'],
    ['pub', 'clear'],
  ] as const)(
    'keeps live %s A durably deduped across restart when native %s fails',
    async (kind, failure) => {
      const staleA = kind === 'friend'
        ? friendResponse(`failed-${failure}`, 'friendship-a')
        : pubResponse(`failed-${failure}`);
      let nativeLastResponse: typeof staleA | null = staleA;
      mockGetLastNotificationResponseAsync.mockImplementation(async () => {
        if (failure === 'getLast' && mockGetLastNotificationResponseAsync.mock.calls.length === 1) {
          throw new Error('native read failed');
        }
        return nativeLastResponse;
      });
      mockClearLastNotificationResponseAsync.mockImplementation(async () => {
        if (failure === 'clear' && mockClearLastNotificationResponseAsync.mock.calls.length === 1) {
          throw new Error('native clear failed');
        }
        nativeLastResponse = null;
      });
      await AsyncStorage.setItem(HANDLED_RESPONSE_LEDGER_KEY, '{malformed');
      const onPubTap = jest.fn();
      const onFriendTap = jest.fn();
      const subscription = subscribePubReminderTap(onPubTap, onFriendTap);

      mockNotificationResponseListener?.(staleA);
      await waitForExpectation(() => {
        expect(onPubTap).toHaveBeenCalledTimes(kind === 'pub' ? 1 : 0);
        expect(onFriendTap).toHaveBeenCalledTimes(kind === 'friend' ? 1 : 0);
      });
      for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();

      resetNotificationResponseDeduperForTests();
      await consumeInitialPubReminderTap(onPubTap, onFriendTap);

      expect(onPubTap).toHaveBeenCalledTimes(kind === 'pub' ? 1 : 0);
      expect(onFriendTap).toHaveBeenCalledTimes(kind === 'friend' ? 1 : 0);
      expect(nativeLastResponse).toBeNull();
      expect(
        JSON.parse((await AsyncStorage.getItem(HANDLED_RESPONSE_LEDGER_KEY)) ?? 'null'),
      ).toEqual(expect.objectContaining({ entries: expect.any(Array) }));
      subscription.remove();
    },
  );

  it.each(['friend', 'pub'] as const)(
    'clears a live-first %s response so cold start and restart cannot route it again',
    async (kind) => {
      const response = kind === 'friend'
        ? friendResponse('live-first-a', 'friendship-a')
        : pubResponse('live-first-a');
      let nativeLastResponse: typeof response | null = response;
      mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
      mockClearLastNotificationResponseAsync.mockImplementation(async () => {
        nativeLastResponse = null;
      });
      const onPubTap = jest.fn();
      const onFriendTap = jest.fn();
      const navigation = createInviteNavigationCoordinator();
      const initialTicket = navigation.beginExplicitLookup();
      const subscription = subscribePubReminderTap(
        () => {
          navigation.handleExplicitEntry('notification:live-first-a');
          onPubTap();
        },
        (payload) => {
          navigation.handleExplicitEntry(`notification:${payload.notificationId}`);
          onFriendTap(payload);
        },
      );

      mockNotificationResponseListener?.(response);
      for (let attempt = 0; attempt < 20 && nativeLastResponse; attempt += 1) {
        await Promise.resolve();
      }
      expect(nativeLastResponse).toBeNull();

      await consumeInitialPubReminderTap(onPubTap, onFriendTap, {
        claimPubReminder: (notificationId) =>
          navigation.reserveExplicitEntry(initialTicket, `notification:${notificationId}`),
        claimFriend: (payload) =>
          navigation.reserveExplicitEntry(
            initialTicket,
            `notification:${payload.notificationId}`,
          ),
      });

      // A process restart resets both in-memory guards. The native response is
      // the only cross-process source of truth, and it must already be gone.
      resetNotificationResponseDeduperForTests();
      const restartedNavigation = createInviteNavigationCoordinator();
      const restartedTicket = restartedNavigation.beginExplicitLookup();
      await consumeInitialPubReminderTap(onPubTap, onFriendTap, {
        claimPubReminder: (notificationId) =>
          restartedNavigation.reserveExplicitEntry(
            restartedTicket,
            `notification:${notificationId}`,
          ),
        claimFriend: (payload) =>
          restartedNavigation.reserveExplicitEntry(
            restartedTicket,
            `notification:${payload.notificationId}`,
          ),
      });

      expect(onPubTap).toHaveBeenCalledTimes(kind === 'pub' ? 1 : 0);
      expect(onFriendTap).toHaveBeenCalledTimes(kind === 'friend' ? 1 : 0);
      expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
      subscription.remove();
    },
  );

  it.each(['friend', 'pub'] as const)(
    'does not clear newer native B while handling live %s A',
    async (kind) => {
      const staleA = kind === 'friend'
        ? friendResponse('live-a', 'friendship-a')
        : pubResponse('live-a');
      const newerB = friendResponse('native-b', 'friendship-b');
      let nativeLastResponse: typeof staleA | typeof newerB | null = newerB;
      mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
      mockClearLastNotificationResponseAsync.mockImplementation(async () => {
        nativeLastResponse = null;
      });
      const subscription = subscribePubReminderTap(jest.fn(), jest.fn());

      mockNotificationResponseListener?.(staleA);
      for (
        let attempt = 0;
        attempt < 20 && mockGetLastNotificationResponseAsync.mock.calls.length === 0;
        attempt += 1
      ) {
        await Promise.resolve();
      }

      expect(mockGetLastNotificationResponseAsync).toHaveBeenCalled();
      expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
      expect(nativeLastResponse).toBe(newerB);
      subscription.remove();
    },
  );

  it.each([undefined, 'friendship-1'])(
    'dedupes the same initial and listener friend tap by notification id (%s)',
    async (friendshipId) => {
      const response = friendResponse('notification-1', friendshipId);
      const onFriendTap = jest.fn();
      mockGetLastNotificationResponseAsync.mockResolvedValue(response);
      const subscription = subscribePubReminderTap(jest.fn(), onFriendTap);

      await consumeInitialPubReminderTap(jest.fn(), onFriendTap);
      mockNotificationResponseListener?.(response);

      expect(onFriendTap).toHaveBeenCalledTimes(1);
      expect(onFriendTap).toHaveBeenCalledWith({
        kind: 'friend_request',
        activityId: null,
        friendshipId: friendshipId ?? null,
        notificationId: 'notification-1',
      });
      expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
      subscription.remove();
    },
  );

  it('clears a delayed cold A at account boundary so restart under B cannot route it', async () => {
    const response = friendResponse('stale-account-notification', 'friendship-a');
    let nativeLastResponse: typeof response | null = response;
    let resolveResponse!: (value: typeof response) => void;
    mockGetLastNotificationResponseAsync.mockImplementationOnce(
      () => new Promise((resolve) => { resolveResponse = resolve; }),
    ).mockImplementation(async () => nativeLastResponse);
    mockClearLastNotificationResponseAsync.mockImplementation(async () => {
      nativeLastResponse = null;
    });
    const onFriendTap = jest.fn();
    const consuming = consumeInitialPubReminderTap(jest.fn(), onFriendTap);
    while (mockGetLastNotificationResponseAsync.mock.calls.length === 0) {
      await Promise.resolve();
    }

    const transition = beginPrivateAccountTransition('test A to B', 'account-a');
    expect(transition).not.toBeNull();
    resolveResponse(response);
    await consuming;
    await transition?.drain();
    await expect(clearPubReminderAccountData()).resolves.toBe(true);
    transition?.release();

    expect(onFriendTap).not.toHaveBeenCalled();
    expect(nativeLastResponse).toBeNull();

    resetNotificationResponseDeduperForTests();
    await consumeInitialPubReminderTap(jest.fn(), onFriendTap);
    expect(onFriendTap).not.toHaveBeenCalled();
  });

  it('leaves delayed A untouched when a newer explicit B wins the navigation lease', async () => {
    const staleA = friendResponse('notification-a', 'friendship-a');
    const newerB = friendResponse('notification-b', 'friendship-b');
    let nativeLastResponse: typeof staleA | null = staleA;
    let resolveInitial!: (value: typeof staleA) => void;
    mockGetLastNotificationResponseAsync.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInitial = resolve; }),
    );
    mockClearLastNotificationResponseAsync.mockImplementationOnce(async () => {
      nativeLastResponse = null;
    });

    const navigation = createInviteNavigationCoordinator();
    const initialTicket = navigation.beginExplicitLookup();
    const onFriendTap = jest.fn();
    const consuming = consumeInitialPubReminderTap(jest.fn(), onFriendTap, {
      claimPubReminder: (notificationId) =>
        navigation.reserveExplicitEntry(initialTicket, `notification:${notificationId}`),
      claimFriend: (payload) =>
        navigation.reserveExplicitEntry(
          initialTicket,
          `notification:${payload.notificationId}`,
        ),
    });
    while (mockGetLastNotificationResponseAsync.mock.calls.length === 0) {
      await Promise.resolve();
    }

    nativeLastResponse = newerB;
    navigation.handleExplicitEntry('notification:newer-b');
    resolveInitial(staleA);
    await consuming;

    expect(onFriendTap).not.toHaveBeenCalled();
    expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
    expect(nativeLastResponse).toBe(newerB);

    // A lost before the notification deduper too, so a later real delivery of
    // that response can still be handled exactly once.
    const subscription = subscribePubReminderTap(jest.fn(), onFriendTap);
    mockNotificationResponseListener?.(staleA);
    await waitForExpectation(() => expect(onFriendTap).toHaveBeenCalledTimes(1));
    subscription.remove();
  });

  it('does not claim or clear a delayed pub reminder after newer B wins', async () => {
    const staleA = pubResponse('pub-reminder-a');
    const newerB = friendResponse('notification-b', 'friendship-b');
    let nativeLastResponse: typeof staleA | typeof newerB | null = staleA;
    let resolveInitial!: (value: typeof staleA) => void;
    mockGetLastNotificationResponseAsync.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInitial = resolve; }),
    );
    mockClearLastNotificationResponseAsync.mockImplementationOnce(async () => {
      nativeLastResponse = null;
    });

    const navigation = createInviteNavigationCoordinator();
    const initialTicket = navigation.beginExplicitLookup();
    const onTap = jest.fn();
    const consuming = consumeInitialPubReminderTap(onTap, jest.fn(), {
      claimPubReminder: (notificationId) =>
        navigation.reserveExplicitEntry(initialTicket, `notification:${notificationId}`),
      claimFriend: (payload) =>
        navigation.reserveExplicitEntry(
          initialTicket,
          `notification:${payload.notificationId}`,
        ),
    });
    while (mockGetLastNotificationResponseAsync.mock.calls.length === 0) {
      await Promise.resolve();
    }

    nativeLastResponse = newerB;
    navigation.handleExplicitEntry('notification:newer-b');
    resolveInitial(staleA);
    await consuming;

    expect(onTap).not.toHaveBeenCalled();
    expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
    expect(nativeLastResponse).toBe(newerB);

    const subscription = subscribePubReminderTap(onTap);
    mockNotificationResponseListener?.(staleA);
    await waitForExpectation(() => expect(onTap).toHaveBeenCalledTimes(1));
    subscription.remove();
  });
});

describe('account boundary', () => {
  it('does not clear a newer native B that replaces captured A during cleanup', async () => {
    const staleA = friendResponse('cleanup-a', 'friendship-a');
    const newerB = friendResponse('cleanup-b', 'friendship-b');
    let nativeLastResponse: typeof staleA | typeof newerB | null = staleA;
    let readCount = 0;
    mockGetLastNotificationResponseAsync.mockImplementation(async () => {
      readCount += 1;
      if (readCount === 2) nativeLastResponse = newerB;
      return nativeLastResponse;
    });
    mockClearLastNotificationResponseAsync.mockImplementation(async () => {
      nativeLastResponse = null;
    });

    await expect(clearPubReminderAccountData()).resolves.toBe(true);

    expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
    expect(nativeLastResponse).toBe(newerB);
  });

  it.each(['{truncated', 'null', '[]', '42'])(
    'still completes strict cleanup for malformed reminder state %s',
    async (stored) => {
      await AsyncStorage.setItem('na-pivo-pub-reminder-state', stored);

      await expect(clearPubReminderAccountData()).resolves.toBe(true);

      expect(await AsyncStorage.getItem('na-pivo-pub-reminder-state')).toBeNull();
      expect(mockGetAllScheduledNotificationsAsync).toHaveBeenCalled();
      expect(mockDismissAllNotificationsAsync).toHaveBeenCalled();
    },
  );

  it('cancels a headless A reminder that schedules after strict clear', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 7, 20, 0, 0));
    try {
      await AsyncStorage.setItem('na-pivo-pub-reminders-enabled', 'true');
      await AsyncStorage.setItem('na-pivo-pub-reminder-geofences', JSON.stringify({
        'pub-a': 'U Áčka',
      }));

      let resolveSchedule!: (id: string) => void;
      let markScheduleStarted!: () => void;
      const schedulePaused = new Promise<string>((resolve) => {
        resolveSchedule = resolve;
      });
      const scheduleStarted = new Promise<void>((resolve) => {
        markScheduleStarted = resolve;
      });
      mockScheduleNotificationAsync.mockImplementationOnce(() => {
        markScheduleStarted();
        return schedulePaused;
      });

      const task = mockGeofenceTask;
      expect(task).toBeDefined();
      const lateTask = task!({
        data: {
          eventType: 1,
          region: { identifier: 'pub-a' },
        },
      });
      await scheduleStarted;
      expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);

      await expect(clearPubReminderAccountData()).resolves.toBe(true);
      resolveSchedule('late-a-notification');
      await lateTask;

      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
        'late-a-notification',
      );
      expect(await AsyncStorage.getItem('na-pivo-pub-reminder-state')).toBeNull();
      expect(await AsyncStorage.getItem('na-pivo-pub-reminder-geofences')).toBeNull();
      expect(await AsyncStorage.getItem('na-pivo-pub-reminders-enabled')).toBe('true');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops a stale geofence registration that completes after strict clear', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(location(50.081, 14.419));
    let resolveStart!: () => void;
    let markStartCalled!: () => void;
    const startPaused = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    const startCalled = new Promise<void>((resolve) => {
      markStartCalled = resolve;
    });
    mockStartGeofencingAsync.mockImplementationOnce(() => {
      markStartCalled();
      return startPaused;
    });
    // Strict clear sees no native registration yet and verifies that state;
    // once the paused A call lands, the stale callback must stop it itself.
    mockHasStartedGeofencingAsync
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const refresh = refreshPubReminderGeofences();
    await startCalled;
    await expect(clearPubReminderAccountData()).resolves.toBe(true);

    resolveStart();
    await refresh;

    expect(mockStopGeofencingAsync).toHaveBeenCalledWith(
      'na-pivo-pub-reminder-geofence',
    );
    expect(await AsyncStorage.getItem('na-pivo-pub-reminder-geofences')).toBeNull();
  });
});

describe('initializePubReminderNotifications', () => {
  it('lets compass startup go first and defers the catalogue-backed geofence refresh', async () => {
    jest.useFakeTimers();
    (AppState as { currentState: string }).currentState = 'active';
    mockGetLastKnownPositionAsync.mockResolvedValue(location(50.081, 14.419));

    await initializePubReminderNotifications();

    expect(mockFetchPubsNear).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(7_999);
    expect(mockFetchPubsNear).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(mockFetchPubsNear).toHaveBeenCalledWith(50.081, 14.419, undefined, { radiusKm: 5 });
    jest.useRealTimers();
  });
});

describe('refreshPubReminderGeofences', () => {
  it('uses only a recent accurate last-known location for geofence refresh', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(location(50.081, 14.419));

    await refreshPubReminderGeofences();

    expect(mockGetLastKnownPositionAsync).toHaveBeenCalledWith({
      maxAge: 15 * 60 * 1000,
      requiredAccuracy: 500,
    });
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockFetchPubsNear).toHaveBeenCalledWith(50.081, 14.419, undefined, { radiusKm: 5 });
    expect(mockStartGeofencingAsync).toHaveBeenCalledWith(
      'na-pivo-pub-reminder-geofence',
      expect.arrayContaining([
        expect.objectContaining({
          identifier: 'mapy:pub',
          latitude: 50.081,
          longitude: 14.419,
          radius: 75,
          notifyOnEnter: true,
          notifyOnExit: true,
        }),
      ]),
    );
  });

  it('falls back to a fresh balanced location when cached coordinates are missing', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(null);
    mockGetCurrentPositionAsync.mockResolvedValue(location(49.195, 16.607));

    await refreshPubReminderGeofences();

    expect(mockGetCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
    expect(mockFetchPubsNear).toHaveBeenCalledWith(49.195, 16.607, undefined, { radiusKm: 5 });
  });

  it('does not reseed geofences from invalid cached or fresh coordinates', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(location(Number.NaN, 14.419));
    mockGetCurrentPositionAsync.mockResolvedValue(location(49.195, Number.NaN));

    await refreshPubReminderGeofences();

    expect(mockFetchPubsNear).not.toHaveBeenCalled();
    expect(mockStartGeofencingAsync).not.toHaveBeenCalled();
  });

  it('registers only confirmed pubs or places with a community beer signal', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(location(50.081, 14.419));
    mockFindNearbyPubs.mockReturnValue([
      {
        pub: {
          id: 'mapy:not-pub',
          name: 'Pho Viet Huong',
          lat: 50.081,
          lng: 14.419,
          venueKind: 'not_pub',
          beers: [{ name: 'Pivo' }],
        },
      },
      {
        pub: {
          id: 'mapy:ambiguous',
          name: 'Haikky',
          lat: 50.082,
          lng: 14.42,
          venueKind: 'maybe',
        },
      },
      {
        pub: {
          id: 'mapy:community-beer',
          name: 'Restaurace U Testu',
          lat: 50.083,
          lng: 14.421,
          venueKind: 'maybe',
          beers: [{ name: 'Radegast 12' }],
        },
      },
      {
        pub: {
          id: 'mapy:confirmed',
          name: 'Hospoda U Testu',
          lat: 50.084,
          lng: 14.422,
          venueKind: 'pub',
        },
      },
      {
        pub: {
          id: 'mapy:legacy',
          name: 'Starý záznam',
          lat: 50.085,
          lng: 14.423,
        },
      },
    ]);

    await refreshPubReminderGeofences();

    expect(mockFindNearbyPubs).toHaveBeenCalledWith({
      lat: 50.081,
      lng: 14.419,
      limit: 50,
      maxKm: 5,
    });
    const regions = mockStartGeofencingAsync.mock.calls[0]?.[1] as { identifier: string }[];
    expect(regions.map((region) => region.identifier)).toEqual([
      'mapy:community-beer',
      'mapy:confirmed',
    ]);
  });

  it('removes stale geofences when the nearby results are all ambiguous', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(location(50.081, 14.419));
    mockHasStartedGeofencingAsync.mockResolvedValue(true);
    mockFindNearbyPubs.mockReturnValue([
      {
        pub: {
          id: 'mapy:restaurant',
          name: 'Haikky',
          lat: 50.081,
          lng: 14.419,
          venueKind: 'maybe',
        },
      },
    ]);

    await refreshPubReminderGeofences();

    expect(mockStartGeofencingAsync).not.toHaveBeenCalled();
    expect(mockStopGeofencingAsync).toHaveBeenCalledWith('na-pivo-pub-reminder-geofence');
  });
});

describe('isPubReminderEligible', () => {
  it('fails closed for explicit non-pubs even if stale beer data is present', () => {
    expect(
      isPubReminderEligible({ venueKind: 'not_pub', beers: [{ name: 'Pivo' }] }),
    ).toBe(false);
  });

  it('accepts confirmed pubs and community-confirmed beer menus', () => {
    expect(isPubReminderEligible({ venueKind: 'pub' })).toBe(true);
    expect(
      isPubReminderEligible({ venueKind: 'maybe', beers: [{ name: '  Plzeň 12  ' }] }),
    ).toBe(true);
    expect(
      isPubReminderEligible({ venueKind: 'unknown', beers: [{ name: 'Kozel' }] }),
    ).toBe(true);
  });

  it('rejects ambiguous and legacy places without a usable beer signal', () => {
    expect(isPubReminderEligible({ venueKind: 'maybe' })).toBe(false);
    expect(isPubReminderEligible({ venueKind: 'unknown', beers: [{ name: '   ' }] })).toBe(false);
    expect(isPubReminderEligible({})).toBe(false);
  });
});


describe('Android account-boundary geofence cleanup', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    mockGetBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    mockHasStartedGeofencingAsync.mockRejectedValue(
      new Error('Not authorized to use background location services'),
    );
    mockIsTaskRegisteredAsync.mockResolvedValue(false);
    mockUnregisterTaskAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  });

  it('clears an account without requiring background location permission', async () => {
    await expect(clearPubReminderAccountData()).resolves.toBe(true);
    expect(mockHasStartedGeofencingAsync).not.toHaveBeenCalled();
    expect(mockUnregisterTaskAsync).not.toHaveBeenCalled();
  });

  it('unregisters a persisted task even after background permission was revoked', async () => {
    mockIsTaskRegisteredAsync.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(clearPubReminderAccountData()).resolves.toBe(true);
    expect(mockUnregisterTaskAsync).toHaveBeenCalledWith('na-pivo-pub-reminder-geofence');
  });

  it('fails closed when unregistering the native task fails', async () => {
    mockIsTaskRegisteredAsync.mockResolvedValue(true);
    mockUnregisterTaskAsync.mockRejectedValue(new Error('native unregister failed'));
    await expect(clearPubReminderAccountData()).resolves.toBe(false);
  });

  it('fails closed when the native task remains registered', async () => {
    mockIsTaskRegisteredAsync.mockResolvedValue(true);
    await expect(clearPubReminderAccountData()).resolves.toBe(false);
  });

  it('fails closed when native registration cannot be read', async () => {
    mockIsTaskRegisteredAsync.mockRejectedValue(new Error('native read failed'));
    await expect(clearPubReminderAccountData()).resolves.toBe(false);
  });
});
