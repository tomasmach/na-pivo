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


/** English volume: 500 → "0.5 l", 330 → "0.33 l", 1000 → "1 l" (decimal point). */
export function formatVolume(ml: number): string {
  const text = String(Number((ml / 1000).toFixed(3)));
  return `${text} l`;
}
