import { shareFriendPubActivity } from '@/data/friendsClient';
import { dropQueuedTourPings, enqueueFriendOp, friendsQueueIdle } from '@/data/friendsQueue';
import { pingRecipients, pingStop, sendPing } from '../crewPing';
import type { TourStop } from '../model';

jest.mock('@/data/account', () => ({ generateUuidV4: () => '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab' }));
jest.mock('@/data/friendsClient', () => ({ shareFriendPubActivity: jest.fn(), fetchFriendsDashboard: jest.fn() }));
jest.mock('@/data/friendsQueue', () => ({
  enqueueFriendOp: jest.fn(async () => undefined),
  dropQueuedTourPings: jest.fn(async () => undefined),
  friendsQueueIdle: jest.fn(async () => undefined),
  isRetriableFriendError: (result: { code: string }) => result.code === 'offline',
}));
jest.mock('@/data/friendsSnapshot', () => ({ loadFriendsDashboardSnapshot: jest.fn() }));

const stop = (id: string, name: string, pubId = `canonical-${id}`): TourStop => ({ id, pubId, cacheKey: null, name, address: '', lat: 50.08, lon: 14.42 });
const stops = [stop('a', 'U Pinkasů'), stop('b', 'U Medvídků'), stop('c', 'U Zlatého tygra')];
const run = (statuses: Record<string, 'visited' | 'skipped'>) => ({ snapshot: { title: 'Pivní okruh', stops } as never, statuses });

beforeEach(() => jest.clearAllMocks());

it('points friends at the last pub checked off, or the one the crew walks to', () => {
  expect(pingStop(run({}))).toEqual({ stop: stops[0], heading: true });
  expect(pingStop(run({ a: 'visited', b: 'skipped' }))).toEqual({ stop: stops[0], heading: false });
  expect(pingStop(run({ a: 'visited', b: 'visited' }))?.stop.name).toBe('U Medvídků');
  expect(pingStop(run({ a: 'skipped' }))).toEqual({ stop: stops[1], heading: true });
  expect(pingStop(run({ a: 'skipped', b: 'skipped', c: 'skipped' }))).toBeNull();
});

it('leaves out friends already walking and keeps the plain audience when nobody is left out', () => {
  expect(pingRecipients(['pepa', 'eva', 'karel'], ['me', 'pepa'])).toEqual(['eva', 'karel']);
  expect(pingRecipients(['eva'], ['me'])).toBeUndefined();
  expect(pingRecipients(['pepa'], ['me', 'pepa'])).toEqual([]);
});

it('sends the tour with the pub, and waits for signal instead of losing it', async () => {
  const longId = `directory:u2fkbnhu:${'u pinkasu '.repeat(14)}`;
  jest.mocked(shareFriendPubActivity).mockResolvedValue({ ok: true });
  expect(await sendPing('Pivní okruh', { stop: stop('a', 'U Pinkasů', longId), heading: false }, ['eva'])).toEqual({ status: 'sent', clientId: '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab' });
  const [pub, message, , recipients, , tour] = jest.mocked(shareFriendPubActivity).mock.calls[0];
  // The server caps the pub id at 128 characters and would drop the ping for good.
  expect(pub).toMatchObject({ id: '', name: 'U Pinkasů', lat: 50.08, lng: 14.42 });
  expect(message).toBe('Tour de pub: Pivní okruh');
  expect(recipients).toEqual(['eva']);
  expect(tour).toEqual({ title: 'Pivní okruh', heading: false });

  jest.mocked(shareFriendPubActivity).mockResolvedValue({ ok: false, code: 'offline', detail: '' });
  expect(await sendPing('Pivní okruh', { stop: stops[1], heading: true })).toMatchObject({ status: 'queued' });
  expect(jest.mocked(enqueueFriendOp).mock.calls[0][0]).toMatchObject({ op: 'activity', payload: { pub: { id: 'canonical-b' }, tour: { heading: true } } });

  jest.mocked(shareFriendPubActivity).mockResolvedValue({ ok: false, code: 'no_recipients', detail: 'Nikdo z party.' });
  expect(await sendPing('Pivní okruh', { stop: stops[1], heading: true })).toEqual({ error: 'Nikdo z party.' });
});

it('lets a newer ping replace the waiting one and never widens to the whole party', async () => {
  jest.mocked(shareFriendPubActivity).mockResolvedValue({ ok: true });
  await sendPing('Pivní okruh', { stop: { ...stops[1], name: 'U '.repeat(150) }, heading: false });
  // Whatever still waits for signal gives way before this one goes out.
  expect(dropQueuedTourPings).toHaveBeenCalled();
  expect(jest.mocked(dropQueuedTourPings).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(friendsQueueIdle).mock.invocationCallOrder[0]);
  expect(jest.mocked(friendsQueueIdle).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(shareFriendPubActivity).mock.invocationCallOrder[0]);
  expect(jest.mocked(shareFriendPubActivity).mock.calls[0][0].name).toHaveLength(200);
  jest.mocked(shareFriendPubActivity).mockClear();
  expect(await sendPing('Pivní okruh', { stop: stops[1], heading: false }, [])).toHaveProperty('error');
  expect(shareFriendPubActivity).not.toHaveBeenCalled();
});
