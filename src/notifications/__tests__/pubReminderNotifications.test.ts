import { AppState } from 'react-native';

const mockGetLastKnownPositionAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
const mockGetBackgroundPermissionsAsync = jest.fn();
const mockStartGeofencingAsync = jest.fn();
const mockHasStartedGeofencingAsync = jest.fn();
const mockStopGeofencingAsync = jest.fn();
const mockFetchPubsNear = jest.fn();
const mockFindNearbyPubs = jest.fn();
const mockSettingsGetState = jest.fn();

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
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  scheduleNotificationAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
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
  initializePubReminderNotifications,
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

beforeEach(() => {
  jest.clearAllMocks();
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
