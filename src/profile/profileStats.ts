import type { DiarySnapshot } from '@/data/diarySync';
import { normalizeDrinkType } from '@/drinks/drinkTypes';
import {
  allSessionsNewestFirst,
  drinkingDayKey,
  type TallySession,
} from '@/stores/tallyStore';

import type {
  PersonalRecord,
  StatPeriod,
  StatPoint,
  StatSeries,
  Streak,
} from './mockStats';

export interface ProfileDiaryEntry {
  id: string;
  at: string;
  pubKey: string | null;
  pubName: string;
  isBeer: boolean;
}

interface DrinkingNight {
  day: string;
  entries: ProfileDiaryEntry[];
  beers: number;
  pubKeys: Set<string>;
  pubNames: string[];
  firstAt: number;
  lastAt: number;
}

const MONTH_SHORT = [
  'led',
  'úno',
  'bře',
  'dub',
  'kvě',
  'čer',
  'čvc',
  'srp',
  'zář',
  'říj',
  'lis',
  'pro',
];
const MONTH_LONG = [
  'leden',
  'únor',
  'březen',
  'duben',
  'květen',
  'červen',
  'červenec',
  'srpen',
  'září',
  'říjen',
  'listopad',
  'prosinec',
];

function localDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function durationLabel(ms: number): string {
  if (ms <= 0) return '—';
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

function totals(entries: ProfileDiaryEntry[]): StatPoint['totals'] {
  const nights = groupNights(entries);
  const pubs = new Set(
    entries.map((entry) => entry.pubKey).filter((key): key is string => Boolean(key)),
  );
  const longest = nights.reduce((max, night) => Math.max(max, night.lastAt - night.firstAt), 0);
  return [
    { label: 'Piv', value: String(entries.filter((entry) => entry.isBeer).length) },
    { label: 'Večerů', value: String(nights.length) },
    { label: 'Hospod', value: String(pubs.size) },
    { label: 'Nejdelší', value: durationLabel(longest) },
  ];
}

function groupNights(entries: ProfileDiaryEntry[]): DrinkingNight[] {
  const byDay = new Map<string, DrinkingNight>();
  for (const entry of entries) {
    const parsed = new Date(entry.at);
    const at = parsed.getTime();
    if (!Number.isFinite(at)) continue;
    const day = drinkingDayKey(parsed);
    let night = byDay.get(day);
    if (!night) {
      night = {
        day,
        entries: [],
        beers: 0,
        pubKeys: new Set(),
        pubNames: [],
        firstAt: at,
        lastAt: at,
      };
      byDay.set(day, night);
    }
    night.entries.push(entry);
    if (entry.isBeer) night.beers += 1;
    if (entry.pubKey) night.pubKeys.add(entry.pubKey);
    if (entry.pubName && !night.pubNames.includes(entry.pubName)) night.pubNames.push(entry.pubName);
    night.firstAt = Math.min(night.firstAt, at);
    night.lastAt = Math.max(night.lastAt, at);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Merge the authoritative diary snapshot with local-only rows by drink client id. */
export function buildProfileDiary(
  current: TallySession | null,
  history: TallySession[],
  snapshot: DiarySnapshot | null,
): ProfileDiaryEntry[] {
  const entries: ProfileDiaryEntry[] = [];
  const remoteIds = new Set<string>();
  for (const drink of snapshot?.drinks ?? []) {
    remoteIds.add(drink.client_id);
    if (drink.is_suspect) continue;
    entries.push({
      id: drink.client_id,
      at: drink.drank_at,
      pubKey: drink.cache_key,
      pubName: drink.name,
      isBeer: normalizeDrinkType(drink.drink_type) === 'beer',
    });
  }
  for (const session of allSessionsNewestFirst(current, history)) {
    for (const drink of session.drinks) {
      if (remoteIds.has(drink.id)) continue;
      entries.push({
        id: drink.id,
        at: drink.at,
        pubKey: session.pubKey.startsWith('ctx:') ? null : session.pubKey,
        pubName: session.pubName,
        isBeer: normalizeDrinkType(drink.drinkType) === 'beer',
      });
    }
  }
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function point(label: string, entries: ProfileDiaryEntry[]): StatPoint {
  return {
    label,
    value: entries.filter((entry) => entry.isBeer).length,
    totals: totals(entries),
  };
}

export function computeProfileSeries(
  entries: ProfileDiaryEntry[],
  now: Date = new Date(),
): Record<StatPeriod, StatSeries> {
  const drinkingToday = localDay(drinkingDayKey(now));
  const currentWeek = startOfWeek(drinkingToday);
  const weekBuckets = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(currentWeek, index);
    const key = dayKey(date);
    return entries.filter((entry) => drinkingDayKey(new Date(entry.at)) === key);
  });

  const monthStart = addDays(currentWeek, -21);
  const monthBuckets = Array.from({ length: 4 }, (_, index) => {
    const start = addDays(monthStart, index * 7);
    const end = addDays(start, 7);
    return entries.filter((entry) => {
      const day = localDay(drinkingDayKey(new Date(entry.at)));
      return day >= start && day < end;
    });
  });

  const yearMonths = Array.from({ length: 12 }, (_, index) =>
    new Date(drinkingToday.getFullYear(), drinkingToday.getMonth() - 11 + index, 1, 12),
  );
  const yearBuckets = yearMonths.map((month) => {
    const next = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
    return entries.filter((entry) => {
      const day = localDay(drinkingDayKey(new Date(entry.at)));
      return day >= month && day < next;
    });
  });

  const finish = (labels: string[], buckets: ProfileDiaryEntry[][]): StatSeries => ({
    points: buckets.map((bucket, index) => point(labels[index], bucket)),
    totals: totals(buckets.flat()),
  });

  return {
    Týden: finish(['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'], weekBuckets),
    Měsíc: finish(['1.t', '2.t', '3.t', '4.t'], monthBuckets),
    Rok: finish(yearMonths.map((month) => MONTH_SHORT[month.getMonth()]), yearBuckets),
  };
}

export function computeProfileStreak(entries: ProfileDiaryEntry[], now: Date = new Date()): Streak {
  const nights = groupNights(entries);
  const activeWeeks = new Set(nights.map((night) => dayKey(startOfWeek(localDay(night.day)))));
  const currentWeek = startOfWeek(localDay(drinkingDayKey(now)));
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const start = addDays(currentWeek, (index - 11) * 7);
    const end = addDays(start, 7);
    const nightCount = nights.filter((night) => {
      const day = localDay(night.day);
      return day >= start && day < end;
    }).length;
    return { label: `${start.getDate()}. ${start.getMonth() + 1}.`, nights: nightCount };
  });

  let current = 0;
  for (
    let week = new Date(currentWeek);
    activeWeeks.has(dayKey(week));
    week = addDays(week, -7)
  ) {
    current += 1;
  }

  const ordered = [...activeWeeks].sort();
  let best = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of ordered) {
    const week = localDay(key);
    run = previous && dayKey(addDays(previous, 7)) === key ? run + 1 : 1;
    best = Math.max(best, run);
    previous = week;
  }
  return { current, best, weeks };
}

function recordWhen(night: DrinkingNight): string {
  const date = localDay(night.day);
  const dateLabel = `${date.getDate()}. ${date.getMonth() + 1}.`;
  const place = night.pubNames.join(' → ');
  return place ? `${dateLabel} · ${place}` : dateLabel;
}

export function computeProfileRecords(entries: ProfileDiaryEntry[]): PersonalRecord[] {
  const nights = groupNights(entries);
  let longest: DrinkingNight | null = null;
  let mostPubs: DrinkingNight | null = null;
  let mostBeers: DrinkingNight | null = null;
  for (const night of nights) {
    // Strict comparisons are intentional: tying a record never replaces the
    // original night on which it was first set.
    if (!longest || night.lastAt - night.firstAt > longest.lastAt - longest.firstAt) longest = night;
    if (!mostPubs || night.pubKeys.size > mostPubs.pubKeys.size) mostPubs = night;
    if (!mostBeers || night.beers > mostBeers.beers) mostBeers = night;
  }

  const firstPubSeen = new Map<string, string>();
  for (const entry of entries) {
    if (entry.pubKey && !firstPubSeen.has(entry.pubKey)) {
      firstPubSeen.set(entry.pubKey, drinkingDayKey(new Date(entry.at)));
    }
  }
  const newPubsByMonth = new Map<string, number>();
  for (const day of firstPubSeen.values()) {
    const month = day.slice(0, 7);
    newPubsByMonth.set(month, (newPubsByMonth.get(month) ?? 0) + 1);
  }
  let bestMonth = '';
  let bestMonthCount = 0;
  for (const [month, count] of [...newPubsByMonth].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > bestMonthCount) {
      bestMonth = month;
      bestMonthCount = count;
    }
  }
  const empty = 'Zatím bez zápisu';
  const monthDate = bestMonth ? localDay(`${bestMonth}-01`) : null;
  return [
    {
      id: 'longest',
      title: 'Nejdelší večer',
      value: longest ? durationLabel(longest.lastAt - longest.firstAt) : '—',
      when: longest ? recordWhen(longest) : empty,
    },
    {
      id: 'pubs',
      title: 'Nejvíc hospod za večer',
      value: mostPubs ? String(mostPubs.pubKeys.size) : '—',
      when: mostPubs ? recordWhen(mostPubs) : empty,
    },
    {
      id: 'beers',
      title: 'Nejvíc piv za večer',
      value: mostBeers ? String(mostBeers.beers) : '—',
      when: mostBeers ? recordWhen(mostBeers) : empty,
    },
    {
      id: 'new-pubs',
      title: 'Nejvíc nových hospod za měsíc',
      value: bestMonth ? String(bestMonthCount) : '—',
      when: monthDate
        ? `${MONTH_LONG[monthDate.getMonth()]} ${monthDate.getFullYear()}`
        : empty,
    },
  ];
}
