import { firstDrinkLabel, profileRecords, profileSeries } from '@/profile/profileStats';
import type { RemoteStats } from '@/data/statsClient';

const STATS: RemoteStats = {
  totalBeers: 7,
  totalEvenings: 3,
  distinctPubs: 2,
  totalSpentCzk: 999,
  firstDrinkAt: '2026-01-15T19:00:00Z',
  topPubs: [],
  records: {
    mostBeersInEvening: 5,
    mostBeersPubName: 'U Tygra',
    mostBeersDate: '2026-01-15',
    fastestBeerSeconds: null,
    longestEveningSeconds: 3900,
  },
  periods: { timezone: 'Europe/Prague', months: [], years: [] },
  timeline: {
    days: [
      {
        period: '2026-08-05',
        beers: 2,
        evenings: 1,
        distinctPubs: 1,
        longestEveningSeconds: 1800,
      },
      {
        period: '2026-08-06',
        beers: 0,
        evenings: 0,
        distinctPubs: 0,
        longestEveningSeconds: null,
      },
    ],
    weeks: [],
    months: [],
    streak: { currentWeeks: 2, bestWeeks: 4 },
    windows: {
      week: { beers: 2, evenings: 1, distinctPubs: 1, longestEveningSeconds: 1800 },
      month: { beers: 7, evenings: 3, distinctPubs: 2, longestEveningSeconds: 3900 },
      year: { beers: 7, evenings: 3, distinctPubs: 2, longestEveningSeconds: 3900 },
    },
  },
};

describe('profileStats', () => {
  it('keeps zero server buckets in the weekly chart and uses exact window totals', () => {
    const series = profileSeries(STATS, 'Týden');
    expect(series.points.map((point) => point.value)).toEqual([2, 0]);
    expect(series.totals.map((item) => item.value)).toEqual(['2', '1', '1', '30 min']);
  });

  it('only exposes records the backend actually supplied', () => {
    expect(profileRecords(STATS).map((record) => record.id)).toEqual([
      'longest-evening',
      'most-beers',
    ]);
    expect(profileRecords(null)).toEqual([]);
  });

  it('formats the first durable diary entry without inventing an account date', () => {
    expect(firstDrinkLabel(null)).toBe('Zatím bez zápisu');
    expect(firstDrinkLabel(STATS.firstDrinkAt)).toContain('2026');
  });
});
