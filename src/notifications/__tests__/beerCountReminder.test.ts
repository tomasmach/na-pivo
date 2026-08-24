import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGetPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
const mockRequestPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
const mockScheduleNotificationAsync = jest.fn<Promise<string>, [unknown]>();
const mockCancelScheduledNotificationAsync = jest.fn(async () => undefined);
const mockGetAllScheduledNotificationsAsync = jest.fn(async () => [] as unknown[]);
const mockGetLastNotificationResponseAsync = jest.fn();
const mockClearLastNotificationResponseAsync = jest.fn(async () => undefined);
const mockAddNotificationResponseReceivedListener = jest.fn<
  { remove: jest.Mock },
  [(value: ReturnType<typeof response>) => void]
>(() => ({ remove: jest.fn() }));

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: mockGetPermissionsAsync,
  requestPermissionsAsync: mockRequestPermissionsAsync,
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  cancelScheduledNotificationAsync: mockCancelScheduledNotificationAsync,
  getAllScheduledNotificationsAsync: mockGetAllScheduledNotificationsAsync,
  getLastNotificationResponseAsync: mockGetLastNotificationResponseAsync,
  clearLastNotificationResponseAsync: mockClearLastNotificationResponseAsync,
  addNotificationResponseReceivedListener: mockAddNotificationResponseReceivedListener,
}));

/* eslint-disable import/first -- mocks must be installed before this module loads */
import {
  BEER_COUNT_REMINDER_KIND,
  clearBeerCountReminderForAccountBoundary,
  consumeInitialBeerCountReminderTap,
  disableBeerCountReminderNotifications,
  initializeBeerCountReminderNotifications,
  refreshBeerCountReminderAfterBeer,
  resetBeerCountReminderTapDeduperForTests,
  reschedulePendingBeerCountReminder,
  subscribeBeerCountReminderTap,
} from '../beerCountReminder';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '@/data/privateAccountBoundary';
import { createInviteNavigationCoordinator } from '@/data/inviteNavigation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
/* eslint-enable import/first */

const SESSION: TallySession = {
  clientId: 'session-1',
  pubKey: 'u-testu',
  pubName: 'U Testu',
  startedAt: '2026-07-18T18:00:00.000Z',
  drinks: [
    {
      id: 'beer-1',
      beerName: 'Testovací 12',
      at: '2026-07-18T18:00:00.000Z',
    },
  ],
};

function response(identifier: string) {
  return {
    notification: {
      request: {
        identifier,
        content: { data: { kind: BEER_COUNT_REMINDER_KIND } },
      },
    },
  };
}

beforeEach(async () => {
  resetPrivateAccountBoundaryForTests();
  resetBeerCountReminderTapDeduperForTests();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  let nextId = 1;
  mockScheduleNotificationAsync.mockImplementation(async () => `notification-${nextId++}`);
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockGetAllScheduledNotificationsAsync.mockResolvedValue([]);
  mockGetLastNotificationResponseAsync.mockResolvedValue(null);
  mockClearLastNotificationResponseAsync.mockResolvedValue(undefined);
  useSettingsStore.setState({
    beerCountReminderEnabled: true,
    beerCountReminderIntervalMinutes: 20,
  });
  useTallyStore.setState({ current: SESSION, history: [] });
});

afterEach(() => {
  resetPrivateAccountBoundaryForTests();
});

it('moves the evening reminder after every newly counted beer', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        title: 'Mrkni na svůj deníček',
        body: 'Klepni a zkontroluj dnešní zápis.',
        data: expect.objectContaining({
          kind: BEER_COUNT_REMINDER_KIND,
          sessionId: SESSION.clientId,
        }),
      }),
      trigger: expect.objectContaining({ seconds: 20 * 60, repeats: false }),
    }),
  );

  const scheduledContent = mockScheduleNotificationAsync.mock.calls[0]?.[0] as {
    content: Record<string, unknown>;
  };
  const serialized = JSON.stringify(scheduledContent.content).toLowerCase();
  for (const fragment of ['další pivo', 'další pivko', 'další čárku', 'přidej']) {
    expect(serialized).not.toContain(fragment.toLowerCase());
  }
});

it('re-arms only when the delivered reminder is tapped', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  const delivered = response('notification-1');
  mockGetLastNotificationResponseAsync.mockResolvedValue(delivered);
  const onTap = jest.fn();

  await consumeInitialBeerCountReminderTap(onTap);
  await consumeInitialBeerCountReminderTap(onTap);

  expect(onTap).toHaveBeenCalledTimes(1);
  // The same OS response can surface through cold-start and live listeners;
  // its identifier may navigate and re-arm the chain only once.
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(2);
  expect(mockClearLastNotificationResponseAsync.mock.invocationCallOrder[0]).toBeLessThan(
    mockCancelScheduledNotificationAsync.mock.invocationCallOrder[0],
  );
});

it('retries a transient cold ledger write and re-arms exactly once', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  const delivered = response('notification-1');
  let nativeLastResponse: ReturnType<typeof response> | null = delivered;
  mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
  mockClearLastNotificationResponseAsync.mockImplementation(async () => {
    nativeLastResponse = null;
  });
  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  const originalSetItem = setItem.getMockImplementation()!;
  let failed = false;
  setItem.mockImplementation(async (key, value) => {
    if (key === 'na-pivo-handled-notification-responses-v1' && !failed) {
      failed = true;
      throw new Error('disk temporarily unavailable');
    }
    return originalSetItem(key, value);
  });
  const navigation = createInviteNavigationCoordinator();
  const ticket = navigation.beginExplicitLookup();
  const onTap = jest.fn();

  try {
    await consumeInitialBeerCountReminderTap(onTap, (notificationId) =>
      navigation.reserveExplicitEntry(ticket, `notification:${notificationId}`));
  } finally {
    setItem.mockImplementation(originalSetItem);
  }

  expect(failed).toBe(true);
  expect(onTap).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(nativeLastResponse).toBeNull();
});

it('does not let an older warm beer tap overtake a newer invite URL during the ledger write', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  const staleA = response('notification-1');
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
    if (key === 'na-pivo-handled-notification-responses-v1') {
      markLedgerWriteStarted();
      await ledgerWriteMayFinish;
    }
    return originalSetItem(key, value);
  });
  const navigation = createInviteNavigationCoordinator();
  const onTap = jest.fn();
  subscribeBeerCountReminderTap(onTap, (notificationId) =>
    navigation.prepareExplicitEntry(`notification:${notificationId}`));
  const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

  try {
    listener?.(staleA);
    await ledgerWriteStarted;
    expect(navigation.handleExplicitInviteCode('newer-url-c').action).toBe('push');
    releaseLedgerWrite();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let attempt = 0; attempt < 30; attempt += 1) await Promise.resolve();
  } finally {
    releaseLedgerWrite();
    setItem.mockImplementation(originalSetItem);
  }

  expect(onTap).not.toHaveBeenCalled();
  expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

it('handles concurrent duplicate warm beer response A exactly once with a navigation ticket', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  const delivered = response('notification-1');
  const navigation = createInviteNavigationCoordinator();
  const onTap = jest.fn();
  mockGetLastNotificationResponseAsync.mockResolvedValue(delivered);
  subscribeBeerCountReminderTap(onTap, (notificationId) =>
    navigation.prepareExplicitEntry(`notification:${notificationId}`));
  const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

  listener?.(delivered);
  listener?.(delivered);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (
    let attempt = 0;
    attempt < 30 && mockScheduleNotificationAsync.mock.calls.length < 2;
    attempt += 1
  ) {
    await Promise.resolve();
  }

  expect(onTap).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
});

it('lets a newer warm beer B take over a delayed cold beer A', async () => {
  const coldA = response('cold-a');
  const warmB = response('warm-b');
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
    if (key === 'na-pivo-handled-notification-responses-v1' && firstLedgerWrite) {
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
  subscribeBeerCountReminderTap(onWarmB, (notificationId) =>
    navigation.prepareExplicitEntry(`notification:${notificationId}`));
  const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

  try {
    const consuming = consumeInitialBeerCountReminderTap(onColdA, (notificationId) =>
      navigation.reserveExplicitEntry(initialTicket, `notification:${notificationId}`));
    await ledgerWriteStarted;
    listener?.(warmB);
    releaseLedgerWrite();
    await consuming;
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    releaseLedgerWrite();
    setItem.mockImplementation(originalSetItem);
  }

  expect(onColdA).not.toHaveBeenCalled();
  expect(onWarmB).toHaveBeenCalledTimes(1);
  expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
});

it('clears a live-first tap before re-arm so cold start and restart stay exactly once', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  const delivered = response('notification-1');
  let nativeLastResponse: ReturnType<typeof response> | null = delivered;
  mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
  mockClearLastNotificationResponseAsync.mockImplementation(async () => {
    nativeLastResponse = null;
  });
  const navigation = createInviteNavigationCoordinator();
  const initialTicket = navigation.beginExplicitLookup();
  const onTap = jest.fn(() => {
    navigation.handleExplicitEntry('notification:notification-1');
  });
  subscribeBeerCountReminderTap(onTap);
  const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

  listener?.(delivered);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (
    let attempt = 0;
    attempt < 20 && mockScheduleNotificationAsync.mock.calls.length < 2;
    attempt += 1
  ) {
    await Promise.resolve();
  }

  expect(nativeLastResponse).toBeNull();
  expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  expect(mockClearLastNotificationResponseAsync.mock.invocationCallOrder[0]).toBeLessThan(
    mockCancelScheduledNotificationAsync.mock.invocationCallOrder[0],
  );
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);

  await consumeInitialBeerCountReminderTap(onTap, (notificationId) =>
    navigation.reserveExplicitEntry(initialTicket, `notification:${notificationId}`));
  resetBeerCountReminderTapDeduperForTests();
  const restartedNavigation = createInviteNavigationCoordinator();
  const restartedTicket = restartedNavigation.beginExplicitLookup();
  await consumeInitialBeerCountReminderTap(onTap, (notificationId) =>
    restartedNavigation.reserveExplicitEntry(
      restartedTicket,
      `notification:${notificationId}`,
    ));

  expect(onTap).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
});

it('does not clear newer native B while re-arming live beer reminder A', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  const staleA = response('notification-1');
  const newerB = response('newer-native-b');
  let nativeLastResponse: ReturnType<typeof response> | null = newerB;
  mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
  mockClearLastNotificationResponseAsync.mockImplementation(async () => {
    nativeLastResponse = null;
  });
  subscribeBeerCountReminderTap(jest.fn());
  const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

  listener?.(staleA);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (
    let attempt = 0;
    attempt < 20 && mockScheduleNotificationAsync.mock.calls.length < 2;
    attempt += 1
  ) {
    await Promise.resolve();
  }

  expect(mockGetLastNotificationResponseAsync).toHaveBeenCalled();
  expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
  expect(nativeLastResponse).toBe(newerB);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
});

it('dedupes concurrent same-ID beer listeners and re-arms only once', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  const delivered = response('notification-1');
  let nativeLastResponse: ReturnType<typeof response> | null = delivered;
  mockGetLastNotificationResponseAsync.mockImplementation(async () => nativeLastResponse);
  mockClearLastNotificationResponseAsync.mockImplementation(async () => {
    nativeLastResponse = null;
  });
  const onTap = jest.fn();
  subscribeBeerCountReminderTap(onTap);
  const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

  listener?.(delivered);
  listener?.(delivered);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (
    let attempt = 0;
    attempt < 30 && mockScheduleNotificationAsync.mock.calls.length < 2;
    attempt += 1
  ) {
    await Promise.resolve();
  }

  expect(onTap).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(nativeLastResponse).toBeNull();
});

it.each(['getLast', 'clear'] as const)(
  're-arms live reminder exactly once when native %s fails and restart retries cleanup',
  async (failure) => {
    await refreshBeerCountReminderAfterBeer(SESSION.clientId);
    const delivered = response('notification-1');
    let nativeLastResponse: ReturnType<typeof response> | null = delivered;
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
    const onTap = jest.fn();
    subscribeBeerCountReminderTap(onTap);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener?.(delivered);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (
      let attempt = 0;
      attempt < 30 && mockScheduleNotificationAsync.mock.calls.length < 2;
      attempt += 1
    ) {
      await Promise.resolve();
    }

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);

    resetBeerCountReminderTapDeduperForTests();
    await consumeInitialBeerCountReminderTap(onTap);

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(nativeLastResponse).toBeNull();
  },
);

it('leaves delayed A untouched when a newer explicit B wins the navigation lease', async () => {
  const staleA = response('notification-race-a');
  const newerB = response('newer-notification-b');
  await AsyncStorage.setItem(
    'na-pivo-beer-count-reminder-state',
    JSON.stringify({
      notificationId: 'notification-race-a',
      sessionId: SESSION.clientId,
      fireAtMs: Date.now() + 60_000,
    }),
  );
  let nativeLastResponse: ReturnType<typeof response> | null = staleA;
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
  const consuming = consumeInitialBeerCountReminderTap(onTap, (notificationId) =>
    navigation.reserveExplicitEntry(initialTicket, `notification:${notificationId}`));
  while (mockGetLastNotificationResponseAsync.mock.calls.length === 0) {
    await Promise.resolve();
  }

  nativeLastResponse = newerB;
  navigation.handleExplicitEntry('notification:newer-b');
  resolveInitial(staleA);
  await consuming;

  expect(onTap).not.toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(mockClearLastNotificationResponseAsync).not.toHaveBeenCalled();
  expect(nativeLastResponse).toBe(newerB);

  // A also remains unclaimed by the reminder deduper. With a fresh winning
  // navigation lease, the exact same response can still navigate and re-arm.
  mockGetLastNotificationResponseAsync.mockResolvedValueOnce(staleA);
  const retryNavigation = createInviteNavigationCoordinator();
  const retryTicket = retryNavigation.beginExplicitLookup();
  await consumeInitialBeerCountReminderTap(onTap, (notificationId) =>
    retryNavigation.reserveExplicitEntry(retryTicket, `notification:${notificationId}`));

  expect(onTap).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-race-a');
});

it('reschedules a pending reminder when its interval changes', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  useSettingsStore.getState().setBeerCountReminderIntervalMinutes(30);

  await reschedulePendingBeerCountReminder();

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  expect(mockScheduleNotificationAsync).toHaveBeenLastCalledWith(
    expect.objectContaining({
      trigger: expect.objectContaining({ seconds: 30 * 60, repeats: false }),
    }),
  );
});

it('cancels the pending reminder when the preference is disabled', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);

  await disableBeerCountReminderNotifications();

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  expect(useSettingsStore.getState().beerCountReminderEnabled).toBe(false);
});

it('fails quietly and turns the preference off when notifications are denied', async () => {
  mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });

  await expect(refreshBeerCountReminderAfterBeer(SESSION.clientId)).resolves.toEqual({
    ok: false,
    reason: 'notifications-denied',
  });
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(useSettingsStore.getState().beerCountReminderEnabled).toBe(false);
});

it('cancels an OS reminder that finishes scheduling after the account freeze', async () => {
  let resolveSchedule: (notificationId: string) => void = () => undefined;
  let notifyScheduleStarted: () => void = () => undefined;
  const scheduleStarted = new Promise<void>((resolve) => {
    notifyScheduleStarted = resolve;
  });
  mockScheduleNotificationAsync.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        resolveSchedule = resolve;
        notifyScheduleStarted();
      }),
  );

  const scheduling = refreshBeerCountReminderAfterBeer(SESSION.clientId);
  await scheduleStarted;
  const transition = beginPrivateAccountTransition('account-switch', 'account-A');
  expect(transition).not.toBeNull();

  resolveSchedule('late-account-A-notification');
  await expect(scheduling).resolves.toEqual({ ok: false, reason: 'unavailable' });
  await transition!.drain();

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
    'late-account-A-notification',
  );
  expect(await AsyncStorage.getItem('na-pivo-beer-count-reminder-state')).toBeNull();
  expect(useSettingsStore.getState().beerCountReminderEnabled).toBe(true);
  transition!.release();
});

it('strictly clears every beer reminder while preserving the device preference', async () => {
  await AsyncStorage.setItem(
    'na-pivo-beer-count-reminder-state',
    JSON.stringify({
      notificationId: 'recorded-A',
      sessionId: SESSION.clientId,
      fireAtMs: Date.now() + 60_000,
    }),
  );
  mockGetAllScheduledNotificationsAsync
    .mockResolvedValueOnce([
      {
        identifier: 'recorded-A',
        content: { data: { kind: BEER_COUNT_REMINDER_KIND } },
      },
      {
        identifier: 'late-A',
        content: { data: { kind: BEER_COUNT_REMINDER_KIND } },
      },
      {
        identifier: 'unrelated',
        content: { data: { kind: 'friend_push' } },
      },
    ])
    .mockResolvedValueOnce([]);
  const transition = beginPrivateAccountTransition('account-switch', 'account-A');
  await transition!.drain();

  await expect(clearBeerCountReminderForAccountBoundary()).resolves.toBe(true);

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('recorded-A');
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('late-A');
  expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith('unrelated');
  expect(await AsyncStorage.getItem('na-pivo-beer-count-reminder-state')).toBeNull();
  expect(useSettingsStore.getState().beerCountReminderEnabled).toBe(true);
  transition!.release();
});

it('ignores a stale notification tap while the private account is frozen', async () => {
  const onTap = jest.fn();
  subscribeBeerCountReminderTap(onTap);
  const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];
  expect(listener).toBeDefined();
  const transition = beginPrivateAccountTransition('account-switch', 'account-A');

  listener!(response('frozen-account-A'));
  await Promise.resolve();

  expect(onTap).not.toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  transition!.release();
});

it('cancels the chain when its evening ends', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  await initializeBeerCountReminderNotifications();

  useTallyStore.setState({ current: null });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
});
