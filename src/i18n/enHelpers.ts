/**
 * English counterparts of the Czech helpers in plural.ts. English has only two
 * forms (one / other), so these stay tiny and pure like the Czech ones.
 */

export function englishPlural(count: number, forms: { one: string; other: string }): string {
  return Math.abs(Math.trunc(count)) === 1 ? forms.one : forms.other;
}

/** "1 beer" / "3 beers". */
export function beerNoun(count: number): string {
  return englishPlural(count, { one: 'beer', other: 'beers' });
}

export function beerCountLabel(count: number): string {
  return `${count} ${beerNoun(count)}`;
}

/** "1 person" / "3 people". */
export function peopleCountLabel(count: number): string {
  return `${count} ${englishPlural(count, { one: 'person', other: 'people' })}`;
}

/** "1 pub" / "3 pubs". */
export function pubCountLabel(count: number): string {
  return `${count} ${englishPlural(count, { one: 'pub', other: 'pubs' })}`;
}

/** "1 game" / "3 games". */
export function gameCountLabel(count: number): string {
  return `${count} ${englishPlural(count, { one: 'game', other: 'games' })}`;
}

export function softDrinkCountLabel(count: number): string {
  return `${count} ${englishPlural(count, { one: 'soft drink', other: 'soft drinks' })}`;
}

export function shotCountLabel(count: number): string {
  return `${count} ${englishPlural(count, { one: 'shot', other: 'shots' })}`;
}

export function wineCountLabel(count: number): string {
  return `${count} ${englishPlural(count, { one: 'wine', other: 'wines' })}`;
}

/** English volume: 500 → "0.5 l", 330 → "0.33 l", 1000 → "1 l" (decimal point). */
export function formatVolume(ml: number): string {
  const litres = ml / 1000;
  const text = Number.isInteger(litres)
    ? String(litres)
    : litres.toFixed(litres * 100 % 10 === 0 ? 1 : 2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text} l`;
}
