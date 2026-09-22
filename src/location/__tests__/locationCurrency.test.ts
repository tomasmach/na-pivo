import * as Location from 'expo-location';
import {
  currencyForCountryCode,
  resetLocationCurrencyForTests,
  updateCurrencyFromCoordinates,
} from '../locationCurrency';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  reverseGeocodeAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('country-to-currency', () => ({
  __esModule: true,
  default: { CZ: 'CZK', SK: 'EUR', TH: 'THB', US: 'USD', JP: 'JPY' },
}));

describe('location currency mapping', () => {
  it.each([
    ['CZ', 'CZK'],
    ['SK', 'EUR'],
    ['TH', 'THB'],
    ['US', 'USD'],
    ['JP', 'JPY'],
  ])('maps %s to %s', (country, currency) => {
    expect(currencyForCountryCode(country)).toBe(currency);
  });

  it('fails safely for a missing or unknown country', () => {
    expect(currencyForCountryCode(undefined)).toBeNull();
    expect(currencyForCountryCode('XX')).toBeNull();
  });
});

describe('location currency detection backoff', () => {
  const reverseGeocode = Location.reverseGeocodeAsync as jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-22T20:00:00Z'));
    reverseGeocode.mockReset();
    resetLocationCurrencyForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not geocode the same cell on every fix after a failure', async () => {
    reverseGeocode.mockRejectedValue(new Error('offline'));

    await updateCurrencyFromCoordinates(50.08, 14.42);
    await updateCurrencyFromCoordinates(50.0801, 14.4201);
    expect(reverseGeocode).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-09-22T20:10:01Z'));
    await updateCurrencyFromCoordinates(50.08, 14.42);
    expect(reverseGeocode).toHaveBeenCalledTimes(2);
  });

  it('backs off a country without a known currency but retries a new cell', async () => {
    reverseGeocode.mockResolvedValue([{ isoCountryCode: 'XX' }]);

    await updateCurrencyFromCoordinates(50.08, 14.42);
    await updateCurrencyFromCoordinates(50.08, 14.42);
    expect(reverseGeocode).toHaveBeenCalledTimes(1);

    await updateCurrencyFromCoordinates(48.15, 17.11);
    expect(reverseGeocode).toHaveBeenCalledTimes(2);
  });
});
