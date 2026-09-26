import { clearTourRunQueue, dropTourRunOps, enqueueTourRunOp, flushTourRunQueue, pendingTourRunOps, setTourRunDeliveryListener } from '../tourRunQueue';
import { putTourRun, putTourRunMember } from '../toursClient';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock') }));
jest.mock('../toursClient', () => ({ putTourRun: jest.fn(), putTourRunMember: jest.fn() }));

const run = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
const publicId = '33333333-3333-4333-8333-333333333333';
const crewRun = { id: run, ended: false, organizerId: 'o', members: [], me: { completed: true, left: false }, peopleCount: 3, counted: true };

beforeEach(async () => {
  jest.clearAllMocks();
  await clearTourRunQueue();
});

it('keeps a join and its flag in order until the organizer registers the run', async () => {
  jest.mocked(putTourRunMember).mockResolvedValue({ status: 404, run: null });
  await enqueueTourRunOp({ runId: run, publicId, op: 'join' });
  await enqueueTourRunOp({ runId: run, publicId, op: 'complete' });
  await flushTourRunQueue();
  // The flag never overtakes its join.
  expect(jest.mocked(putTourRunMember).mock.calls.every(([, state]) => state === 'joined')).toBe(true);
  expect(await pendingTourRunOps(run)).toEqual(['join', 'complete']);

  const delivered = jest.fn();
  setTourRunDeliveryListener(delivered);
  jest.mocked(putTourRunMember).mockResolvedValue({ status: 200, run: crewRun });
  await flushTourRunQueue();
  expect(await pendingTourRunOps(run)).toEqual([]);
  expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'complete' }), { run: crewRun, refused: false });
  setTourRunDeliveryListener(null);
});

it('drops what can never succeed and what waited too long', async () => {
  jest.mocked(putTourRun).mockResolvedValue({ status: 400, run: null });
  await enqueueTourRunOp({ runId: run, publicId, op: 'register' });
  await flushTourRunQueue();
  expect(await pendingTourRunOps(run)).toEqual([]);

  jest.useFakeTimers({ now: Date.now() });
  jest.mocked(putTourRunMember).mockResolvedValue({ status: 404, run: null });
  await enqueueTourRunOp({ runId: run, publicId, op: 'join' });
  jest.setSystemTime(Date.now() + 49 * 3600000);
  await flushTourRunQueue();
  expect(await pendingTourRunOps(run)).toEqual([]);
  jest.useRealTimers();
});

it('replaces a repeated operation instead of sending it twice', async () => {
  jest.mocked(putTourRun).mockResolvedValue({ status: 503, run: null });
  await enqueueTourRunOp({ runId: run, publicId, op: 'register' });
  await enqueueTourRunOp({ runId: run, publicId, op: 'register' });
  expect(await pendingTourRunOps(run)).toEqual(['register']);
});

it('lets a new join replace a waiting leave, and takes back unsent ops', async () => {
  jest.mocked(putTourRunMember).mockResolvedValue({ status: 503, run: null });
  await enqueueTourRunOp({ runId: run, publicId, op: 'join' });
  await enqueueTourRunOp({ runId: run, publicId, op: 'leave' });
  await enqueueTourRunOp({ runId: run, publicId, op: 'join' });
  expect(await pendingTourRunOps(run)).toEqual(['join']);
  await enqueueTourRunOp({ runId: run, publicId, op: 'complete' });
  await dropTourRunOps(run, ['complete']);
  expect(await pendingTourRunOps(run)).toEqual(['join']);
});

it('tells the store when the server turns a join down', async () => {
  const delivered = jest.fn();
  setTourRunDeliveryListener(delivered);
  jest.mocked(putTourRunMember).mockResolvedValue({ status: 200, run: null, refused: true });
  await enqueueTourRunOp({ runId: run, publicId, op: 'join' });
  await flushTourRunQueue();
  expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'join' }), { run: null, refused: true });
  jest.mocked(putTourRunMember).mockResolvedValue({ status: 400, run: null });
  await enqueueTourRunOp({ runId: run, publicId, op: 'join' });
  await flushTourRunQueue();
  expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'join' }), { run: null, refused: true });
  setTourRunDeliveryListener(null);
});
