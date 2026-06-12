import { czechPluralForm, czechPlural, beerNoun, beerCountLabel } from '../plural';

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
