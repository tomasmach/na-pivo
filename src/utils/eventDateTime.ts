import { intlLocale } from '@/i18n';

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** cs-CZ gives "19. 7. 2026", en-GB "19/07/2026". The time is assembled by hand
 *  so the string always round-trips through the parser below, whatever hour
 *  cycle the platform's Intl happens to prefer. */
const dateFormatter = new Intl.DateTimeFormat(intlLocale, {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

export function formatEventDateTime(date: Date): string {
  return `${dateFormatter.format(date)} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

/** Accepts both day-first shapes the field can hold: "19. 7. 2026 19:00" and
 *  "19/07/2026 19:00", with or without the comma Intl puts between date and
 *  time in some locales. */
export function parseEventDateTime(value: string): Date | null {
  const match = value
    .replace(/,/g, ' ')
    .trim()
    .match(/^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]?\s*(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw) - 1;
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const date = new Date(year, month, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}
