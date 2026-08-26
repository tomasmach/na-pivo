import { intlLocale } from '@/i18n';

export interface HistoricalDateTimeResult {
  iso: string;
  endedIso?: string | null;
}

/**
 * Reads back exactly what `formatHistoricalDate` writes into the field. Both
 * locales we ship put the day first, so the separator is the only difference:
 * "04. 07. 2026" in Czech, "04/07/2026" in English.
 */
function parseEditableDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

export function formatHistoricalDate(date: Date): string {
  return date.toLocaleDateString(intlLocale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatHistoricalTime(date: Date): string {
  return date.toLocaleTimeString(intlLocale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function buildHistoricalCheckedInAt(
  dateText: string,
  timeText: string,
  now: Date = new Date(),
): HistoricalDateTimeResult | null {
  return buildHistoricalInterval(dateText, timeText, '', now);
}

export function buildHistoricalInterval(
  dateText: string,
  startTimeText: string,
  endTimeText: string,
  now: Date = new Date(),
): HistoricalDateTimeResult | null {
  const parsedDate = parseEditableDate(dateText);
  const parsedStartTime = parseTime(startTimeText);
  const cleanEndTime = endTimeText.trim();
  const parsedEndTime = cleanEndTime ? parseTime(cleanEndTime) : null;
  if (!parsedDate || !parsedStartTime || (cleanEndTime && !parsedEndTime)) return null;

  const start = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    parsedStartTime.hours,
    parsedStartTime.minutes,
    0,
    0,
  );
  if (
    start.getFullYear() !== parsedDate.year ||
    start.getMonth() !== parsedDate.month - 1 ||
    start.getDate() !== parsedDate.day
  ) {
    return null;
  }
  if (start.getTime() > now.getTime() + 60 * 1000) return null;

  let endedIso: string | null = null;
  if (parsedEndTime) {
    const end = new Date(
      parsedDate.year,
      parsedDate.month - 1,
      parsedDate.day,
      parsedEndTime.hours,
      parsedEndTime.minutes,
      0,
      0,
    );
    if (end.getTime() < start.getTime()) {
      end.setDate(end.getDate() + 1);
    }
    if (end.getTime() > now.getTime() + 60 * 1000) return null;
    endedIso = end.toISOString();
  }

  return { iso: start.toISOString(), endedIso };
}
