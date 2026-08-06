import type {
  RemoteStats,
  RemoteTimelineStat,
  RemoteTimelineWindow,
} from '@/data/statsClient';

export type ProfilePeriod = 'Týden' | 'Měsíc' | 'Rok';

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
  if (seconds === null || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function statsOf(value: RemoteTimelineWindow): ProfileStat[] {
  return [
    { label: 'Piv', value: String(value.beers) },
    { label: 'Večerů', value: String(value.evenings) },
    { label: 'Hospod', value: String(value.distinctPubs) },
    { label: 'Nejdelší', value: formatDuration(value.longestEveningSeconds) },
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
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' })
    .format(parsed)
    .replace('.', '');
}

function shortDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' }).format(parsed);
}

function shortMonth(value: string): string {
  const parsed = new Date(`${value}-01T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('cs-CZ', { month: 'short' })
    .format(parsed)
    .replace('.', '');
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
  return profileTimelineSeries(stats?.timeline ?? null, period);
}

export function profileTimelineSeries(
  timeline: RemoteStats['timeline'] | null,
  period: ProfilePeriod,
): ProfileStatSeries {
  if (!timeline?.windows) {
    if (period === 'Týden') return emptySeries(7, ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']);
    if (period === 'Měsíc') return emptySeries(5, ['1.', '2.', '3.', '4.', '5.']);
    return emptySeries(12, ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']);
  }

  const config =
    period === 'Týden'
      ? { rows: timeline.days, window: timeline.windows.week, label: shortDay, take: 7 }
      : period === 'Měsíc'
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
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}

export function profileRecords(stats: RemoteStats | null): ProfileRecord[] {
  if (!stats) return [];
  const records: ProfileRecord[] = [];
  if (stats.records.longestEveningSeconds !== null) {
    records.push({
      id: 'longest-evening',
      title: 'Nejdelší večer',
      value: formatDuration(stats.records.longestEveningSeconds),
      when: '',
    });
  }
  if (stats.records.mostBeersInEvening > 0) {
    const context = [
      formatDate(stats.records.mostBeersDate),
      stats.records.mostBeersPubName,
    ].filter(Boolean);
    records.push({
      id: 'most-beers',
      title: 'Nejvíc piv za večer',
      value: String(stats.records.mostBeersInEvening),
      when: context.join(' · '),
    });
  }
  return records;
}

export function firstDrinkLabel(firstDrinkAt: string | null | undefined): string {
  if (!firstDrinkAt) return 'Zatím bez zápisu';
  const parsed = new Date(firstDrinkAt);
  if (!Number.isFinite(parsed.getTime())) return 'První zápis už je v deníčku';
  return `První zápis ${new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
  }).format(parsed)}`;
}
