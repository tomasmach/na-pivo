export interface AccountAchievements {
  firstTen: boolean;
  regular: boolean;
  reviewer: boolean;
  /** Mapér badges (spec §5.3) — additive; absent on older backends → false. */
  firstMap: boolean;
  explorer: boolean;
  cartographer: boolean;
  completionist: boolean;
  factMachine: boolean;
  /** Diary/social badges (leaderboards wave) — additive; absent → false. */
  firstBeer: boolean;
  century: boolean;
  pilgrim: boolean;
  stamgast: boolean;
  nightOwl: boolean;
  taster: boolean;
  partyAnimal: boolean;
  /** "FotoPivař" — won a biweekly photo-contest round. Server-only; additive,
   *  absent on older backends → false. */
  fotoPivar: boolean;
  /** Pivař badges (outside-pub drinking wave) — additive; absent → false. */
  chatar: boolean;
  podSirakem: boolean;
  lahvacovyFilozof: boolean;
  plechovkac: boolean;
}

/** All-locked achievements — the fallback when no server block has arrived. */
export const EMPTY_ACHIEVEMENTS: AccountAchievements = {
  firstTen: false,
  regular: false,
  reviewer: false,
  firstMap: false,
  explorer: false,
  cartographer: false,
  completionist: false,
  factMachine: false,
  firstBeer: false,
  century: false,
  pilgrim: false,
  stamgast: false,
  nightOwl: false,
  taster: false,
  partyAnimal: false,
  fotoPivar: false,
  chatar: false,
  podSirakem: false,
  lahvacovyFilozof: false,
  plechovkac: false,
};

/** Raw snake_case achievements block as sent by the backend. */
export interface RawAchievementsBlock {
  first_ten?: boolean;
  regular?: boolean;
  reviewer?: boolean;
  first_map?: boolean;
  explorer?: boolean;
  cartographer?: boolean;
  completionist?: boolean;
  fact_machine?: boolean;
  first_beer?: boolean;
  century?: boolean;
  pilgrim?: boolean;
  stamgast?: boolean;
  night_owl?: boolean;
  taster?: boolean;
  party_animal?: boolean;
  foto_pivar?: boolean;
  chatar?: boolean;
  pod_sirakem?: boolean;
  lahvacovy_filozof?: boolean;
  plechovkac?: boolean;
}

/** Parse additive achievements while keeping older backend payloads compatible. */
export function parseAchievementsBlock(raw: RawAchievementsBlock): AccountAchievements {
  return {
    firstTen: raw.first_ten === true,
    regular: raw.regular === true,
    reviewer: raw.reviewer === true,
    firstMap: raw.first_map === true,
    explorer: raw.explorer === true,
    cartographer: raw.cartographer === true,
    completionist: raw.completionist === true,
    factMachine: raw.fact_machine === true,
    firstBeer: raw.first_beer === true,
    century: raw.century === true,
    pilgrim: raw.pilgrim === true,
    stamgast: raw.stamgast === true,
    nightOwl: raw.night_owl === true,
    taster: raw.taster === true,
    partyAnimal: raw.party_animal === true,
    fotoPivar: raw.foto_pivar === true,
    chatar: raw.chatar === true,
    podSirakem: raw.pod_sirakem === true,
    lahvacovyFilozof: raw.lahvacovy_filozof === true,
    plechovkac: raw.plechovkac === true,
  };
}

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
