import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PubHoursResult } from '@/data/hoursClient';
import type { Pub } from '@/data/pubs';

const mockScheduleNotificationAsync = jest.fn<Promise<string>, [unknown]>();
const mockSetNotificationCategoryAsync = jest.fn<Promise<unknown>, [string, unknown[]]>();
const mockGetPermissionsAsync = jest.fn(async () => ({ granted: true, status: 'granted' }));
const mockFindNearbyPubs = jest.fn();
const mockFetchPubHours = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: mockGetPermissionsAsync,
  setNotificationCategoryAsync: mockSetNotificationCategoryAsync,
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}));

jest.mock('@/data/pubs', () => ({ findNearbyPubs: mockFindNearbyPubs }));
jest.mock('@/data/hoursClient', () => ({ fetchPubHours: mockFetchPubHours }));

const NOW = Date.parse('2026-11-06T20:00:00Z');
const CLOSES_AT = NOW + 3 * 60 * 60_000;
const PUB_KEY = 'u2fkbnhu';

function hours(isOpenNow: boolean, nextChangeMs: number | null): PubHoursResult {
  return {
    status: 'ok',
    isOpenNow,
    nextChange: nextChangeMs === null ? null : new Date(nextChangeMs).toISOString(),
  } as PubHoursResult;
}

const nearby: { pub: Pub; distanceMeters: number }[] = [
  { pub: { id: 'a', name: 'Lokál', lat: 50.0901, lng: 14.4201 }, distanceMeters: 180 },
  { pub: { id: 'b', name: 'Výčep', lat: 50.0911, lng: 14.4211 }, distanceMeters: 240 },
  { pub: { id: 'c', name: 'Parlament', lat: 50.0921, lng: 14.4221 }, distanceMeters: 600 },
  { pub: { id: 'd', name: 'Pivnice', lat: 50.0931, lng: 14.4231 }, distanceMeters: 800 },
];
const hoursById = new Map<string, PubHoursResult>([
  [PUB_KEY, hours(true, CLOSES_AT)],
  ['a', hours(true, CLOSES_AT + 2 * 60 * 60_000)],
  ['b', hours(true, CLOSES_AT)],
  ['c', hours(true, null)],
  ['d', hours(true, CLOSES_AT + 60 * 60_000)],
]);

type Modules = {
  reminder: typeof import('../closingTimeReminder');
  settings: typeof import('@/stores/settingsStore');
  tally: typeof import('@/stores/tallyStore');
};

function load(): Modules {
  let modules!: Modules;
  jest.isolateModules(() => {
    modules = {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      reminder: require('../closingTimeReminder'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      settings: require('@/stores/settingsStore'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      tally: require('@/stores/tallyStore'),
    };
  });
  modules.tally.useTallyStore.setState({
    current: {
      clientId: 'evening-1',
      pubKey: PUB_KEY,
      pubName: 'U Tygra',
      startedAt: '2026-11-06T19:00:00.000Z',
      drinks: [{ id: 'beer-1', beerName: 'Plzeň', at: '2026-11-06T19:00:00.000Z' }],
    },
    history: [],
  });
  return modules;
}

type Scheduled = {
  identifier: string;
  content: { title: string; body: string; categoryIdentifier: string; data: { pubs: { name: string }[] } };
  trigger: { date: Date };
};
const scheduled = () => mockScheduleNotificationAsync.mock.calls.map(([request]) => request as Scheduled);

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  await AsyncStorage.clear();
  mockScheduleNotificationAsync.mockImplementation(async (request) => (request as Scheduled).identifier);
  mockFindNearbyPubs.mockReturnValue(nearby);
  mockFetchPubHours.mockImplementation(async (pubs: Pub[]) => new Map(pubs.map((pub) => [pub.id, hoursById.get(pub.id)!])));
});

afterEach(() => jest.restoreAllMocks());

it('rings an hour before closing with buttons for the nearest pubs open longer', async () => {
  const { reminder } = load();
  await reminder.syncClosingTimeReminder();

  expect(mockFetchPubHours).toHaveBeenCalledWith(expect.any(Array), undefined, { syncBudget: 0 });
  const [request] = scheduled();
  expect(request.trigger.date.getTime()).toBe(CLOSES_AT - 60 * 60_000);
  expect(request.content.title).toMatch(/^U Tygra zavírá ve? \d/);
  expect(request.content.body).toBe('Déle mají otevřeno Lokál (180\u00a0m), Parlament (600\u00a0m) a Pivnice (800\u00a0m).');
  expect(request.content.data.pubs.map((pub) => pub.name)).toEqual(['Lokál', 'Parlament', 'Pivnice']);
  expect(mockSetNotificationCategoryAsync).toHaveBeenCalledWith(request.content.categoryIdentifier, [
    { identifier: 'pub-0', buttonTitle: 'Lokál · 180\u00a0m', options: { opensAppToForeground: true } },
    { identifier: 'pub-1', buttonTitle: 'Parlament · 600\u00a0m', options: { opensAppToForeground: true } },
    { identifier: 'pub-2', buttonTitle: 'Pivnice · 800\u00a0m', options: { opensAppToForeground: true } },
  ]);
});

it('rings once per evening, also after the app comes back later', async () => {
  const { reminder } = load();
  await reminder.syncClosingTimeReminder();
  await reminder.syncClosingTimeReminder();
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);

  // After the ping went off, a fresh lookup must not plan another one.
  jest.spyOn(Date, 'now').mockReturnValue(CLOSES_AT - 30 * 60_000);
  await reminder.syncClosingTimeReminder();
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

it('keeps pub names out of the notification when the user hides them', async () => {
  const { reminder, settings } = load();
  settings.useSettingsStore.setState({ hidePubNames: true });
  await reminder.syncClosingTimeReminder();

  const [request] = scheduled();
  expect(request.content.title).not.toContain('U Tygra');
  expect(request.content.body).toBe('Kousek odsud mají déle otevřeno ještě 3 hospody.');
  expect(mockSetNotificationCategoryAsync.mock.calls[0][1]).toEqual([
    expect.objectContaining({ buttonTitle: 'Hospoda · 180\u00a0m' }),
    expect.objectContaining({ buttonTitle: 'Hospoda · 600\u00a0m' }),
    expect.objectContaining({ buttonTitle: 'Hospoda · 800\u00a0m' }),
  ]);
});

it('never asks for permission and stays quiet without it', async () => {
  mockGetPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'undetermined' });
  const { reminder } = load();
  await reminder.syncClosingTimeReminder();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
});

it('stays quiet when the setting is off or the evening is not in a pub', async () => {
  const { reminder, settings, tally } = load();
  settings.useSettingsStore.setState({ closingTimeReminderEnabled: false });
  await reminder.syncClosingTimeReminder();

  settings.useSettingsStore.setState({ closingTimeReminderEnabled: true });
  tally.useTallyStore.setState({ current: { ...tally.useTallyStore.getState().current!, pubKey: 'ctx:home' } });
  await reminder.syncClosingTimeReminder();

  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
});

it('asks again on the next sync when the pubs around were not loaded yet', async () => {
  mockFindNearbyPubs.mockReturnValueOnce([]);
  const { reminder } = load();
  await reminder.syncClosingTimeReminder();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();

  await reminder.syncClosingTimeReminder();
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

it('opens the pub of the pressed button, and the nearest one on a plain tap', () => {
  const { reminder } = load();
  const pubs = [
    { key: 'u2fkbnh1', name: 'Lokál', lat: 50.09, lng: 14.42 },
    { key: 'u2fkbnh2', name: 'Parlament', lat: 50.1, lng: 14.43 },
  ];
  const response = (actionIdentifier: string) =>
    ({
      actionIdentifier,
      notification: { request: { identifier: 'closing-time-reminder', content: { data: { kind: 'closing_time', pubs } } } },
    }) as never;

  expect(reminder.closingTimePub(response('pub-1'))).toEqual(pubs[1]);
  expect(reminder.closingTimePub(response('expo.modules.notifications.actions.DEFAULT'))).toEqual(pubs[0]);
  expect(reminder.closingTimePub(response('pub-7'))).toBeNull();
});
