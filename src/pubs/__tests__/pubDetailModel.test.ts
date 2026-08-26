import type { WeeklyHours } from '@/data/communityHours';
import { buildOpeningHoursRows, resolveDetailBeers } from '@/pubs/pubDetailModel';

const HOURS: WeeklyHours = {
  mo: [['11:00', '23:00']],
  tu: [['11:00', '23:00']],
  we: [['11:00', '23:00']],
  th: [['11:00', '23:00']],
  fr: [['11:00', '01:00']],
  sa: [['11:00', '01:00']],
  su: [],
};

describe('pubDetailModel', () => {
  it('groups consecutive days with identical opening hours', () => {
    expect(buildOpeningHoursRows(HOURS, null, 'Zavřeno')).toEqual([
      { days: 'Po-Čt', hours: '11:00-23:00' },
      { days: 'Pá-So', hours: '11:00-01:00' },
      { days: 'Ne', hours: 'Zavřeno' },
    ]);
  });

  it('falls back to the raw opening-hours value when it cannot parse it', () => {
    expect(buildOpeningHoursRows(null, 'Po domluvě', 'Zavřeno')).toEqual([
      { days: '', hours: 'Po domluvě' },
    ]);
  });

  it('uses a fresh local beer edit before the server list', () => {
    expect(
      resolveDetailBeers(
        {
          beers: [{ name: 'Server', priceCzk: 60 }],
          beersUpdatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          beers: [{ name: 'Lokální', priceCzk: 55, volumeMl: 500 }],
          updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
        },
      ),
    ).toEqual([{ name: 'Lokální', priceCzk: 55, volumeMl: 500 }]);
  });

  it('lets a newer server list replace an old local edit', () => {
    expect(
      resolveDetailBeers(
        {
          beers: [{ name: 'Server', priceCzk: 60 }],
          beersUpdatedAt: '2026-01-03T00:00:00.000Z',
        },
        {
          beers: [{ name: 'Staré lokální' }],
          updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
        },
      ),
    ).toEqual([{ name: 'Server', priceCzk: 60 }]);
  });
});
