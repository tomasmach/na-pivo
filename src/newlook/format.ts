// Not copy: the mark for "no number yet", the same in every language.
export const NO_VALUE = '–';

export const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** Keeps a picked time on its own day and no earlier than the next quarter hour. */
export function clampToFuture(at: Date, now = new Date()): Date {
  const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - QUARTER_HOUR_MS;
  const earliest = Math.ceil((now.getTime() + 1) / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
  return new Date(Math.min(dayEnd, Math.max(earliest, dayStart, at.getTime())));
}
