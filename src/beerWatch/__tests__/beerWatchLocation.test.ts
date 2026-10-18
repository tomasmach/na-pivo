import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import type * as LocationModule from '../beerWatchLocation';
import type * as StoreModule from '@/stores/beerWatchStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

const mockUpdateSettings = jest.fn();
jest.mock('@/data/beerWatchClient', () => ({
  fetchBeerWatches: jest.fn(),
  addBeerWatch: jest.fn(),
  removeBeerWatch: jest.fn(),
  updateBeerWatchSettings: (body: unknown) => mockUpdateSettings(body),
}));

let mockAccountId: string | null = 'account-1';
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: {
    getState: () => ({ session: mockAccountId ? { accountId: mockAccountId } : null }),
  },
}));

const HOUR = 60 * 60 * 1000;
// Prague, Národní třída. The server must never see these digits.
const FIX = { coords: { latitude: 50.08147, longitude: 14.41862 } };
const CELL = { lat: 50.08275, lng: 14.4165 };

function load(): { location: typeof LocationModule; store: typeof StoreModule } {
  let modules!: { location: typeof LocationModule; store: typeof StoreModule };
  jest.isolateModules(() => {
    modules = {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      location: require('../beerWatchLocation'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      store: require('@/stores/beerWatchStore'),
    };
  });
  modules.store.useBeerWatchStore.setState({
    watches: [{ productKey: 'unetice-12', name: 'Únětická 12°', aliases: [] }],
    locationSet: true,
  });
  return modules;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAccountId = 'account-1';
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
    status: 'granted',
  } as Location.LocationPermissionResponse);
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(FIX as Location.LocationObject);
  mockUpdateSettings.mockResolvedValue({ radiusM: 3000, locationSet: true, watches: null, helped: null });
});

describe('grid snapping (same formula as the backend)', () => {
  it('returns the centre of the ~500 m cell rounded to 5 decimals', () => {
    const { location } = load();
    // (floor(v / step) + 0.5) * step
    expect(location.snapToGrid(50.08147, 0.0045)).toBe(50.08275);
    expect(location.snapToGrid(14.41862, 0.007)).toBe(14.4165);
    expect(location.snapToGrid(-0.001, 0.0045)).toBe(-0.00225);
    expect(location.snapBeerWatchLocation(50.08147, 14.41862)).toEqual(CELL);
  });

  it('puts two points in the same cell on the same centre', () => {
    const { location } = load();
    expect(location.snapBeerWatchLocation(50.0806, 14.4142)).toEqual(
      location.snapBeerWatchLocation(50.0849, 14.4189),
    );
  });
});

describe('syncBeerWatchLocation', () => {
  it('sends only the snapped cell, never the precise fix', async () => {
    const { location } = load();
    await location.syncBeerWatchLocation(1_000);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    expect(mockUpdateSettings).toHaveBeenCalledWith(CELL);
  });

  it('does not PATCH again for the same cell within 24 h', async () => {
    const { location } = load();
    await location.syncBeerWatchLocation(1_000);
    await location.syncBeerWatchLocation(1_000 + 23 * HOUR);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
  });

  it('PATCHes again after 24 h in the same cell', async () => {
    const { location } = load();
    await location.syncBeerWatchLocation(1_000);
    await location.syncBeerWatchLocation(1_000 + 25 * HOUR);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(2);
  });

  it('PATCHes right away when the cell changes', async () => {
    const { location } = load();
    await location.syncBeerWatchLocation(1_000);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue({
      coords: { latitude: 49.19522, longitude: 16.60796 },
    } as Location.LocationObject);
    await location.syncBeerWatchLocation(2_000);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(2);
    expect(mockUpdateSettings).toHaveBeenLastCalledWith(location.snapBeerWatchLocation(49.19522, 16.60796));
  });

  it('remembers the sent cell across an app restart', async () => {
    await load().location.syncBeerWatchLocation(1_000);
    await load().location.syncBeerWatchLocation(1_000 + HOUR);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
  });

  it('resends the same cell when the server has no location (last watch was removed)', async () => {
    const { location, store } = load();
    await location.syncBeerWatchLocation(1_000);
    store.useBeerWatchStore.setState({ locationSet: false });
    await location.syncBeerWatchLocation(2_000);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(2);
  });

  it('resends for another account on the same device', async () => {
    const { location } = load();
    await location.syncBeerWatchLocation(1_000);
    mockAccountId = 'account-2';
    await location.syncBeerWatchLocation(2_000);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed PATCH', async () => {
    const { location } = load();
    mockUpdateSettings.mockResolvedValueOnce(null);
    await location.syncBeerWatchLocation(1_000);
    await location.syncBeerWatchLocation(2_000);
    expect(mockUpdateSettings).toHaveBeenCalledTimes(2);
  });

  it('never prompts and sends nothing without location permission', async () => {
    const { location } = load();
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
      status: 'undetermined',
    } as Location.LocationPermissionResponse);
    await location.syncBeerWatchLocation(1_000);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('sends nothing without watches or without an account', async () => {
    const { location, store } = load();
    store.useBeerWatchStore.setState({ watches: [] });
    await location.syncBeerWatchLocation(1_000);
    store.useBeerWatchStore.setState({
      watches: [{ productKey: 'unetice-12', name: 'Únětická 12°', aliases: [] }],
    });
    mockAccountId = null;
    await location.syncBeerWatchLocation(2_000);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});
