const mockGetLastKnownPositionAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
const mockGetBackgroundPermissionsAsync = jest.fn();
const mockStartGeofencingAsync = jest.fn();
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
  hasStartedGeofencingAsync: jest.fn(async () => false),
  stopGeofencingAsync: jest.fn(async () => undefined),
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
import { refreshPubReminderGeofences } from '../pubReminderNotifications';

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
      },
    },
  ]);
  mockStartGeofencingAsync.mockResolvedValue(undefined);
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
});
