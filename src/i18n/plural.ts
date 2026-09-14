/**
 * Czech pluralization helpers. Czech has three grammatical number forms:
 *   - 1            → singular        ("1 pivo")
 *   - 2, 3, 4      → "few" / paucal  ("3 piva")
 *   - 0, 5, 6, …   → "many" / plural ("5 piv")
 *
 * (The genitive-plural "piv" is also used for 0.) These helpers are pure so the
 * UI and tests can rely on them without pulling in any locale machinery.
 */

export type CzechPluralForm = 'one' | 'few' | 'many';

/** Pick the Czech plural form for a non-negative integer count. */
export function czechPluralForm(count: number): CzechPluralForm {
  const n = Math.abs(Math.trunc(count));
  if (n === 1) return 'one';
  if (n >= 2 && n <= 4) return 'few';
  return 'many';
}

/** Choose among three Czech forms by count. */
export function czechPlural(
  count: number,
  forms: { one: string; few: string; many: string },
): string {
  return forms[czechPluralForm(count)];
}

/** "1 pivo" / "3 piva" / "5 piv" — the noun for counted beers. */
export function beerNoun(count: number): string {
  return czechPlural(count, { one: 'pivo', few: 'piva', many: 'piv' });
}

/** "1 pivo", "3 piva", "5 piv" — count + correctly-declined noun. */
export function beerCountLabel(count: number): string {
  return `${count} ${beerNoun(count)}`;
}

/** "1 člověk" / "3 lidi" / "5 lidí" — counted people, for community confidence. */
export function peopleCountLabel(count: number): string {
  return `${count} ${czechPlural(count, { one: 'člověk', few: 'lidi', many: 'lidí' })}`;
}

/** "1 hospoda" / "3 hospody" / "5 hospod". */
export function pubCountLabel(count: number): string {
  return `${count} ${czechPlural(count, { one: 'hospoda', few: 'hospody', many: 'hospod' })}`;
}

/** "1 hra" / "3 hry" / "5 her". */
export function gameCountLabel(count: number): string {
  return `${count} ${czechPlural(count, { one: 'hra', few: 'hry', many: 'her' })}`;
}

export function softDrinkCountLabel(count: number): string {
  return `${count} nealko`;
}

export function shotCountLabel(count: number): string {
  return `${count} ${czechPlural(count, { one: 'panák', few: 'panáky', many: 'panáků' })}`;
}

/** "1 víno", "3 vína", "5 vín" — counted glasses, pub-order style. */
export function wineCountLabel(count: number): string {
  return `${count} ${czechPlural(count, { one: 'víno', few: 'vína', many: 'vín' })}`;
}
