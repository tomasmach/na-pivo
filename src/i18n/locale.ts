/**
 * Which UI language the app runs in. The choice lives in the settings screen
 * and is read synchronously at launch, before any screen renders, so every
 * module-level string constant already speaks the right language.
 */

import * as SecureStore from 'expo-secure-store';

export type Locale = 'cs' | 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['cs', 'en'];
export const DEFAULT_LOCALE: Locale = 'cs';

/** Secure store is the only synchronous persisted storage in the app. */
const STORAGE_KEY = 'na-pivo-locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Pure resolver so tests can drive it without storage. */
export function resolveLocale(stored: unknown): Locale {
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

/** Readable before the first unlock too: reminder notifications build their text from `t`. */
const STORE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export function readStoredLocale(): Locale {
  try {
    return resolveLocale(SecureStore.getItem(STORAGE_KEY, STORE_OPTIONS));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function writeStoredLocale(locale: Locale): void {
  SecureStore.setItem(STORAGE_KEY, locale, STORE_OPTIONS);
}

/** BCP 47 tag for Intl formatting that matches the UI language. */
export function intlLocaleFor(locale: Locale): string {
  return locale === 'cs' ? 'cs-CZ' : 'en-GB';
}
