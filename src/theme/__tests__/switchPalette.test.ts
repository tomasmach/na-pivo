import * as Updates from 'expo-updates';
import * as SecureStore from 'expo-secure-store';

import { switchPalette } from '../switchPalette';

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-alternate-app-icons', () => ({
  supportsAlternateIcons: true,
  // The icon change never settles, as if its alert stayed up.
  setAlternateAppIcon: jest.fn(() => new Promise(() => {})),
}));

describe('switchPalette', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('restarts even when the icon change never settles, and ignores a second tap meanwhile', async () => {
    const first = switchPalette('brown');
    await expect(switchPalette('gray')).resolves.toBe(true);
    expect(SecureStore.getItem('na-pivo-palette')).toBe('brown');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(10_000);
    await expect(first).resolves.toBe(true);
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  });
});
