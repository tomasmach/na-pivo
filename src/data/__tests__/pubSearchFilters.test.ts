import {
  MAX_AMENITY_FILTERS,
  PRICE_FILTER_MAX_CZK,
  activePubSearchFilterCount,
  backendPubSearchFilterKey,
  normalizeAmenityFilterKeys,
  normalizePubSearchFilters,
  pubMatchesPriceFilter,
  pubSearchFilterKey,
} from '../pubSearchFilters';

describe('pub search filters', () => {
  it('deduplicates and orders amenity keys by the bundled catalogue', () => {
    expect(normalizeAmenityFilterKeys(['game_foosball', 'payment_card', 'game_foosball'])).toEqual([
      'payment_card',
      'game_foosball',
    ]);
  });

  it('caps filters to the server-supported maximum', () => {
    expect(
      normalizeAmenityFilterKeys([
        'payment_card',
        'seating_garden',
        'seating_barrier_free',
        'game_darts',
        'game_billiards',
        'game_foosball',
      ]),
    ).toHaveLength(MAX_AMENITY_FILTERS);
  });

  it('builds an order-independent request identity and count', () => {
    const filters = {
      beerBrand: { key: 'pilsner-urquell', label: 'Pilsner Urquell' },
      amenityKeys: ['game_foosball', 'payment_card'] as const,
      priceMinCzk: null,
      priceMaxCzk: null,
    };
    expect(pubSearchFilterKey({ ...filters, amenityKeys: [...filters.amenityKeys] })).toBe(
      'pilsner-urquell|payment_card,game_foosball||:',
    );
    expect(activePubSearchFilterCount({ ...filters, amenityKeys: [...filters.amenityKeys] })).toBe(3);
  });

  it('counts the price range as one active filter and keys both boundaries', () => {
    const filters = { beerBrand: null, amenityKeys: [], priceMinCzk: 35, priceMaxCzk: 45 };
    expect(pubSearchFilterKey(filters)).toBe('|||35:45');
    expect(activePubSearchFilterCount(filters)).toBe(1);
  });

  it('keeps the price range OUT of the backend request identity', () => {
    const ranged = { beerBrand: null, amenityKeys: [], priceMinCzk: 35, priceMaxCzk: 45 };
    const open = { beerBrand: null, amenityKeys: [], priceMinCzk: null, priceMaxCzk: null };
    expect(backendPubSearchFilterKey(ranged)).toBe(backendPubSearchFilterKey(open));
  });

  it('treats other tap places as one explicit backend filter', () => {
    const filters = {
      beerBrand: null,
      amenityKeys: [],
      includeOtherPlaces: true,
      priceMinCzk: null,
      priceMaxCzk: null,
    };
    expect(backendPubSearchFilterKey(filters)).toBe('||other|:');
    expect(activePubSearchFilterCount(filters)).toBe(1);
  });

  it('normalizes an at-ceiling price cap to "no limit"', () => {
    expect(
      normalizePubSearchFilters({
        beerBrand: null,
        amenityKeys: [],
        priceMinCzk: null,
        priceMaxCzk: PRICE_FILTER_MAX_CZK,
      }).priceMaxCzk,
    ).toBeNull();
  });

  it('normalizes the slider floor to an open lower boundary', () => {
    expect(
      normalizePubSearchFilters({
        beerBrand: null,
        amenityKeys: [],
        priceMinCzk: 30,
        priceMaxCzk: null,
      }).priceMinCzk,
    ).toBeNull();
  });

  it('excludes pubs outside an active range and rejects unknown prices', () => {
    const now = Date.parse('2026-07-17T12:00:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const priced = { price: { czk: 42, observedAt: '2026-07-01T12:00:00Z' } };
    const expired = { price: { czk: 40, observedAt: '2025-07-01T12:00:00Z' } };
    const unknown = { price: null };
    expect(pubMatchesPriceFilter(priced, 40, 45)).toBe(true);
    expect(pubMatchesPriceFilter(priced, 43, 50)).toBe(false);
    expect(pubMatchesPriceFilter(priced, null, 40)).toBe(false);
    expect(pubMatchesPriceFilter(expired, 35, 45)).toBe(false);
    expect(pubMatchesPriceFilter(unknown, 35, 45)).toBe(false);
    expect(pubMatchesPriceFilter(unknown, null, null)).toBe(true);
    jest.restoreAllMocks();
  });
});
