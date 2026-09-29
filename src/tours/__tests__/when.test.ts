import { earliestMinutes, isPastDate, suggestedTitle, whenLabel } from '../when';

const plan = (scheduledDate: string | null, scheduledTime: string | null = null) => ({ scheduledDate, scheduledTime, timezone: 'Europe/Prague' });
// Monday 28 September 2026, 21:50 in Prague.
const now = new Date('2026-09-28T19:50:00Z');

it('says today and tomorrow in words and other days with the weekday', () => {
  expect(whenLabel(plan('2026-09-28', '22:30'), now, 'Europe/Prague')).toBe('dnes · 22:30');
  expect(whenLabel(plan('2026-09-29'), now, 'Europe/Prague')).toBe('zítra');
  expect(whenLabel(plan('2026-10-02', '19:00'), now, 'Europe/Prague')).toBe('pá 2. 10. · 19:00');
  expect(whenLabel(plan('2027-01-08', '19:00'), now, 'Europe/Prague')).toBe('pá 8. 1. 2027 · 19:00');
  expect(whenLabel(plan(null), now)).toBeNull();
});

it('names the zone only when the phone is somewhere else', () => {
  expect(whenLabel(plan('2026-10-02', '19:00'), now, 'Europe/London')).toBe('pá 2. 10. · 19:00 SELČ');
  // Before the clocks go forward that night, winter time still applies.
  expect(whenLabel(plan('2027-03-28', '01:30'), now, 'Europe/London')).toBe('ne 28. 3. 2027 · 01:30 SEČ');
});

it('offers today only times at least a quarter of an hour away', () => {
  expect(earliestMinutes('2026-09-28', 'Europe/Prague', now)).toBe(22 * 60 + 15);
  expect(earliestMinutes('2026-09-29', 'Europe/Prague', now)).toBe(0);
  expect(earliestMinutes('2026-09-28', 'Europe/Prague', new Date('2026-09-28T21:50:00Z'))).toBeNull();
});

it('treats a meetup before today as passed, where the tour happens', () => {
  expect(isPastDate(plan('2026-09-27'), now)).toBe(true);
  expect(isPastDate(plan('2026-09-28'), now)).toBe(false);
  // 23:30 UTC on the 28th is already the 29th in Prague.
  expect(isPastDate(plan('2026-09-28'), new Date('2026-09-28T23:30:00Z'))).toBe(true);
});

it('suggests a name from the meetup weekday', () => {
  expect(suggestedTitle(plan('2026-10-02'))).toBe('Pátek po hospodách');
  expect(suggestedTitle(plan(null))).toBe('Tour po hospodách');
});
