import { beersAtStop, tourStopAtPub } from '../counterLink';
import type { TourRun } from '../model';

const stop = (n: number, cacheKey: string) => ({ id: `s${n}`, pubId: `p${n}`, cacheKey, name: `Hospoda ${n}`, address: '', lat: 50, lon: 14 });
const started = Date.parse('2026-09-24T18:00:00Z');
const run = (statuses: TourRun['statuses'] = {}): TourRun => ({
  id: 'r', planId: 'a', startedAt: new Date(started).toISOString(), endedAt: null, statuses,
  snapshot: { id: 'a', title: 'A', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops: [stop(1, 'aaaa1111'), stop(2, 'bbbb2222')], revision: 1, updatedAt: '2026-09-24T10:00:00Z' },
});

it('finds the unmarked stop the counter pub belongs to, by cell or pub id', () => {
  expect(tourStopAtPub(run(), 'bbbb2222', undefined, started)).toMatchObject({ stop: { id: 's2' }, number: 2 });
  expect(tourStopAtPub(run(), 'zzzz0000', 'p1', started)).toMatchObject({ stop: { id: 's1' }, number: 1 });
  expect(tourStopAtPub(run({ s2: 'visited' }), 'bbbb2222', undefined, started)).toBeNull();
  expect(tourStopAtPub(run(), 'zzzz0000', 'other', started)).toBeNull();
});

it('leaves a run older than twelve hours alone', () => {
  expect(tourStopAtPub(run(), 'bbbb2222', undefined, started + 13 * 3600000)).toBeNull();
});

it('counts only beers at the stop since the run started', () => {
  const sessions = [
    { pubKey: 'aaaa1111', drinks: [{ at: '2026-09-24T18:30:00Z' }, { at: '2026-09-24T18:50:00Z', drinkType: 'wine' }, { at: '2026-09-24T17:00:00Z' }] },
    { pubKey: 'aaaa1111', drinks: [{ at: '2026-09-24T19:30:00Z', drinkType: 'beer' }] },
    { pubKey: 'bbbb2222', drinks: [{ at: '2026-09-24T20:00:00Z' }] },
  ];
  expect(beersAtStop(stop(1, 'aaaa1111'), run(), sessions)).toBe(2);
});
