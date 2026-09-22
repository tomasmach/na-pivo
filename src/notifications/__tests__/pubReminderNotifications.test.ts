import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerPushDevice, disablePushDevice } from '@/data/pushDeviceClient';

const mockGetLastKnownPositionAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
const mockGetBackgroundPermissionsAsync = jest.fn();
const mockStartGeofencingAsync = jest.fn();
const mockHasStartedGeofencingAsync = jest.fn();
const mockStopGeofencingAsync = jest.fn();
const mockFetchPubsNear = jest.fn();
const mockFindNearbyPubs = jest.fn();
const mockSettingsGetState = jest.fn();
const mockGetNotificationPermissions = jest.fn();
const mockScheduleNotification = jest.fn();
const mockCancelNotification = jest.fn();
const mockTrackApiFailure = jest.fn();
let mockTaskHandler: (body: { data?: unknown; error?: unknown }) => Promise<void>;

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'project-id' } } },
  easConfig: null,
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: mockGetNotificationPermissions,
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  scheduleNotificationAsync: mockScheduleNotification,
  cancelScheduledNotificationAsync: mockCancelNotification,
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((_name, handler) => { mockTaskHandler = handler; }),
}));

jest.mock('@/data/telemetryClient', () => ({
  trackApiFailure: (...args: unknown[]) => mockTrackApiFailure(...args),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getLastKnownPositionAsync: mockGetLastKnownPositionAsync,
  getCurrentPositionAsync: mockGetCurrentPositionAsync,
  getBackgroundPermissionsAsync: mockGetBackgroundPermissionsAsync,
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
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
  initializePubReminderNotifications,
  enablePubReminderNotifications,
  disablePubReminderNotifications,
  isPubReminderEligible,
  refreshPubReminderGeofences,
} from '../pubReminderNotifications';

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
  await AsyncStorage.clear();
  mockGetNotificationPermissions.mockResolvedValue({ status: 'granted' });
  mockScheduleNotification.mockResolvedValue('scheduled-id');
  mockCancelNotification.mockResolvedValue(undefined);
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
});

afterEach(() => { jest.useRealTimers(); });

describe('geofence task failures', () => {
  it('keeps a failed schedule retryable without a rejected task or a phantom reminder', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 22, 19));
    AppState.currentState = 'background';
    await AsyncStorage.setItem('na-pivo-pub-reminders-enabled', 'true');
    await AsyncStorage.setItem('na-pivo-pub-reminder-geofences', JSON.stringify({ pub: 'Private pub' }));
    await AsyncStorage.setItem('na-pivo-pub-reminder-state', JSON.stringify({ pendingReminder: {
      pubId: 'old-pub', pubName: 'Old private pub', enteredAtMs: Date.now() - 2_000,
      scheduledAtMs: Date.now() - 2_000, fireAtMs: Date.now() + 10_000, notificationId: 'old-id',
    } }));
    mockScheduleNotification.mockRejectedValueOnce(new Error('secret native notification contents'));
    const enter = { data: { eventType: 1, region: { identifier: 'pub' } } };
    await expect(mockTaskHandler(enter)).resolves.toBeUndefined();
    expect(mockCancelNotification).toHaveBeenCalledWith('old-id');
    expect(JSON.parse((await AsyncStorage.getItem('na-pivo-pub-reminder-state'))!)).toEqual({});
    expect(mockTrackApiFailure).toHaveBeenCalledWith('pub_reminder_task', {
      reason: 'native_operation_failed', app_state: 'background',
      error_category: 'notification_schedule', retryable: true,
    });
    await mockTaskHandler(enter);
    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    await mockTaskHandler(enter);
    expect(mockScheduleNotification).toHaveBeenCalledTimes(2);
    const stored = JSON.parse((await AsyncStorage.getItem('na-pivo-pub-reminder-state'))!);
    expect(stored.pendingReminder.notificationId).toBe('scheduled-id');
    await mockTaskHandler({ data: { eventType: 2, region: { identifier: 'pub' } } });
    expect(mockCancelNotification).toHaveBeenCalledWith('scheduled-id');
    expect(JSON.parse((await AsyncStorage.getItem('na-pivo-pub-reminder-state'))!)).toEqual({});
  });

  it('reports native task errors without retaining their private contents', async () => {
    await expect(mockTaskHandler({ error: { code: 1, message: 'secret GPS' } })).resolves.toBeUndefined();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('pub_reminder_task', expect.objectContaining({
      error_category: 'geofence_task',
    }));
    expect(JSON.stringify(mockTrackApiFailure.mock.calls)).not.toContain('secret');
    expect(mockScheduleNotification).not.toHaveBeenCalled();
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
  it('stops stale geofences when notification permission has been revoked', async () => {
    mockGetNotificationPermissions.mockResolvedValue({ status: 'denied' });
    mockHasStartedGeofencingAsync.mockResolvedValue(true);
    await refreshPubReminderGeofences();
    expect(mockStopGeofencingAsync).toHaveBeenCalled();
    expect(mockFetchPubsNear).not.toHaveBeenCalled();
    expect(mockStartGeofencingAsync).not.toHaveBeenCalled();
  });
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


it('keeps local reminders independent of the Parta server push choice', async () => {
  jest.useFakeTimers();
  try {
    mockSettingsGetState.mockReturnValue({ pubReminderEnabled: true, friendPushOptedOut: true });
    mockGetLastKnownPositionAsync.mockResolvedValue(location(50.081, 14.419));
    (AppState as { currentState: string }).currentState = 'active';
    await AsyncStorage.setItem('push-token', 'ExponentPushToken[test]');

    await initializePubReminderNotifications();
    await jest.advanceTimersByTimeAsync(8_000);
    await expect(enablePubReminderNotifications()).resolves.toEqual({ ok: true });
    expect(mockStartGeofencingAsync).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('na-pivo-pub-reminders-enabled')).toBe('true');

    mockHasStartedGeofencingAsync.mockResolvedValue(true);
    await disablePubReminderNotifications();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockStopGeofencingAsync).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('na-pivo-pub-reminders-enabled')).toBe('false');
    expect(registerPushDevice).not.toHaveBeenCalled();
    expect(disablePushDevice).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
