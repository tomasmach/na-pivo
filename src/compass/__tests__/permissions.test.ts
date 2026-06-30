import * as Location from 'expo-location';
import {
  checkLocationPermission,
  ensureLocationPermission,
  requestLocationPermission,
} from '../permissions';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Linking: {
    openSettings: jest.fn(async () => undefined),
  },
}));

const getForegroundPermissionsAsync = Location.getForegroundPermissionsAsync as jest.Mock;
const requestForegroundPermissionsAsync = Location.requestForegroundPermissionsAsync as jest.Mock;

describe('location permission helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('checks current permission without prompting', async () => {
    getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' });

    await expect(checkLocationPermission()).resolves.toBe('undetermined');

    expect(getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests permission only through the explicit request helper', async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });

    await expect(requestLocationPermission()).resolves.toBe('granted');

    expect(getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('ensure checks first and prompts only while undetermined', async () => {
    getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(ensureLocationPermission()).resolves.toBe('denied');
    expect(requestForegroundPermissionsAsync).not.toHaveBeenCalled();

    getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    await expect(ensureLocationPermission()).resolves.toBe('granted');
    expect(requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
