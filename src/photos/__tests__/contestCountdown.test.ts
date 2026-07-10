import { contestCountdownLabel } from '../contestCountdown';
import { cs } from '@/i18n/cs';

describe('contestCountdownLabel', () => {
  // Fixed local "now": Friday 10 July 2026, 18:30.
  const now = new Date(2026, 6, 10, 18, 30);

  it('returns "" for a missing or unparseable periodEnd', () => {
    expect(contestCountdownLabel('', now)).toBe('');
    expect(contestCountdownLabel('not-a-date', now)).toBe('');
  });

  it('reports a finished round once periodEnd has passed', () => {
    expect(contestCountdownLabel(new Date(2026, 6, 10, 18, 29).toISOString(), now)).toBe(
      cs.photoContest.ended,
    );
    expect(contestCountdownLabel(new Date(2026, 6, 1).toISOString(), now)).toBe(
      cs.photoContest.ended,
    );
  });

  it('says "last day" when the round ends later today', () => {
    expect(contestCountdownLabel(new Date(2026, 6, 10, 23, 59).toISOString(), now)).toBe(
      cs.photoContest.endsToday,
    );
  });

  it('counts calendar days, not 24h buckets — tomorrow morning is 1 day', () => {
    // Only ~14.5 hours away, but the NEXT calendar day → "Končí zítra".
    expect(contestCountdownLabel(new Date(2026, 6, 11, 9, 0).toISOString(), now)).toBe(
      cs.photoContest.endsInDays(1),
    );
  });

  it('uses the Czech 2-4 plural form', () => {
    expect(contestCountdownLabel(new Date(2026, 6, 13, 12, 0).toISOString(), now)).toBe(
      'Končí za 3 dny',
    );
  });

  it('uses the 5+ plural form for a fresh round', () => {
    expect(contestCountdownLabel(new Date(2026, 6, 23, 12, 0).toISOString(), now)).toBe(
      'Končí za 13 dní',
    );
  });
});
