import {
  MAX_AMENITY_FILTERS,
  activePubSearchFilterCount,
  normalizeAmenityFilterKeys,
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
    };
    expect(pubSearchFilterKey({ ...filters, amenityKeys: [...filters.amenityKeys] })).toBe(
      'pilsner-urquell|payment_card,game_foosball',
    );
    expect(activePubSearchFilterCount({ ...filters, amenityKeys: [...filters.amenityKeys] })).toBe(3);
  });
});
