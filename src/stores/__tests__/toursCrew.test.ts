import { useToursStore as store, clearToursPrivateData } from '../toursStore';
import { fetchSharedTour } from '@/data/toursClient';
import { dropTourRunOps, enqueueTourRunOp, setTourRunDeliveryListener } from '@/data/tourRunQueue';
import type { TourPlan } from '@/tours/model';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock') }));
jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'owner-a', authenticated: true })), getOrCreateDeviceId: jest.fn(async () => 'device-a'),
  generateUuidV4: jest.fn(() => jest.requireActual('node:crypto').randomUUID()),
}));
jest.mock('@/data/accountMerge', () => ({ readAccountMerge: jest.fn(async () => ({ ok: true, intent: null })) }));
jest.mock('@/data/toursClient', () => ({
  toTourWire: jest.requireActual('@/data/toursClient').toTourWire, fetchSharedTour: jest.fn(), publishTour: jest.fn(), shareTour: jest.fn(), revokeTour: jest.fn(),
  deletePublishedTour: jest.fn(), fetchPublishedTours: jest.fn(), publishPublicTour: jest.fn(), unpublishPublicTour: jest.fn(), reportPublicTour: jest.fn(), fetchTourRun: jest.fn(),
}));
jest.mock('@/data/tourRunQueue', () => ({ enqueueTourRunOp: jest.fn(async () => undefined), dropTourRunOps: jest.fn(async () => undefined), setTourRunDeliveryListener: jest.fn() }));

// Captured before clearAllMocks wipes the call record of the module-level registration.
const deliver = jest.mocked(setTourRunDeliveryListener).mock.calls[0][0]!;
const publicId = '44444444-4444-4444-8444-444444444444';
const token = 'publicTokenForTests12';
const remote: TourPlan = {
  id: publicId, title: 'Veřejná', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', revision: 2, updatedAt: new Date().toISOString(),
  stops: [1, 2, 3].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, pubId: `directory:p${n}`, cacheKey: null, name: `Pub ${n}`, address: 'Praha', lat: 50 + n / 100, lon: 14 })),
};
const info = { id: publicId, peopleCount: 0, city: 'Praha', walkM: 900, author: { id: 'a', nickname: 'autor', displayName: '', avatarUrl: null } };
const ops = () => jest.mocked(enqueueTourRunOp).mock.calls.map(([item]) => item.op);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const serverRun = (id: string) => ({ id, ended: false, organizerId: 'o', members: [], me: { completed: true, left: false }, peopleCount: 1, counted: true });

async function savedPublicPlan() {
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: remote, public: info });
  const saved = await store.getState().savePublic(token);
  return (saved as { id: string }).id;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await clearToursPrivateData();
  await store.getState().hydrate();
});

it('starts a party run only for a signed-in walker of a public tour, and counts them once after half the pubs', async () => {
  const id = await savedPublicPlan();
  await store.getState().startRun(id, { eligible: false });
  expect(store.getState().activeRun!.crew).toBeUndefined();
  await store.getState().endRun();

  await store.getState().startRun(id, { eligible: true });
  const run = store.getState().activeRun!;
  expect(run.crew).toMatchObject({ runId: run.id, publicId, token, organizer: true });
  const [first, second, third] = run.snapshot.stops;
  await store.getState().markStop(first.id, 'visited');
  expect(ops()).toEqual(['register']);
  await store.getState().markStop(second.id, 'visited');
  await store.getState().markStop(third.id, 'visited');
  await store.getState().markStop(second.id, null);
  expect(ops()).toEqual(['register', 'complete']);
  expect(store.getState().activeRun!.crew!.completion).toBe('pending');

  deliver({ runId: run.id, publicId, op: 'complete', createdAt: new Date().toISOString() },
    { run: { id: run.id, ended: false, organizerId: 'o', members: [], me: { completed: true, left: false }, peopleCount: 1, counted: true }, refused: false });
  await settle();
  await store.getState().hydrate();
  expect(store.getState().activeRun!.crew).toMatchObject({ completion: 'sent', counted: true });
  await store.getState().endRun();
  expect(ops()).toEqual(['register', 'complete', 'end']);
});

it('joins a party from its code, respects opting out and leaves without ending anyone else', async () => {
  const runId = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: remote, public: info });
  const joined = await store.getState().joinCrew(token, runId);
  expect(joined.ok).toBe(true);
  expect(store.getState().activeRun!.crew).toMatchObject({ runId, organizer: false });
  expect(await store.getState().joinCrew(token, runId)).toEqual({ ok: false, error: 'active_run' });
  await store.getState().setCrewOptOut(true);
  const [first, second] = store.getState().activeRun!.snapshot.stops;
  await store.getState().markStop(first.id, 'visited');
  await store.getState().markStop(second.id, 'visited');
  expect(ops()).toEqual(['join']);
  await store.getState().setCrewOptOut(false);
  expect(ops()).toEqual(['join', 'complete']);
  await store.getState().endRun();
  expect(ops()).toEqual(['join', 'complete', 'leave']);
});

it('takes a completion back after "Nezapočítávat mě", whether it is still waiting or already sent', async () => {
  const id = await savedPublicPlan();
  await store.getState().startRun(id, { eligible: true });
  const run = store.getState().activeRun!;
  const [first, second] = run.snapshot.stops;
  await store.getState().markStop(first.id, 'visited');
  await store.getState().markStop(second.id, 'visited');
  await store.getState().setCrewOptOut(true);
  // Still on the phone: it never leaves.
  expect(dropTourRunOps).toHaveBeenCalledWith(run.id, ['complete']);
  expect(store.getState().activeRun!.crew!.completion).toBeUndefined();

  await store.getState().setCrewOptOut(false);
  deliver({ runId: run.id, publicId, op: 'complete', createdAt: new Date().toISOString() }, { run: serverRun(run.id), refused: false });
  await settle();
  await store.getState().hydrate();
  await store.getState().setCrewOptOut(true);
  expect(ops()).toEqual(['register', 'complete', 'complete', 'uncount']);
  expect(store.getState().activeRun!.crew).not.toHaveProperty('counted');
});

it('lets a finished walk leave the number but not rejoin it', async () => {
  const id = await savedPublicPlan();
  await store.getState().startRun(id, { eligible: true });
  const run = store.getState().activeRun!;
  await store.getState().markStop(run.snapshot.stops[0].id, 'visited');
  await store.getState().markStop(run.snapshot.stops[1].id, 'visited');
  deliver({ runId: run.id, publicId, op: 'complete', createdAt: new Date().toISOString() }, { run: serverRun(run.id), refused: false });
  await settle();
  await store.getState().endRun();
  expect(await store.getState().setCrewOptOut(true, run.id)).toEqual({ ok: true });
  expect(ops()).toContain('uncount');
  expect(await store.getState().setCrewOptOut(false, run.id)).toEqual({ ok: false, error: 'invalid' });
});

it('joins on the route the organizer published, not an older saved copy', async () => {
  await savedPublicPlan();
  // The author swapped a pub since this phone saved the tour.
  const republished = { ...remote, revision: 3, stops: [remote.stops[0], { ...remote.stops[1], id: '00000000-0000-4000-8000-000000000009', pubId: 'directory:p9', name: 'Pub 9' }] };
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: republished, public: info });
  await store.getState().joinCrew(token, '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab');
  expect(store.getState().activeRun!.snapshot.stops.map((stop) => stop.name)).toEqual(['Pub 1', 'Pub 9']);
});

it('drops the party quietly when the server turns the join down', async () => {
  const runId = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: remote, public: info });
  await store.getState().joinCrew(token, runId);
  deliver({ runId, publicId, op: 'join', createdAt: new Date().toISOString() }, { run: null, refused: true });
  await settle();
  await store.getState().hydrate();
  expect(store.getState().activeRun!.crew).toMatchObject({ refused: true });
  expect(store.getState().activeRun!.crew).not.toHaveProperty('members');
  expect(dropTourRunOps).toHaveBeenCalledWith(runId);
  const [first, second] = store.getState().activeRun!.snapshot.stops;
  await store.getState().markStop(first.id, 'visited');
  await store.getState().markStop(second.id, 'visited');
  expect(ops()).toEqual(['join']);
});
