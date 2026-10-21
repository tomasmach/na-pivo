import {
  EMPTY_ACHIEVEMENTS,
  parseAchievementsBlock,
  parseBadgeProgress,
  type AccountAchievements,
} from '@/data/achievements';
import {
  EMPTY_ACHIEVEMENTS as AUTH_EMPTY_ACHIEVEMENTS,
  parseAchievementsBlock as parseAuthAchievementsBlock,
} from '@/data/auth';

const ALL_UNLOCKED: AccountAchievements = {
  firstTen: true,
  regular: true,
  reviewer: true,
  firstMap: true,
  explorer: true,
  cartographer: true,
  completionist: true,
  factMachine: true,
  firstBeer: true,
  century: true,
  pilgrim: true,
  stamgast: true,
  nightOwl: true,
  taster: true,
  partyAnimal: true,
  fotoPivar: true,
  chatar: true,
  podSirakem: true,
  lahvacovyFilozof: true,
  plechovkac: true,
};

describe('parseAchievementsBlock', () => {
  it('maps every backend field to the public camelCase shape', () => {
    expect(
      parseAchievementsBlock({
        first_ten: true,
        regular: true,
        reviewer: true,
        first_map: true,
        explorer: true,
        cartographer: true,
        completionist: true,
        fact_machine: true,
        first_beer: true,
        century: true,
        pilgrim: true,
        stamgast: true,
        night_owl: true,
        taster: true,
        party_animal: true,
        foto_pivar: true,
        chatar: true,
        pod_sirakem: true,
        lahvacovy_filozof: true,
        plechovkac: true,
      }),
    ).toEqual(ALL_UNLOCKED);
  });

  it('keeps missing and non-true values locked', () => {
    expect(
      parseAchievementsBlock({
        first_ten: false,
        regular: undefined,
        reviewer: 1 as unknown as boolean,
      }),
    ).toEqual(EMPTY_ACHIEVEMENTS);
  });

  it('keeps the auth module re-exports compatible', () => {
    expect(AUTH_EMPTY_ACHIEVEMENTS).toBe(EMPTY_ACHIEVEMENTS);
    expect(parseAuthAchievementsBlock({ first_ten: true })).toEqual({
      ...EMPTY_ACHIEVEMENTS,
      firstTen: true,
    });
  });
});

describe('EMPTY_ACHIEVEMENTS', () => {
  it('contains every parser key locked by default', () => {
    expect(Object.keys(EMPTY_ACHIEVEMENTS).sort()).toEqual(Object.keys(ALL_UNLOCKED).sort());
    expect(Object.values(EMPTY_ACHIEVEMENTS).every((value) => value === false)).toBe(true);
  });
});

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
