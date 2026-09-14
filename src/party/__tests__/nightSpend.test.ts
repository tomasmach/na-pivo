import { emptyNight, nightSpend, type NightDrink, type NightRecord } from '../nightRecord';

const ME = 'me';
const THEM = 'them';

function drink(by: string, priceCzk?: number, beerName = 'Plzeň'): NightDrink {
  return {
    id: `${by}:${beerName}:${priceCzk ?? 'x'}:${Math.random()}`,
    at: '2026-09-05T20:00:00.000Z',
    by,
    beerName,
    drinkType: 'beer',
    stopId: null,
    ...(priceCzk !== undefined ? { priceCzk } : {}),
  };
}

function night(drinks: NightDrink[]): NightRecord {
  return { ...emptyNight('n1', '2026-09-05T18:00:00.000Z'), drinks };
}

describe('nightSpend', () => {
  it('adds up only my own priced drinks', () => {
    const spend = nightSpend(night([drink(ME, 60), drink(ME, 55), drink(THEM, 90)]), ME);

    expect(spend).toEqual({ czk: 115, priced: 2, total: 2, topName: 'Plzeň', topCzk: 60 });
  });

  it('reports how many of my drinks carried a price', () => {
    const spend = nightSpend(night([drink(ME, 60), drink(ME), drink(ME)]), ME);

    expect(spend?.czk).toBe(60);
    expect(spend?.priced).toBe(1);
    expect(spend?.total).toBe(3);
  });

  it('returns null when nothing carried a price, rather than a confident zero', () => {
    expect(nightSpend(night([drink(ME), drink(ME)]), ME)).toBeNull();
  });

  it('still adds up the receipt before the roster has resolved', () => {
    // A priced row can only have come from this phone, so no id is needed.
    expect(nightSpend(night([drink(ME, 60), drink(THEM)]))?.czk).toBe(60);
  });

  it('names the priciest drink I paid for', () => {
    const spend = nightSpend(
      night([drink(ME, 45, 'Radegast'), drink(ME, 89, 'Matuška Raptor'), drink(ME, 60, 'Plzeň')]),
      ME,
    );

    expect(spend?.topName).toBe('Matuška Raptor');
    expect(spend?.topCzk).toBe(89);
  });

  it('ignores a zero or negative price instead of counting it as priced', () => {
    expect(nightSpend(night([drink(ME, 0)]), ME)).toBeNull();
  });

  it('counts nothing when only unpriced rows are left', () => {
    expect(nightSpend(night([drink(THEM)]))).toBeNull();
  });
});
