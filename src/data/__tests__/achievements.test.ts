import { parseBadgeProgress } from '@/data/achievements';

describe('parseBadgeProgress', () => {
  it('reads server values and keeps only valid weekday and month slots', () => {
    const progress = parseBadgeProgress({
      beers: 123,
      distinct_pubs: 31,
      best_week_streak: 9,
      beer_weekdays: [0, 2, 6, 7, -1, 2.5, '3'],
      beer_months: [0, 1, 12, 13],
      christmas_eves: 2,
    });

    expect(progress.beers).toBe(123);
    expect(progress.distinctPubs).toBe(31);
    expect(progress.bestWeekStreak).toBe(9);
    expect(progress.beerWeekdays).toEqual([0, 2, 6]);
    expect(progress.beerMonths).toEqual([1, 12]);
    expect(progress.christmasEves).toBe(2);
  });

  it('reads missing or malformed values as zero, like a friend profile without private values', () => {
    const progress = parseBadgeProgress({ beers: -4, ratings: 'many', friends: Number.NaN });

    expect(progress.beers).toBe(0);
    expect(progress.ratings).toBe(0);
    expect(progress.friends).toBe(0);
    expect(progress.lunchBeers).toBe(0);
    expect(progress.beerWeekdays).toEqual([]);
  });
});
