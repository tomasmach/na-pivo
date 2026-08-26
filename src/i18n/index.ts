/**
 * Public entry point for UI copy. Import `t` (never `cs` or `en` directly)
 * so every screen follows the device language picked in locale.ts.
 */

import { getLocales } from 'expo-localization';

import { cs, formatVolume as formatVolumeCs, type Strings } from './cs';
import { en } from './en';
import * as csCounts from './plural';
import * as enCounts from './enHelpers';
import { intlLocaleFor, resolveLocale, type Locale } from './locale';

export type { Locale, Strings };
export { resolveLocale } from './locale';

export const locale: Locale = resolveLocale(getLocales().map((l) => l.languageCode));

/** Pass to Intl.DateTimeFormat / toLocaleDateString instead of a literal 'cs-CZ'. */
export const intlLocale = intlLocaleFor(locale);

export const t: Strings = locale === 'en' ? en : cs;

const counts = locale === 'en' ? enCounts : csCounts;

export const formatVolume = locale === 'en' ? enCounts.formatVolume : formatVolumeCs;
export const beerNoun = counts.beerNoun;
export const beerCountLabel = counts.beerCountLabel;
export const peopleCountLabel = counts.peopleCountLabel;
export const pubCountLabel = counts.pubCountLabel;
export const gameCountLabel = counts.gameCountLabel;
export const softDrinkCountLabel = counts.softDrinkCountLabel;
export const shotCountLabel = counts.shotCountLabel;
export const wineCountLabel = counts.wineCountLabel;

/** Locale-aware "1 beer / 3 beers" style plural: give both language shapes. */
export function plural(
  count: number,
  forms: { cs: { one: string; few: string; many: string }; en: { one: string; other: string } },
): string {
  return locale === 'en' ? enCounts.englishPlural(count, forms.en) : csCounts.czechPlural(count, forms.cs);
}
