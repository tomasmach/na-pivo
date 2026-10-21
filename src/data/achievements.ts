/** Raw values behind the badge collection. The server sends values only; the
 *  app owns the tier thresholds. Missing values (older backends, or private
 *  ones on someone else's profile) read as zero. */
export interface BadgeProgress {
  beers: number;
  distinctPubs: number;
  maxPubVisits: number;
  distinctBeers: number;
  distinctCities: number;
  bestWeekStreak: number;
  ratings: number;
  friends: number;
  mappedPubs: number;
  firstMappedPubs: number;
  completedPubs: number;
  facts: number;
  photos: number;
  contestWins: number;
  softDrinks: number;
  /** 0 = Monday … 6 = Sunday, by drinking day. */
  beerWeekdays: number[];
  /** 1 = January … 12 = December, by drinking day. */
  beerMonths: number[];
  outsidePubDrinks: number;
  outdoorsDrinks: number;
  bottledBeers: number;
  cannedBeers: number;
  afterMidnightDrinks: number;
  lunchBeers: number;
  christmasEves: number;
  newYearsEves: number;
  beerDayFridays: number;
}

export type RawBadgeProgress = Record<string, unknown>;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function slots(value: unknown, min: number, max: number): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((slot): slot is number => Number.isInteger(slot) && slot >= min && slot <= max);
}

export function parseBadgeProgress(raw: RawBadgeProgress): BadgeProgress {
  return {
    beers: count(raw.beers),
    distinctPubs: count(raw.distinct_pubs),
    maxPubVisits: count(raw.max_pub_visits),
    distinctBeers: count(raw.distinct_beers),
    distinctCities: count(raw.distinct_cities),
    bestWeekStreak: count(raw.best_week_streak),
    ratings: count(raw.ratings),
    friends: count(raw.friends),
    mappedPubs: count(raw.mapped_pubs),
    firstMappedPubs: count(raw.first_mapped_pubs),
    completedPubs: count(raw.completed_pubs),
    facts: count(raw.facts),
    photos: count(raw.photos),
    contestWins: count(raw.contest_wins),
    softDrinks: count(raw.soft_drinks),
    beerWeekdays: slots(raw.beer_weekdays, 0, 6),
    beerMonths: slots(raw.beer_months, 1, 12),
    outsidePubDrinks: count(raw.outside_pub_drinks),
    outdoorsDrinks: count(raw.outdoors_drinks),
    bottledBeers: count(raw.bottled_beers),
    cannedBeers: count(raw.canned_beers),
    afterMidnightDrinks: count(raw.after_midnight_drinks),
    lunchBeers: count(raw.lunch_beers),
    christmasEves: count(raw.christmas_eves),
    newYearsEves: count(raw.new_years_eves),
    beerDayFridays: count(raw.beer_day_fridays),
  };
}
