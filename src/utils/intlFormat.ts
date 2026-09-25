import { intlLocale } from '@/i18n';

/**
 * Cached Intl formatters. Building a new Intl.NumberFormat / DateTimeFormat is
 * slow on Hermes, and list rows format on every render. Call sites pass fixed
 * option literals, so the cache stays small. Invalid options still throw from
 * the constructor, exactly like `new Intl.*` would.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

export function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${intlLocale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale, options);
    numberFormats.set(key, format);
  }
  return format;
}

export function dateTimeFormat(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  const key = `${intlLocale}|${JSON.stringify(options)}`;
  let format = dateTimeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale, options);
    dateTimeFormats.set(key, format);
  }
  return format;
}
