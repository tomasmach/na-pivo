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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
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
  reschedulePendingBeerCountReminder,
  subscribeBeerCountReminderTap,
} from '../beerCountReminder';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '@/data/privateAccountBoundary';
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
  jest.clearAllMocks();
  await AsyncStorage.clear();
  let nextId = 1;
  mockScheduleNotificationAsync.mockImplementation(async () => `notification-${nextId++}`);
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockGetAllScheduledNotificationsAsync.mockResolvedValue([]);
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
        title: 'Nezapomněl sis zapsat pivko?',
        data: expect.objectContaining({
          kind: BEER_COUNT_REMINDER_KIND,
          sessionId: SESSION.clientId,
        }),
      }),
      trigger: expect.objectContaining({ seconds: 20 * 60, repeats: false }),
    }),
  );
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
