import { t } from '@/i18n';
import type { TourRun, TourStop } from '@/tours/model';
import { useNvUi } from '../../../ui/store';
import { markRunStop, nextStopIndex, stopStates, ticketDay, useLastMark } from '../tourView';

const stop = (n: number): TourStop => ({ id: `s${n}`, pubId: `p${n}`, cacheKey: null, name: `Hospoda ${n}`, address: '', lat: 50 + n / 100, lon: 14 });
const mockState: { activeRun: TourRun | null; markStop: jest.Mock } = { activeRun: null, markStop: jest.fn() };
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => mockState } }));

function run(statuses: TourRun['statuses']): TourRun {
  const stops = [stop(1), stop(2)];
  return {
    id: 'run', planId: 'plan', startedAt: '2026-10-31T19:00:00Z', endedAt: null, statuses,
    snapshot: { id: 'plan', title: 'Žižkovský tah', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops, revision: 0, updatedAt: '2026-10-31T10:00:00Z' },
  };
}

beforeEach(() => {
  useLastMark.setState({ mark: null });
  useNvUi.setState({ toast: null });
  mockState.activeRun = run({});
  mockState.markStop = jest.fn(async (id: string, status: 'visited' | 'skipped' | null) => {
    const statuses = { ...mockState.activeRun!.statuses };
    if (status) statuses[id] = status;
    else delete statuses[id];
    mockState.activeRun = { ...mockState.activeRun!, statuses };
    return { ok: true };
  });
});

it('remembers a check-off so the run can take it back', async () => {
  expect(await markRunStop('s1', 'visited')).toBe(true);
  expect(useLastMark.getState().mark).toEqual({ runId: 'run', stopId: 's1', status: 'visited', previous: null });
  expect(useNvUi.getState().toast).toBeNull();
});

it('says so when the last open stop gets checked off', async () => {
  mockState.activeRun = run({ s1: 'visited' });
  await markRunStop('s2', 'skipped');
  expect(useNvUi.getState().toast?.title).toBe(t.nv.tour.lastStop);
});

it('reports a failed check-off and keeps no undo', async () => {
  mockState.markStop = jest.fn(async () => ({ ok: false, error: 'storage' }));
  expect(await markRunStop('s1', 'visited')).toBe(false);
  expect(useLastMark.getState().mark).toBeNull();
  expect(useNvUi.getState().toast?.kind).toBe('error');
});

it('derives the run states and the next stop from the real statuses', () => {
  const states = stopStates([stop(1), stop(2), stop(3)], { s1: 'visited', s2: 'skipped' });
  expect(states).toEqual(['visited', 'skipped', 'todo']);
  expect(nextStopIndex(states)).toBe(2);
});

it('shows a plan without a meetup as undated on the ticket', () => {
  expect(ticketDay({ scheduledDate: null, scheduledTime: null })).toEqual({ dayNum: '–', dayName: t.tours.optional, time: '' });
  expect(ticketDay({ scheduledDate: '2026-10-31', scheduledTime: '20:00' })).toMatchObject({ dayNum: '31', time: '20:00' });
});
