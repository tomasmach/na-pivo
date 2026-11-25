import { parsePriceInputToCzk } from '../currency';

describe('currency helpers', () => {

  it('parses typed prices back to canonical CZK', () => {
    expect(parsePriceInputToCzk('62', 'CZK')).toBe(62);
    expect(parsePriceInputToCzk('2,60', 'EUR')).toBe(65);
    expect(parsePriceInputToCzk('0', 'EUR')).toBeNull();
    expect(parsePriceInputToCzk('100', 'EUR')).toBeNull();
  });
});
