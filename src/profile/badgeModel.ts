import type { AccountMapper, BadgeProgress } from '@/data/auth';

export type BadgeKey =
  | 'beers'
  | 'pubs'
  | 'regular'
  | 'tasted'
  | 'cities'
  | 'weeks'
  | 'ratings'
  | 'friends'
  | 'mapped'
  | 'firstMaps'
  | 'completed'
  | 'facts'
  | 'photos'
  | 'contest'
  | 'softDrinks'
  | 'weekdays'
  | 'months'
  | 'outsidePub'
  | 'outdoors'
  | 'bottles'
  | 'cans'
  | 'nightOwl'
  | 'lunch'
  | 'christmasEve'
  | 'newYearsEve'
  | 'beerDay';

export interface BadgeRule {
  key: BadgeKey;
  /** Ascending values that unlock level 1, 2, …; a one-off badge has one. */
  tiers: readonly number[];
  value: (progress: BadgeProgress) => number;
  /** Filled slots of a collection badge (weekdays 0–6, months 1–12). */
  slots?: (progress: BadgeProgress) => readonly number[];
}

const WEEKDAY_SLOTS = 7;
const MONTH_SLOTS = 12;

export const BADGE_RULES: readonly BadgeRule[] = [
  { key: 'beers', tiers: [1, 10, 100, 500], value: (p) => p.beers },
  { key: 'pubs', tiers: [5, 25, 50, 100], value: (p) => p.distinctPubs },
  { key: 'regular', tiers: [5, 10, 25, 50], value: (p) => p.maxPubVisits },
  { key: 'tasted', tiers: [10, 25, 50, 100], value: (p) => p.distinctBeers },
  { key: 'cities', tiers: [3, 10, 25], value: (p) => p.distinctCities },
  { key: 'weeks', tiers: [4, 12, 26, 52], value: (p) => p.bestWeekStreak },
  { key: 'ratings', tiers: [1, 10, 25, 50], value: (p) => p.ratings },
  { key: 'friends', tiers: [1, 5, 10, 20], value: (p) => p.friends },
  { key: 'mapped', tiers: [10, 25, 50, 100], value: (p) => p.mappedPubs },
  { key: 'firstMaps', tiers: [1, 5, 20], value: (p) => p.firstMappedPubs },
  { key: 'completed', tiers: [1, 5, 20], value: (p) => p.completedPubs },
  { key: 'facts', tiers: [25, 100, 500], value: (p) => p.facts },
  { key: 'photos', tiers: [1, 10, 50], value: (p) => p.photos },
  { key: 'contest', tiers: [1, 3, 10], value: (p) => p.contestWins },
  { key: 'softDrinks', tiers: [1, 10, 25], value: (p) => p.softDrinks },
  {
    key: 'weekdays',
    tiers: [WEEKDAY_SLOTS],
    value: (p) => p.beerWeekdays.length,
    slots: (p) => p.beerWeekdays,
  },
  {
    key: 'months',
    tiers: [MONTH_SLOTS],
    value: (p) => p.beerMonths.length,
    slots: (p) => p.beerMonths,
  },
  { key: 'outsidePub', tiers: [1], value: (p) => p.outsidePubDrinks },
  { key: 'outdoors', tiers: [1], value: (p) => p.outdoorsDrinks },
  { key: 'bottles', tiers: [25], value: (p) => p.bottledBeers },
  { key: 'cans', tiers: [25], value: (p) => p.cannedBeers },
  { key: 'nightOwl', tiers: [1], value: (p) => p.afterMidnightDrinks },
  { key: 'lunch', tiers: [1], value: (p) => p.lunchBeers },
  { key: 'christmasEve', tiers: [1], value: (p) => p.christmasEves },
  { key: 'newYearsEve', tiers: [1], value: (p) => p.newYearsEves },
  { key: 'beerDay', tiers: [1], value: (p) => p.beerDayFridays },
];

/** Badges another account may see; the server sends only their values. */
export const PUBLIC_BADGE_KEYS: ReadonlySet<BadgeKey> = new Set([
  'beers',
  'pubs',
  'mapped',
  'firstMaps',
  'completed',
  'facts',
  'contest',
]);

export interface BadgeState {
  key: BadgeKey;
  /** Levels reached, 0 when still locked. */
  tier: number;
  tiers: readonly number[];
  value: number;
  /** Value that unlocks the next level, null once every level is reached. */
  next: number | null;
  slots?: readonly number[];
}

export function badgeState(rule: BadgeRule, progress: BadgeProgress): BadgeState {
  const value = rule.value(progress);
  const tier = rule.tiers.filter((threshold) => value >= threshold).length;
  return {
    key: rule.key,
    tier,
    tiers: rule.tiers,
    value,
    next: rule.tiers[tier] ?? null,
    ...(rule.slots ? { slots: rule.slots(progress) } : {}),
  };
}

/** A mapping answer updates the Mapér counters before the next profile fetch. */
export function withMapperCounters(
  progress: BadgeProgress,
  mapper: AccountMapper | undefined,
): BadgeProgress {
  if (!mapper) return progress;
  return {
    ...progress,
    mappedPubs: Math.max(progress.mappedPubs, mapper.distinctMappedPubs),
    firstMappedPubs: Math.max(progress.firstMappedPubs, mapper.firstMapperCount),
    completedPubs: Math.max(progress.completedPubs, mapper.completedPubsCount),
    facts: Math.max(progress.facts, mapper.amenityVotesCount),
  };
}

export function badgeStates(progress: BadgeProgress): BadgeState[] {
  return BADGE_RULES.map((rule) => badgeState(rule, progress));
}
