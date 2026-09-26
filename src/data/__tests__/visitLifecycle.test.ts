import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
let uuid = 0;
jest.mock('../account', () => ({ generateUuidV4: () => `visit-${++uuid}` }));
const submitVisit = jest.fn(async (_entry: unknown, _signal?: AbortSignal) => 'retry');
jest.mock('../visitsClient', () => ({
  submitVisit: (entry: unknown, signal?: AbortSignal) => submitVisit(entry, signal),
  deleteVisit: jest.fn(async () => 'ok'),
}));
const shareFriendPubActivity = jest.fn(async (..._args: unknown[]) => ({ ok: false, code: 'network', detail: '' }));
jest.mock('../friendsClient', () => ({
  shareFriendPubActivity: (...args: unknown[]) => shareFriendPubActivity(...args),
  createFriendPlan: jest.fn(async () => ({ ok: false, code: 'network', detail: '' })),
}));

import { IDLE_TIMEOUT_MS, useTallyStore } from '@/stores/tallyStore';
import { geohash8 } from '../geohash';
import { clearVisitsQueue, flushVisitsQueue } from '../visitsQueue';
import { buildVisitEntry, syncVisit } from '../visitsSync';
import { clearFriendsQueue, enqueueFriendOp, flushFriendsQueue } from '../friendsQueue';
import type { Pub } from '../pubs';

const pub = { pubKey: geohash8(50.08, 14.42), pubName: 'Testovací hospoda' };
const startedAt = '2026-09-19T17:00:00.000Z';
const closedAt = '2026-09-19T18:00:00.000Z';
const broadcastPub: Pub = { id: 'test', name: pub.pubName, lat: 50.08, lng: 14.42 };

beforeEach(async () => {
  await clearVisitsQueue();
  await clearFriendsQueue();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(closedAt));
  submitVisit.mockResolvedValue('retry');
  useTallyStore.setState({ current: null, history: [] });
});

afterEach(() => jest.restoreAllMocks());

it('Dopito queues a durable closure instead of leaving the visit open', async () => {
  useTallyStore.getState().addDrink(pub, { id: 'beer-1', beerName: 'Plzeň', at: startedAt });
  const clientId = useTallyStore.getState().current!.clientId;
  syncVisit(useTallyStore.getState().current);
  await flushVisitsQueue();

  useTallyStore.getState().archiveCurrent('manual');
  await flushVisitsQueue();

  const persisted = JSON.parse((await AsyncStorage.getItem('na-pivo-visits-queue'))!);
  expect(persisted).toEqual([expect.objectContaining({
    clientId,
    entry: expect.objectContaining({ closed_at: closedAt, ended_at: startedAt, updated_at: closedAt }),
  })]);
  expect(useTallyStore.getState().current).toBeNull();

  submitVisit.mockResolvedValue('ok');
  await flushVisitsQueue();
  expect(submitVisit).toHaveBeenLastCalledWith(
    expect.objectContaining({ client_id: clientId, closed_at: closedAt }),
    expect.any(AbortSignal),
  );
  expect(await AsyncStorage.getItem('na-pivo-visits-queue')).toBeNull();
});

it('keeps the closure after rehydrating and starts a separate visit on return', async () => {
  useTallyStore.getState().addDrink(pub, { id: 'beer-1', beerName: 'Plzeň', at: startedAt });
  useTallyStore.getState().archiveCurrent('manual');
  await flushVisitsQueue();
  const persisted = await AsyncStorage.getItem('na-pivo-tally');
  const firstId = useTallyStore.getState().history[0].clientId;
  useTallyStore.setState({ current: null, history: [] });
  await AsyncStorage.setItem('na-pivo-tally', persisted!);
  await useTallyStore.persist.rehydrate();
  expect(buildVisitEntry(useTallyStore.getState().history[0])?.closed_at).toBe(closedAt);
  expect(useTallyStore.getState().resumeLast(pub.pubKey)).toBe(false);

  useTallyStore.getState().addDrink(pub, {
    id: 'beer-2', beerName: 'Plzeň', at: '2026-09-19T18:30:00.000Z',
  });
  syncVisit(useTallyStore.getState().current);
  await flushVisitsQueue();
  const queue = JSON.parse((await AsyncStorage.getItem('na-pivo-visits-queue'))!);
  expect(queue).toHaveLength(2);
  expect(queue[0].entry).toMatchObject({ client_id: firstId, closed_at: closedAt });
  expect(queue[1].entry).toMatchObject({ closed_at: null });
  expect(queue[1].clientId).not.toBe(firstId);
});

it('reopens the same timed-out visit with a newer revision and can keep counting', async () => {
  useTallyStore.getState().addDrink(pub, { id: 'beer-1', beerName: 'Plzeň', at: startedAt });
  const id = useTallyStore.getState().current!.clientId;
  const timeout = Date.parse(startedAt) + IDLE_TIMEOUT_MS;
  expect(useTallyStore.getState().maybeAutoArchive(timeout)).toBe(true);
  await flushVisitsQueue();
  expect(submitVisit).toHaveBeenLastCalledWith(
    expect.objectContaining({ client_id: id, closed_at: new Date(timeout).toISOString() }),
    expect.any(AbortSignal),
  );

  const resumedAt = new Date(timeout + 60_000).toISOString();
  expect(useTallyStore.getState().resumeLast(pub.pubKey, Date.parse(resumedAt))).toBe(true);
  await flushVisitsQueue();
  expect(submitVisit).toHaveBeenLastCalledWith(
    expect.objectContaining({ client_id: id, closed_at: null, updated_at: resumedAt }),
    expect.any(AbortSignal),
  );

  const laterDrink = new Date(timeout + 120_000).toISOString();
  useTallyStore.getState().addDrink(pub, { id: 'beer-2', beerName: 'Plzeň', at: laterDrink });
  expect(buildVisitEntry(useTallyStore.getState().current!)?.updated_at).toBe(laterDrink);
});

it('closes the previous pub when the counter moves to another pub', async () => {
  useTallyStore.getState().addDrink(pub, { id: 'beer-1', beerName: 'Plzeň', at: startedAt });
  const id = useTallyStore.getState().current!.clientId;
  useTallyStore.getState().addDrink({ pubKey: geohash8(50.09, 14.43), pubName: 'Druhá hospoda' }, {
    id: 'beer-2', beerName: 'Plzeň', at: closedAt,
  });
  await flushVisitsQueue();
  expect(submitVisit).toHaveBeenLastCalledWith(
    expect.objectContaining({ client_id: id, closed_at: closedAt }),
    expect.any(AbortSignal),
  );
});

it('never syncs a private outside evening as pub presence', async () => {
  useTallyStore.getState().addDrink({ pubKey: 'ctx:private', pubName: 'Doma' }, {
    id: 'beer-1', beerName: 'Plzeň', at: startedAt,
  });
  useTallyStore.getState().archiveCurrent('manual');
  await flushVisitsQueue();
  expect(submitVisit).not.toHaveBeenCalled();
});

it('Dopito discards offline broadcasts and delayed retries without blocking a new evening', async () => {
  useTallyStore.getState().addDrink(pub, { id: 'beer-1', beerName: 'Plzeň', at: startedAt });
  const clientId = useTallyStore.getState().current!.clientId;
  const item = { op: 'activity' as const, clientId, payload: { pub: broadcastPub, startedAt } };
  await enqueueFriendOp(item);
  expect(await AsyncStorage.getItem('na-pivo-friends-queue')).not.toBeNull();
  expect(shareFriendPubActivity).toHaveBeenCalledTimes(1);

  useTallyStore.getState().archiveCurrent('manual');
  await flushVisitsQueue();
  await flushFriendsQueue();
  expect(await AsyncStorage.getItem('na-pivo-friends-queue')).toBeNull();
  // A direct request can time out only after Dopito has already run.
  await enqueueFriendOp(item);
  expect(shareFriendPubActivity).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem('na-pivo-friends-queue')).toBeNull();
  // A legacy queue recovered on launch may predate the timestamp field.
  await AsyncStorage.setItem('na-pivo-friends-queue', JSON.stringify([
    { op: 'activity', clientId: 'legacy-compose', payload: { pub: broadcastPub } },
  ]));
  await flushFriendsQueue();
  expect(shareFriendPubActivity).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem('na-pivo-friends-queue')).toBeNull();

  const returnedAt = '2026-09-19T18:30:00.000Z';
  useTallyStore.getState().addDrink(pub, { id: 'beer-2', beerName: 'Plzeň', at: returnedAt });
  await enqueueFriendOp({
    op: 'activity', clientId: useTallyStore.getState().current!.clientId,
    payload: { pub: broadcastPub, startedAt: returnedAt },
  });
  expect(shareFriendPubActivity).toHaveBeenCalledTimes(2);
  expect(shareFriendPubActivity).toHaveBeenLastCalledWith(
    broadcastPub, undefined, useTallyStore.getState().current!.clientId, undefined, returnedAt, undefined,
  );
});

it('keeps a future plan and a later broadcast when a previous visit closure is retried', async () => {
  await AsyncStorage.setItem('na-pivo-friends-queue', JSON.stringify([
    { op: 'activity', clientId: 'old-live', payload: { pub: broadcastPub } },
    { op: 'activity', clientId: 'due-plan', payload: { pub: broadcastPub, scheduledFor: '2026-09-19T17:30:00.000Z' } },
    { op: 'activity', clientId: 'plan', payload: { pub: broadcastPub, scheduledFor: '2026-09-20T18:00:00.000Z' } },
    { op: 'activity', clientId: 'new-live', payload: { pub: broadcastPub, startedAt: '2026-09-19T18:30:00.000Z' } },
  ]));
  useTallyStore.getState().addDrink(pub, { id: 'beer-1', beerName: 'Plzeň', at: startedAt });
  useTallyStore.getState().archiveCurrent('manual');
  await flushVisitsQueue();
  const queue = JSON.parse((await AsyncStorage.getItem('na-pivo-friends-queue'))!);
  expect(queue.map((item: { clientId: string }) => item.clientId)).toEqual(['plan', 'new-live']);
  await enqueueFriendOp({
    op: 'activity', clientId: 'late-plan',
    payload: { pub: broadcastPub, scheduledFor: '2026-09-19T17:30:00.000Z' },
  });
  const afterRetry = JSON.parse((await AsyncStorage.getItem('na-pivo-friends-queue'))!);
  expect(afterRetry.some((item: { clientId: string }) => item.clientId === 'late-plan')).toBe(false);
});
