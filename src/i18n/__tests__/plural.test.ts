import { czechPluralForm, czechPlural, beerNoun, beerCountLabel, gameCountLabel, pubCountLabel } from '../plural';
import { cs } from '../cs';

describe('czechPluralForm', () => {
  it('uses singular for 1', () => {
    expect(czechPluralForm(1)).toBe('one');
  });

  it('uses the few (paucal) form for 2–4', () => {
    expect(czechPluralForm(2)).toBe('few');
    expect(czechPluralForm(3)).toBe('few');
    expect(czechPluralForm(4)).toBe('few');
  });

  it('uses the many form for 0 and 5+', () => {
    expect(czechPluralForm(0)).toBe('many');
    expect(czechPluralForm(5)).toBe('many');
    expect(czechPluralForm(11)).toBe('many');
    expect(czechPluralForm(21)).toBe('many');
    expect(czechPluralForm(100)).toBe('many');
  });
});

describe.each([
  ['beer', beerCountLabel, ['0 piv', '1 pivo', '2 piva', '4 piva', '5 piv', '11 piv', '21 piv', '101 piv']],
  ['pub', pubCountLabel, ['0 hospod', '1 hospoda', '2 hospody', '4 hospody', '5 hospod', '11 hospod', '21 hospod', '101 hospod']],
  ['game', gameCountLabel, ['0 her', '1 hra', '2 hry', '4 hry', '5 her', '11 her', '21 her', '101 her']],
] as const)('%s count labels', (_name, formatter, expected) => {
  it('uses Czech forms including zero and compound counts', () => {
    expect([0, 1, 2, 4, 5, 11, 21, 101].map(formatter)).toEqual(expected);
  });
});

it.each([
  [0, 'týdnů v řadě', 'Nejlepší 0 týdnů'],
  [1, 'týden v řadě', 'Nejlepší 1 týden'],
  [2, 'týdny v řadě', 'Nejlepší 2 týdny'],
  [5, 'týdnů v řadě', 'Nejlepší 5 týdnů'],
] as const)('declines %s profile streak weeks', (count, unit, best) => {
  expect(cs.profile.streakUnit(count)).toBe(unit);
  expect(cs.profile.streakBest(count)).toBe(best);
});

describe('beerNoun / beerCountLabel', () => {
  it('declines pivo correctly across the three forms', () => {
    expect(beerNoun(1)).toBe('pivo');
    expect(beerNoun(2)).toBe('piva');
    expect(beerNoun(4)).toBe('piva');
    expect(beerNoun(5)).toBe('piv');
    expect(beerNoun(0)).toBe('piv');
  });

  it('formats a count + noun label', () => {
    expect(beerCountLabel(1)).toBe('1 pivo');
    expect(beerCountLabel(3)).toBe('3 piva');
    expect(beerCountLabel(7)).toBe('7 piv');
  });

  it('czechPlural picks the right custom form', () => {
    const forms = { one: 'A', few: 'B', many: 'C' };
    expect(czechPlural(1, forms)).toBe('A');
    expect(czechPlural(3, forms)).toBe('B');
    expect(czechPlural(8, forms)).toBe('C');
  });
});
