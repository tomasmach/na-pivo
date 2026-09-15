/**
 * Change the UI language. Strings are bound once at launch (see index.ts), so
 * the switch persists the choice and restarts the JS bundle; the app comes
 * back on the compass in the new language.
 */

import { DevSettings } from 'react-native';
import * as Updates from 'expo-updates';

import { locale, type Locale } from './index';
import { writeStoredLocale } from './locale';

/** Returns false when the choice could not be stored; the caller shows an error. */
export async function switchLocale(next: Locale): Promise<boolean> {
  if (next === locale) return true;
  try {
    writeStoredLocale(next);
  } catch {
    return false;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    // Development builds without expo-updates fall back to the dev reload.
    DevSettings.reload();
  }
  return true;
}
