export interface HistoricalDateTimeResult {
  iso: string;
}

function parseCzechDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(value.trim());
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
  return date.toLocaleDateString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatHistoricalTime(date: Date): string {
  return date.toLocaleTimeString('cs-CZ', {
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
  const parsedDate = parseCzechDate(dateText);
  const parsedTime = parseTime(timeText);
  if (!parsedDate || !parsedTime) return null;

  const date = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    parsedTime.hours,
    parsedTime.minutes,
    0,
    0,
  );
  if (
    date.getFullYear() !== parsedDate.year ||
    date.getMonth() !== parsedDate.month - 1 ||
    date.getDate() !== parsedDate.day
  ) {
    return null;
  }
  if (date.getTime() > now.getTime() + 60 * 1000) return null;
  return { iso: date.toISOString() };
}
