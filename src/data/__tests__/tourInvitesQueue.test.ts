import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearTourInvitesQueue, enqueueTourInvite, flushTourInvitesQueue, queuedTourInvitees, setTourInvitePreparer, subscribeTourInviteDelivery } from '../tourInvitesQueue';
import { sendTourInvites } from '../tourInvitesClient';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock') }));
jest.mock('../tourInvitesClient', () => ({ sendTourInvites: jest.fn() }));

const plan = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
const prepare = jest.fn(async () => 'ok' as const);
const offline = { ok: false, error: 'network', status: 0, retry: true } as const;

beforeEach(async () => {
  jest.clearAllMocks();
  setTourInvitePreparer(prepare);
  await clearTourInvitesQueue();
});

it('keeps an invite without signal, merges a second one for the same tour, and sends it once back online', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue(offline);
  expect(await enqueueTourInvite(plan, ['a', 'b'])).toBe(true);
  expect(await enqueueTourInvite(plan, ['b', 'c'])).toBe(true);
  await flushTourInvitesQueue();
  expect(await queuedTourInvitees(plan)).toEqual(['a', 'b', 'c']);

  const delivered = jest.fn();
  const stop = subscribeTourInviteDelivery(delivered);
  jest.mocked(sendTourInvites).mockResolvedValue({ ok: true, value: { roster: [], invited: 3 } });
  await flushTourInvitesQueue();
  expect(sendTourInvites).toHaveBeenLastCalledWith(plan, ['a', 'b', 'c']);
  expect(delivered).toHaveBeenCalledWith(plan);
  expect(await queuedTourInvitees(plan)).toEqual([]);
  stop();
});

it('waits while the tour cannot be put online and drops a tour that is gone', async () => {
  prepare.mockResolvedValueOnce('retry' as never);
  await enqueueTourInvite(plan, ['a']);
  await flushTourInvitesQueue();
  expect(sendTourInvites).not.toHaveBeenCalled();
  expect(await queuedTourInvitees(plan)).toEqual(['a']);
  prepare.mockResolvedValueOnce('drop' as never);
  await flushTourInvitesQueue();
  expect(await queuedTourInvitees(plan)).toEqual([]);
});

it('drops what the server refuses for good and keeps a server without invites yet', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue({ ok: false, error: 'unsupported', status: 404, retry: false });
  await enqueueTourInvite(plan, ['a']);
  await flushTourInvitesQueue();
  expect(await queuedTourInvitees(plan)).toEqual(['a']);
  jest.mocked(sendTourInvites).mockResolvedValue({ ok: false, error: 'ghost', status: 409, retry: false });
  await flushTourInvitesQueue();
  expect(await queuedTourInvitees(plan)).toEqual([]);
});

it('gives up after a week and survives malformed storage', async () => {
  jest.useFakeTimers({ now: Date.now() });
  jest.mocked(sendTourInvites).mockResolvedValue(offline);
  await enqueueTourInvite(plan, ['a']);
  jest.setSystemTime(Date.now() + 8 * 86400000);
  await flushTourInvitesQueue();
  expect(await queuedTourInvitees(plan)).toEqual([]);
  jest.useRealTimers();

  await AsyncStorage.setItem('na-pivo-tour-invites-queue', JSON.stringify([{ planId: plan, recipientIds: [] }, 'x', { planId: plan, recipientIds: ['a'], createdAt: new Date().toISOString() }]));
  expect(await queuedTourInvitees(plan)).toEqual(['a']);
  await AsyncStorage.setItem('na-pivo-tour-invites-queue', '{not json');
  expect(await queuedTourInvitees(plan)).toEqual([]);
});

it('forgets everything at an account boundary', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue(offline);
  await enqueueTourInvite(plan, ['a']);
  await clearTourInvitesQueue();
  expect(await queuedTourInvitees(plan)).toEqual([]);
});
