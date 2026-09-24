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
  it('expires counts for 14.–20. 9. when 28. 9. starts in Prague', () => {
    expect(new Date(nextWeekStartsAt('2026-09-14')!).toISOString()).toBe(
      '2026-09-27T23:00:00.000Z',
    );
    expect(nextWeekStartsAt('nonsense')).toBeNull();
  });
});
