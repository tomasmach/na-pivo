/**
 * Optional language override chosen in Settings. Stored in the secure store
 * because it is the one storage the app can read synchronously at launch,
 * before any screen (or module-level copy such as the game catalogue) runs.
 * Changing it needs a JS reload; see applyLanguagePreference.
 */

import { DevSettings } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';

import type { Locale } from './locale';

export type LanguagePreference = 'system' | Locale;

export const LANGUAGE_PREFERENCE_KEY = 'napivo.languagePreference';

export function readLanguagePreference(): LanguagePreference {
  try {
    const stored = SecureStore.getItem(LANGUAGE_PREFERENCE_KEY);
    return stored === 'cs' || stored === 'en' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the choice and restart the JS bundle so every screen picks it up. */
export async function applyLanguagePreference(preference: LanguagePreference): Promise<void> {
  if (preference === 'system') {
    await SecureStore.deleteItemAsync(LANGUAGE_PREFERENCE_KEY);
  } else {
    await SecureStore.setItemAsync(LANGUAGE_PREFERENCE_KEY, preference);
  }
  try {
    await Updates.reloadAsync();
  } catch {
    // Development builds run without expo-updates; the dev reload does the same job.
    DevSettings.reload();
  }
}
