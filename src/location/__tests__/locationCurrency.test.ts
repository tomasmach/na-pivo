import { currencyForCountryCode } from '../locationCurrency';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
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
