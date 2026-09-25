import { nextWeekStartsAt, parsePubVisitors } from '../pubVisitorsClient';

describe('parsePubVisitors', () => {
  it('keeps positive whole counts and drops anything else', () => {
    const visitors = parsePubVisitors({
      week_start: '2026-09-14',
      week_end: '2026-09-20',
      pubs: { u2fkbn1z: 4, u2fkbq00: 0, u2fkbzzz: 1.5, u2fkbyyy: '3' },
    });

    expect(visitors && [...visitors]).toEqual([['u2fkbn1z', 4]]);
  });

  it('returns null for a malformed body', () => {
    expect(parsePubVisitors(null)).toBeNull();
    expect(parsePubVisitors({ pubs: [] })).toBeNull();
  });
});

describe('nextWeekStartsAt', () => {
  it('reads the rollover instant the server sends', () => {
    expect(
      new Date(nextWeekStartsAt({ next_week_starts_at: '2026-09-28T00:00:00+02:00' })!).toISOString(),
    ).toBe('2026-09-27T22:00:00.000Z');
    expect(nextWeekStartsAt({ next_week_starts_at: 'nonsense' })).toBeNull();
    expect(nextWeekStartsAt({})).toBeNull();
  });
});
