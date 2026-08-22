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
    longestEveningPubName: 'U Tygra',
    longestEveningDate: '2026-01-15',
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
  totalNights: 2,
  nightRecords: {
    mostBeers: 7,
    longestSeconds: 14_400,
    mostStops: 2,
    mostBeersDate: '2026-01-15',
    mostBeersPubNames: ['U Tygra', 'Lokál'],
    longestDate: '2026-01-15',
    longestPubNames: ['U Tygra', 'Lokál'],
  },
  nightTimeline: {
    days: [
      {
        period: '2026-08-05',
        beers: 2,
        evenings: 1,
        distinctPubs: 2,
        longestEveningSeconds: 14_400,
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
    streak: { currentWeeks: 1, bestWeeks: 3 },
    windows: {
      week: { beers: 2, evenings: 1, distinctPubs: 2, longestEveningSeconds: 14_400 },
      month: { beers: 7, evenings: 2, distinctPubs: 2, longestEveningSeconds: 14_400 },
      year: { beers: 7, evenings: 2, distinctPubs: 2, longestEveningSeconds: 14_400 },
    },
  },
};

describe('profileStats', () => {
  it('keeps zero server buckets in the weekly chart and uses exact window totals', () => {
    const series = profileSeries(STATS, 'Týden');
    expect(series.points.map((point) => point.value)).toEqual([2, 0]);
    expect(series.totals.map((item) => item.value)).toEqual(['2', '1', '2', '4 h']);
  });

  it('only exposes records the backend actually supplied', () => {
    expect(profileRecords(STATS).map((record) => record.id)).toEqual(['longest-evening']);
    expect(profileRecords(STATS)[0]).toMatchObject({ value: '4 h' });
    expect(profileRecords(STATS)[0].when).toContain('U Tygra → Lokál');
    expect(profileRecords(STATS)[0].title).toBe('Délka zaznamenaného večera');
    expect(profileRecords(null)).toEqual([]);
  });

  it('keeps record copy free of superlative framing', () => {
    const legacy = { ...STATS, nightTimeline: undefined, nightRecords: undefined };
    const json = JSON.stringify(profileRecords(STATS)).toLowerCase() + JSON.stringify(profileRecords(legacy)).toLowerCase();
    for (const fragment of [
      'nejvíc piv',
      'nejdelší večer',
      'rekord',
      'série',
      'streak',
      'nejrychlejší',
    ]) {
      expect(json).not.toContain(fragment);
    }
  });

  it('falls back to the released per-pub timeline and records on an older backend', () => {
    const legacy = { ...STATS, nightTimeline: undefined, nightRecords: undefined };

    expect(profileSeries(legacy, 'Týden').totals.map((item) => item.value)).toEqual([
      '2',
      '1',
      '1',
      '30 min',
    ]);
    expect(profileRecords(legacy)[0]).toMatchObject({ value: '1 h 5 min' });
    expect(profileRecords(legacy)[0].when).toContain('U Tygra');
  });

  it('formats the first durable diary entry without inventing an account date', () => {
    expect(firstDrinkLabel(null)).toBe('Zatím bez zápisu');
    expect(firstDrinkLabel(STATS.firstDrinkAt)).toContain('2026');
  });
});
