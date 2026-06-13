import {
  formatPrice,
  formatPriceInputFromCzk,
  parsePriceInputToCzk,
  pricePlaceholder,
  sanitizePriceInput,
} from '../currency';

describe('currency helpers', () => {
  it('formats CZK prices as whole crowns', () => {
    expect(formatPrice(62, 'CZK')).toBe('62 Kč');
    expect(pricePlaceholder('CZK')).toBe('Cena (Kč)');
  });

  it('formats EUR prices from canonical CZK values', () => {
    expect(formatPrice(75, 'EUR')).toBe('3 €');
    expect(formatPrice(62, 'EUR')).toBe('2,48 €');
    expect(formatPriceInputFromCzk(65, 'EUR')).toBe('2,6');
    expect(pricePlaceholder('EUR')).toBe('Cena (€)');
  });

  it('sanitizes currency inputs according to selected currency', () => {
    expect(sanitizePriceInput('62 Kč', 'CZK')).toBe('62');
    expect(sanitizePriceInput('3.50 €', 'EUR')).toBe('3,50');
    expect(sanitizePriceInput(',5', 'EUR')).toBe('0,5');
  });

  it('parses typed prices back to canonical CZK', () => {
    expect(parsePriceInputToCzk('62', 'CZK')).toBe(62);
    expect(parsePriceInputToCzk('2,60', 'EUR')).toBe(65);
    expect(parsePriceInputToCzk('0', 'EUR')).toBeNull();
    expect(parsePriceInputToCzk('100', 'EUR')).toBeNull();
  });
});
