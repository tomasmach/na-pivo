import AsyncStorage from '@react-native-async-storage/async-storage';

const mockScheduleNotificationAsync = jest.fn<Promise<string>, [unknown]>();
const mockCancelScheduledNotificationAsync = jest.fn(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  cancelScheduledNotificationAsync: mockCancelScheduledNotificationAsync,
}));

import {
  HOME_TRANSIT_REMINDER_LEAD_MS,
  syncHomeTransitReminder,
} from '../homeTransitReminder';
import { useHomeTransitStore } from '@/stores/homeTransitStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';

const NOW = Date.parse('2026-10-07T20:00:00Z');
const PUB_KEY = 'u2fhzg0s';
// The evening, pub and home the stored ride belongs to.
const LOOKUP_KEY = `session-1|${PUB_KEY}|50.09050,14.43920`;
const departure = {
  line: '9',
  headsign: 'Spojovací',
  routeType: 0,
  fromStopId: 'U1Z1P',
  fromStopName: 'Anděl',
  toStopId: 'U2Z1P',
  toStopName: 'Florenc',
  departsAtMs: NOW + 60 * 60_000,
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  await AsyncStorage.clear();
  let nextId = 1;
  mockScheduleNotificationAsync.mockImplementation(async () => `notification-${nextId++}`);
  useSettingsStore.setState({
    homeTransitReminderEnabled: true,
    homePoint: { lat: 50.0905, lng: 14.4392 },
  });
  useTallyStore.setState({
    current: {
      clientId: 'session-1',
      pubKey: PUB_KEY,
      pubName: 'U Anděla',
      startedAt: '2026-10-07T18:00:00.000Z',
      drinks: [{ id: 'beer-1', beerName: 'Plzeň', at: '2026-10-07T18:00:00.000Z' }],
    },
    history: [],
  });
  useHomeTransitStore.setState({ lookupKey: LOOKUP_KEY, departure, checkedAt: NOW });
});

afterEach(() => jest.restoreAllMocks());

it('stays off unless the user turned it on', async () => {
  useSettingsStore.setState({ homeTransitReminderEnabled: false });
  await syncHomeTransitReminder();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(useSettingsStore.getInitialState().homeTransitReminderEnabled).toBe(false);
});

it('rings 20 minutes before the departure, once', async () => {
  await syncHomeTransitReminder();
  await syncHomeTransitReminder();

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  const request = mockScheduleNotificationAsync.mock.calls[0][0] as {
    trigger: { type: string; date: Date };
    content: { title: string; body: string };
  };
  expect(request.trigger.type).toBe('date');
  expect(request.trigger.date.getTime()).toBe(departure.departsAtMs - HOME_TRANSIT_REMINDER_LEAD_MS);
  expect(`${request.content.title} ${request.content.body}`).not.toMatch(/řídit|promile|střízl/i);
});

it('moves the reminder with a new connection and drops it with none', async () => {
  await syncHomeTransitReminder();
  useHomeTransitStore.setState({ departure: { ...departure, departsAtMs: departure.departsAtMs + 600_000 } });
  await syncHomeTransitReminder();
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);

  useHomeTransitStore.setState({ departure: null });
  await syncHomeTransitReminder();
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-2');
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
});

it('does not ring when less than 20 minutes are left', async () => {
  useHomeTransitStore.setState({ departure: { ...departure, departsAtMs: NOW + 10 * 60_000 } });
  await syncHomeTransitReminder();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
});

it('keeps a planned ping when the same ride is confirmed seconds before it rings', async () => {
  await syncHomeTransitReminder();
  (Date.now as jest.Mock).mockReturnValue(departure.departsAtMs - HOME_TRANSIT_REMINDER_LEAD_MS - 10_000);
  useHomeTransitStore.setState({ departure: { ...departure }, checkedAt: Date.now() });
  await syncHomeTransitReminder();

  expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

it('drops the ping when the stored ride belongs to another evening', async () => {
  await syncHomeTransitReminder();
  useTallyStore.setState({
    current: { ...useTallyStore.getState().current!, clientId: 'session-2' },
  });
  await syncHomeTransitReminder();

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

it('replans the ping without the stop once pub names are hidden', async () => {
  await syncHomeTransitReminder();
  useSettingsStore.setState({ hidePubNames: true });
  await syncHomeTransitReminder();

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  const replanned = mockScheduleNotificationAsync.mock.calls[1][0] as { content: { body: string } };
  expect(replanned.content.body).not.toContain('Anděl');
});
