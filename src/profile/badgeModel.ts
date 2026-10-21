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

export const BADGE_GROUPS = ['pubs', 'rhythm', 'beer', 'social', 'mapping', 'moments'] as const;
export type BadgeGroup = (typeof BADGE_GROUPS)[number];

/** Tiered families grow a medal, collections fill slots, the rest unlock once. */
export type BadgeKind = 'tiered' | 'slots' | 'once';

export type BadgeHoliday = 'christmasEve' | 'newYearsEve' | 'beerDay';

export interface BadgeRule {
  key: BadgeKey;
  group: BadgeGroup;
  /** Ascending values that unlock level 1, 2, …; a one-off badge has one. */
  tiers: readonly number[];
  value: (progress: BadgeProgress) => number;
  /** Filled slots of a collection badge (weekdays 0–6, months 1–12). */
  slots?: (progress: BadgeProgress) => readonly number[];
  /** Counts how much, so it shows a plain total and is never a goal to chase. */
  volume?: boolean;
  /** Hidden until earned. */
  secret?: boolean;
  holiday?: BadgeHoliday;
}

const WEEKDAY_SLOTS = 7;
const MONTH_SLOTS = 12;

/** Display order: by group, then the way the collection reads within it. */
export const BADGE_RULES: readonly BadgeRule[] = [
  { key: 'pubs', group: 'pubs', tiers: [5, 25, 50, 100], value: (p) => p.distinctPubs },
  { key: 'regular', group: 'pubs', tiers: [5, 10, 25, 50], value: (p) => p.maxPubVisits },
  { key: 'cities', group: 'pubs', tiers: [3, 10, 25], value: (p) => p.distinctCities },
  { key: 'ratings', group: 'pubs', tiers: [1, 10, 25, 50], value: (p) => p.ratings },
  { key: 'weeks', group: 'rhythm', tiers: [4, 12, 26, 52], value: (p) => p.bestWeekStreak },
  {
    key: 'weekdays',
    group: 'rhythm',
    tiers: [WEEKDAY_SLOTS],
    value: (p) => p.beerWeekdays.length,
    slots: (p) => p.beerWeekdays,
  },
  {
    key: 'months',
    group: 'rhythm',
    tiers: [MONTH_SLOTS],
    value: (p) => p.beerMonths.length,
    slots: (p) => p.beerMonths,
  },
  { key: 'tasted', group: 'beer', tiers: [10, 25, 50, 100], value: (p) => p.distinctBeers },
  { key: 'softDrinks', group: 'beer', tiers: [1, 10, 25], value: (p) => p.softDrinks },
  { key: 'beers', group: 'beer', tiers: [1, 10, 100, 500], value: (p) => p.beers, volume: true },
  {
    key: 'bottles',
    group: 'beer',
    tiers: [25],
    value: (p) => p.bottledBeers,
    volume: true,
    secret: true,
  },
  { key: 'cans', group: 'beer', tiers: [25], value: (p) => p.cannedBeers, volume: true, secret: true },
  { key: 'friends', group: 'social', tiers: [1, 5, 10, 20], value: (p) => p.friends },
  { key: 'photos', group: 'social', tiers: [1, 10, 50], value: (p) => p.photos },
  { key: 'contest', group: 'social', tiers: [1, 3, 10], value: (p) => p.contestWins },
  { key: 'mapped', group: 'mapping', tiers: [10, 25, 50, 100], value: (p) => p.mappedPubs },
  { key: 'firstMaps', group: 'mapping', tiers: [1, 5, 20], value: (p) => p.firstMappedPubs },
  { key: 'completed', group: 'mapping', tiers: [1, 5, 20], value: (p) => p.completedPubs },
  { key: 'facts', group: 'mapping', tiers: [25, 100, 500], value: (p) => p.facts },
  { key: 'outsidePub', group: 'moments', tiers: [1], value: (p) => p.outsidePubDrinks },
  { key: 'outdoors', group: 'moments', tiers: [1], value: (p) => p.outdoorsDrinks },
  { key: 'beerDay', group: 'moments', tiers: [1], value: (p) => p.beerDayFridays, holiday: 'beerDay' },
  { key: 'nightOwl', group: 'moments', tiers: [1], value: (p) => p.afterMidnightDrinks, secret: true },
  {
    key: 'christmasEve',
    group: 'moments',
    tiers: [1],
    value: (p) => p.christmasEves,
    holiday: 'christmasEve',
  },
  {
    key: 'newYearsEve',
    group: 'moments',
    tiers: [1],
    value: (p) => p.newYearsEves,
    holiday: 'newYearsEve',
  },
  { key: 'lunch', group: 'moments', tiers: [1], value: (p) => p.lunchBeers, secret: true },
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
  group: BadgeGroup;
  kind: BadgeKind;
  /** Levels reached, 0 when still locked. */
  tier: number;
  tiers: readonly number[];
  value: number;
  /** Value that unlocks the next level, null once every level is reached. */
  next: number | null;
  slots?: readonly number[];
  volume: boolean;
  secret: boolean;
  holiday?: BadgeHoliday;
}

function kindOf(rule: BadgeRule): BadgeKind {
  if (rule.slots) return 'slots';
  return rule.tiers.length > 1 ? 'tiered' : 'once';
}

export function badgeState(rule: BadgeRule, progress: BadgeProgress): BadgeState {
  const value = rule.value(progress);
  const tier = rule.tiers.filter((threshold) => value >= threshold).length;
  return {
    key: rule.key,
    group: rule.group,
    kind: kindOf(rule),
    tier,
    tiers: rule.tiers,
    value,
    next: rule.tiers[tier] ?? null,
    ...(rule.slots ? { slots: rule.slots(progress) } : {}),
    volume: rule.volume ?? false,
    secret: rule.secret ?? false,
    ...(rule.holiday ? { holiday: rule.holiday } : {}),
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

/** The medal's frame: 1 plain coin … 4 wreath. The top level always wears the wreath. */
export function medalFrame(tier: number, tierCount: number): 1 | 2 | 3 | 4 {
  if (tier >= tierCount) return 4;
  return Math.max(1, Math.min(3, tier)) as 1 | 2 | 3;
}

/** The closest next levels of the families worth chasing; volume never is. */
export function nearestGoals(states: readonly BadgeState[], count = 3): BadgeState[] {
  return states
    .filter((state) => state.kind === 'tiered' && !state.volume && state.next != null)
    .map((state, index) => ({ state, index, share: state.value / (state.next as number) }))
    .sort((a, b) => b.share - a.share || a.index - b.index)
    .slice(0, count)
    .map(({ state }) => state);
}

const DRINKING_DAY_CUTOFF_HOURS = 4;

function holidayDate(holiday: BadgeHoliday, year: number): Date {
  if (holiday === 'christmasEve') return new Date(year, 11, 24);
  if (holiday === 'newYearsEve') return new Date(year, 11, 31);
  const firstOfAugust = new Date(year, 7, 1);
  const toFriday = (5 - firstOfAugust.getDay() + 7) % 7;
  return new Date(year, 7, 1 + toFriday);
}

/** Whole days until the holiday's next drinking day; 0 on the day itself. */
export function daysUntilHoliday(holiday: BadgeHoliday, now: Date): number {
  const shifted = new Date(now.getTime() - DRINKING_DAY_CUTOFF_HOURS * 3_600_000);
  const today = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
  let date = holidayDate(holiday, today.getFullYear());
  if (date < today) date = holidayDate(holiday, today.getFullYear() + 1);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}
