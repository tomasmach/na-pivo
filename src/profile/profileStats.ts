import type {
  RemoteStats,
  RemoteTimelineStat,
  RemoteTimelineWindow,
} from '@/data/statsClient';
import { intlLocale, t } from '@/i18n';

/** Stable keys, not the labels: the chart segment shows t.profile.period*. */
export type ProfilePeriod = 'week' | 'month' | 'year';

export interface ProfileStatPoint {
  label: string;
  value: number;
  totals: ProfileStat[];
}

export interface ProfileStat {
  label: string;
  value: string;
}

export interface ProfileStatSeries {
  points: ProfileStatPoint[];
  totals: ProfileStat[];
}

export interface ProfileRecord {
  id: string;
  title: string;
  value: string;
  when: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function statsOf(value: RemoteTimelineWindow): ProfileStat[] {
  return [
    { label: t.profile.chartStatBeers, value: String(value.beers) },
    { label: t.profile.chartStatEvenings, value: String(value.evenings) },
    { label: t.profile.chartStatPubs, value: String(value.distinctPubs) },
    { label: t.profile.chartStatLongest, value: formatDuration(value.longestEveningSeconds) },
  ];
}

function timelineWindow(row: RemoteTimelineStat): RemoteTimelineWindow {
  return {
    beers: row.beers,
    evenings: row.evenings,
    distinctPubs: row.distinctPubs,
    longestEveningSeconds: row.longestEveningSeconds,
  };
}

function shortDay(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale, { weekday: 'short' })
    .format(parsed)
    .replace('.', '');
}

function shortDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'numeric' }).format(parsed);
}

function shortMonth(value: string): string {
  const parsed = new Date(`${value}-01T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale, { month: 'short' })
    .format(parsed)
    .replace('.', '');
}

/** Weekday and month names come from Intl so the empty chart reads like a full one. */
function weekdayLabels(): string[] {
  const format = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' });
  // 1. 1. 2024 was a Monday, and the chart starts the week there.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2024, 0, 1 + i, 12)).replace('.', ''));
}

function monthLabels(): string[] {
  const format = new Intl.DateTimeFormat(intlLocale, { month: 'short' });
  return Array.from({ length: 12 }, (_, i) => format.format(new Date(2024, i, 1, 12)).replace('.', ''));
}

function emptySeries(length: number, labels: string[]): ProfileStatSeries {
  const empty: RemoteTimelineWindow = {
    beers: 0,
    evenings: 0,
    distinctPubs: 0,
    longestEveningSeconds: null,
  };
  return {
    points: labels.slice(-length).map((label) => ({ label, value: 0, totals: statsOf(empty) })),
    totals: statsOf(empty),
  };
}

export function profileSeries(stats: RemoteStats | null, period: ProfilePeriod): ProfileStatSeries {
  return profileTimelineSeries(profileTimeline(stats), period);
}

/** Drinking-day stats are canonical for Profile; legacy per-pub stats remain a fallback. */
export function profileTimeline(stats: RemoteStats | null): RemoteStats['timeline'] | null {
  return stats?.nightTimeline ?? stats?.timeline ?? null;
}

export function profileTimelineSeries(
  timeline: RemoteStats['timeline'] | null,
  period: ProfilePeriod,
): ProfileStatSeries {
  if (!timeline?.windows) {
    if (period === 'week') return emptySeries(7, weekdayLabels());
    if (period === 'month') return emptySeries(5, ['1.', '2.', '3.', '4.', '5.']);
    return emptySeries(12, monthLabels());
  }

  const config =
    period === 'week'
      ? { rows: timeline.days, window: timeline.windows.week, label: shortDay, take: 7 }
      : period === 'month'
        ? { rows: timeline.weeks, window: timeline.windows.month, label: shortDate, take: 5 }
        : { rows: timeline.months, window: timeline.windows.year, label: shortMonth, take: 12 };
  return {
    points: config.rows.slice(-config.take).map((row) => ({
      label: config.label(row.period),
      value: row.beers,
      totals: statsOf(timelineWindow(row)),
    })),
    totals: statsOf(config.window),
  };
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}

export function profileRecords(stats: RemoteStats | null): ProfileRecord[] {
  if (!stats) return [];
  const records: ProfileRecord[] = [];
  if (stats.nightRecords) {
    if (stats.nightRecords.longestSeconds > 0) {
      const pubs = stats.nightRecords.longestPubNames ?? [];
      const context = [
        formatDate(stats.nightRecords.longestDate ?? null),
        pubs.join(' → '),
      ].filter(Boolean);
      records.push({
        id: 'longest-evening',
        title: t.profile.recordEveningLength,
        value: formatDuration(stats.nightRecords.longestSeconds),
        when: context.join(' · '),
      });
    }
    return records;
  }
  if (stats.records.longestEveningSeconds !== null) {
    const context = [
      formatDate(stats.records.longestEveningDate ?? null),
      stats.records.longestEveningPubName,
    ].filter(Boolean);
    records.push({
      id: 'longest-evening',
      title: t.profile.recordEveningLength,
      value: formatDuration(stats.records.longestEveningSeconds),
      when: context.join(' · '),
    });
  }
  return records;
}

export function firstDrinkLabel(firstDrinkAt: string | null | undefined): string {
  if (!firstDrinkAt) return t.profile.firstEntryNone;
  const parsed = new Date(firstDrinkAt);
  if (!Number.isFinite(parsed.getTime())) return t.profile.firstEntryUnknown;
  return t.profile.firstEntrySince(
    new Intl.DateTimeFormat(intlLocale, {
      month: 'long',
      year: 'numeric',
    }).format(parsed),
  );
}
