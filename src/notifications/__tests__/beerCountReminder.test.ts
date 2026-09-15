import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGetPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
const mockRequestPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
const mockScheduleNotificationAsync = jest.fn<Promise<string>, [unknown]>();
const mockCancelScheduledNotificationAsync = jest.fn(async () => undefined);
const mockGetLastNotificationResponseAsync = jest.fn();
const mockClearLastNotificationResponseAsync = jest.fn(async () => undefined);

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
  getLastNotificationResponseAsync: mockGetLastNotificationResponseAsync,
  clearLastNotificationResponseAsync: mockClearLastNotificationResponseAsync,
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import {
  BEER_COUNT_REMINDER_KIND,
  consumeInitialBeerCountReminderTap,
  disableBeerCountReminderNotifications,
  initializeBeerCountReminderNotifications,
  refreshBeerCountReminderAfterBeer,
  reschedulePendingBeerCountReminder,
} from '../beerCountReminder';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

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
  jest.clearAllMocks();
  await AsyncStorage.clear();
  let nextId = 1;
  mockScheduleNotificationAsync.mockImplementation(async () => `notification-${nextId++}`);
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  useSettingsStore.setState({
    beerCountReminderEnabled: true,
    beerCountReminderIntervalMinutes: 20,
  });
  useTallyStore.setState({ current: SESSION, history: [] });
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

it('cancels the chain when its evening ends', async () => {
  await refreshBeerCountReminderAfterBeer(SESSION.clientId);
  await initializeBeerCountReminderNotifications();

  useTallyStore.setState({ current: null });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
});
