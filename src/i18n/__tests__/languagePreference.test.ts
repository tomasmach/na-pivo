import { DevSettings } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import {
  LANGUAGE_PREFERENCE_KEY,
  applyLanguagePreference,
  readLanguagePreference,
} from '../languagePreference';

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(() => Promise.reject(new Error('dev'))) }));
jest.mock('react-native', () => ({ DevSettings: { reload: jest.fn() } }));

describe('language preference', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync(LANGUAGE_PREFERENCE_KEY);
    jest.clearAllMocks();
  });

  it('defaults to following the phone and ignores junk', async () => {
    expect(readLanguagePreference()).toBe('system');
    await SecureStore.setItemAsync(LANGUAGE_PREFERENCE_KEY, 'de');
    expect(readLanguagePreference()).toBe('system');
  });

  it('stores an explicit language and reloads the bundle', async () => {
    await applyLanguagePreference('en');
    expect(readLanguagePreference()).toBe('en');
    expect(DevSettings.reload).toHaveBeenCalledTimes(1);
  });

  it('clears the override when the user goes back to the phone language', async () => {
    await applyLanguagePreference('cs');
    await applyLanguagePreference('system');
    expect(readLanguagePreference()).toBe('system');
  });
});
