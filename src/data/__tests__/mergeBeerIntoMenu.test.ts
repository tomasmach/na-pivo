import { mergeBeerIntoMenu, normalizeBeerName, MAX_MENU_BEERS, type CommunityBeer } from '../communityHours';

describe('normalizeBeerName', () => {
  it('trims and casefolds', () => {
    expect(normalizeBeerName('  Pilsner Urquell  ')).toBe('pilsner urquell');
    expect(normalizeBeerName('PLZEŇ')).toBe('plzeň');
  });
});

describe('mergeBeerIntoMenu', () => {
  it('appends a new beer to an empty menu', () => {
    const result = mergeBeerIntoMenu([], { name: 'Plzeň', priceCzk: 62, volumeMl: 500 });
    expect(result).toEqual([{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }]);
  });

  it('updates the price of an existing beer with the same name + volume', () => {
    const menu: CommunityBeer[] = [{ name: 'Plzeň', priceCzk: 60, volumeMl: 500 }];
    const result = mergeBeerIntoMenu(menu, { name: ' plzeň ', priceCzk: 65, volumeMl: 500 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'Plzeň', priceCzk: 65, volumeMl: 500 });
  });

  it('treats different volumes as distinct beers (separate rows)', () => {
    const menu: CommunityBeer[] = [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }];
    const result = mergeBeerIntoMenu(menu, { name: 'Plzeň', priceCzk: 45, volumeMl: 300 });
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ name: 'Plzeň', priceCzk: 62, volumeMl: 500 });
    expect(result).toContainEqual({ name: 'Plzeň', priceCzk: 45, volumeMl: 300 });
  });

  it('treats a missing volume as its own bucket', () => {
    const menu: CommunityBeer[] = [{ name: 'Kozel', priceCzk: 40 }];
    const updated = mergeBeerIntoMenu(menu, { name: 'Kozel', priceCzk: 44 });
    expect(updated).toEqual([{ name: 'Kozel', priceCzk: 44 }]);

    const withVolume = mergeBeerIntoMenu(menu, { name: 'Kozel', priceCzk: 44, volumeMl: 500 });
    expect(withVolume).toHaveLength(2);
  });

  it('does not mutate the input menu', () => {
    const menu: CommunityBeer[] = [{ name: 'Plzeň', priceCzk: 60, volumeMl: 500 }];
    const snapshot = JSON.parse(JSON.stringify(menu));
    mergeBeerIntoMenu(menu, { name: 'Plzeň', priceCzk: 99, volumeMl: 500 });
    expect(menu).toEqual(snapshot);
  });

  it('appends until the cap (12) and then skips additional new beers', () => {
    const full: CommunityBeer[] = Array.from({ length: MAX_MENU_BEERS }, (_, i) => ({
      name: `Beer ${i}`,
      priceCzk: 50 + i,
      volumeMl: 500,
    }));
    expect(full).toHaveLength(12);

    const result = mergeBeerIntoMenu(full, { name: 'Trnáctý', priceCzk: 70, volumeMl: 500 });
    expect(result).toHaveLength(12);
    expect(result.some((b) => b.name === 'Trnáctý')).toBe(false);
  });

  it('still updates an existing beer price even when the menu is full', () => {
    const full: CommunityBeer[] = Array.from({ length: MAX_MENU_BEERS }, (_, i) => ({
      name: `Beer ${i}`,
      priceCzk: 50,
      volumeMl: 500,
    }));
    const result = mergeBeerIntoMenu(full, { name: 'Beer 3', priceCzk: 99, volumeMl: 500 });
    expect(result).toHaveLength(12);
    expect(result.find((b) => b.name === 'Beer 3')?.priceCzk).toBe(99);
  });
});
