import { cleanChallenge, newTour, validPlan, validRun, validSchedule, samePub, type TourPlan } from '../model';
jest.mock('@/data/account', () => ({ generateUuidV4: () => '11111111-1111-4111-8111-111111111111' }));
const stop = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, pubId: String(n), cacheKey: null, name: `Pub ${n}`, address: 'Prague', lat: 50, lon: 14 });
const plan = (): TourPlan => ({ ...newTour(), title: 'Pub walk', stops: [stop(1), stop(2)] });
describe('Tour domain contracts', () => {
  it('allows unfinished 0–8 drafts, requires 2–8 different pubs for a plan', () => {
    expect(validPlan(newTour(), true)).toBe(true);
    expect(validPlan(newTour())).toBe(false);
    expect(validPlan(plan())).toBe(true);
    expect(validPlan({ ...plan(), stops: [stop(1), stop(1)] })).toBe(false);
    expect(validPlan({ ...plan(), stops: Array.from({ length: 9 }, (_, i) => stop(i + 1)) }, true)).toBe(false);
    expect(samePub({ ...stop(1), cacheKey: 'u2fk', name: ' Pub ' }, { ...stop(2), cacheKey: 'u2fk', name: 'pub' })).toBe(true);
  });
  it('rejects malformed persisted dates without throwing and disallows time without date', () => {
    for (const scheduledDate of ['2026-99-99', '2026-02-30'])
      expect(validPlan({ ...plan(), scheduledDate })).toBe(false);
    expect(validPlan({ ...plan(), scheduledTime: '18:30' })).toBe(false);
    expect(validPlan({ ...plan(), timezone: 'Garbage' })).toBe(false);
    expect(validPlan({ ...plan(), stops: [stop(1), { ...stop(2), lat: NaN }] })).toBe(false);
  });
  it('uses calendar dates in the meeting timezone for the 90 day window', () => {
    const p = { ...plan(), scheduledDate: '2026-09-19' };
    expect(validSchedule(p, new Date('2026-09-18T23:30:00Z'))).toBe(true);
    expect(validSchedule({ ...p, scheduledDate: '2026-09-18' }, new Date('2026-09-18T23:30:00Z'))).toBe(false);
    expect(validSchedule({ ...p, scheduledDate: '2026-12-18' }, new Date('2026-09-19T10:00:00Z'))).toBe(true);
    expect(validSchedule({ ...p, scheduledDate: '2026-12-19' }, new Date('2026-09-19T10:00:00Z'))).toBe(false);
  });
  it('does not depend on the date separator emitted by platform ICU', () => {
    const original = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get: () => () => '09/18/2026' });
    try {
      expect(validSchedule({ ...plan(), scheduledDate: '2026-09-18' }, new Date('2026-09-18T10:00:00Z'))).toBe(true);
      expect(validSchedule({ ...plan(), scheduledDate: '2026-12-18' }, new Date('2026-09-18T10:00:00Z'))).toBe(false);
    } finally {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', original);
    }
  });
  it('rejects missing DST wall time while accepting the repeated autumn hour', () => {
    expect(validSchedule({ ...plan(), scheduledDate: '2027-03-28', scheduledTime: '02:30' }, new Date('2027-03-01T00:00:00Z'))).toBe(false);
    expect(validSchedule({ ...plan(), scheduledDate: '2027-03-28', scheduledTime: '03:30' }, new Date('2027-03-01T00:00:00Z'))).toBe(true);
    expect(validSchedule({ ...plan(), scheduledDate: '2026-10-25', scheduledTime: '02:30' }, new Date('2026-10-01T00:00:00Z'))).toBe(true);
  });
  it('rejects run statuses referring to stops outside its immutable snapshot', () => {
    const p = plan();
    const run = { id: stop(5).id, planId: p.id, snapshot: p, startedAt: new Date().toISOString(), endedAt: null, statuses: {} };
    expect(validRun(run)).toBe(true);
    expect(validRun({ ...run, statuses: { [stop(3).id]: 'visited' } })).toBe(false);
  });
  it('keeps stops saved before challenges valid and bounds a challenge to one short line', () => {
    expect(validPlan({ ...plan(), stops: [{ ...stop(1), challenge: 'x'.repeat(120) }, stop(2)] })).toBe(true);
    expect(validPlan({ ...plan(), stops: [{ ...stop(1), challenge: 'x'.repeat(121) }, stop(2)] })).toBe(false);
    expect(validPlan({ ...plan(), stops: [{ ...stop(1), challenge: 7 as unknown as string }, stop(2)] })).toBe(false);
    expect(cleanChallenge('  Zeptej se\n  výčepního  ')).toBe('Zeptej se výčepního');
  });
});
