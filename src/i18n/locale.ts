/**
 * Which UI language the app runs in. Decided once at launch from the device's
 * preferred languages: Czech and Slovak readers get Czech (the Slovak store
 * has always shipped the Czech copy), everyone else gets English.
 */

export type Locale = 'cs' | 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['cs', 'en'];

/** Pure resolver so tests can drive it without expo-localization. */
export function resolveLocale(languageCodes: readonly (string | null | undefined)[]): Locale {
  for (const code of languageCodes) {
    const lang = (code ?? '').toLowerCase().split(/[-_]/)[0];
    if (lang === 'cs' || lang === 'sk') return 'cs';
    if (lang === 'en') return 'en';
  }
  return 'en';
}

/** BCP 47 tag for Intl formatting that matches the UI language. */
export function intlLocaleFor(locale: Locale): string {
  return locale === 'cs' ? 'cs-CZ' : 'en-GB';
}
