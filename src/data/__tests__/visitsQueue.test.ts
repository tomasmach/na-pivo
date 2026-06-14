import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const submitVisit = jest.fn(async () => 'ok');
const deleteVisit = jest.fn(async () => 'ok');
jest.mock('../visitsClient', () => ({
  submitVisit: (...args: unknown[]) => submitVisit(...(args as [])),
  deleteVisit: (...args: unknown[]) => deleteVisit(...(args as [])),
}));

import { enqueueVisitOp, flushVisitsQueue, type VisitQueueItem } from '../visitsQueue';
import type { VisitEntry } from '../visitsClient';

const STORAGE_KEY = 'na-pivo-visits-queue';

function entry(clientId: string, over: Partial<VisitEntry> = {}): VisitEntry {
  return {
    client_id: clientId,
    name: 'U Testu',
    lat: 50.08,
    lng: 14.42,
    started_at: '2026-06-14T19:00:00.000Z',
    ended_at: null,
    ...over,
  };
}

function upsert(clientId: string, over: Partial<VisitEntry> = {}): VisitQueueItem {
  return { op: 'upsert', clientId, entry: entry(clientId, over) };
}

async function readQueue(): Promise<VisitQueueItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  submitVisit.mockResolvedValue('ok');
  deleteVisit.mockResolvedValue('ok');
  await AsyncStorage.clear();
});

describe('enqueueVisitOp — dedup per client_id (last write wins)', () => {
  it('replaces a pending upsert for the same client_id (e.g. a bumped ended_at)', async () => {
    submitVisit.mockResolvedValue('retry');
    await enqueueVisitOp(upsert('v1', { ended_at: '2026-06-14T19:10:00.000Z' }));
    await enqueueVisitOp(upsert('v1', { ended_at: '2026-06-14T20:30:00.000Z' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect((queue[0] as { entry: VisitEntry }).entry.ended_at).toBe('2026-06-14T20:30:00.000Z');
  });

  it('lets a delete supersede a queued upsert for the same client_id', async () => {
    submitVisit.mockResolvedValue('retry');
    deleteVisit.mockResolvedValue('retry');
    await enqueueVisitOp(upsert('v1'));
    await enqueueVisitOp({ op: 'delete', clientId: 'v1' });

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('delete');
  });

  it('keeps distinct client_ids as separate items', async () => {
    submitVisit.mockResolvedValue('retry');
    await enqueueVisitOp(upsert('v1'));
    await enqueueVisitOp(upsert('v2'));
    const queue = await readQueue();
    expect(queue.map((i) => i.clientId).sort()).toEqual(['v1', 'v2']);
  });

  it('clears the queue once delivery succeeds', async () => {
    await enqueueVisitOp(upsert('v1'));
    expect(submitVisit).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('drops a permanently-rejected op', async () => {
    submitVisit.mockResolvedValue('permanent-error');
    await enqueueVisitOp(upsert('v1'));
    expect(await readQueue()).toEqual([]);
  });
});

describe('flushVisitsQueue', () => {
  it('re-sends queued ops once the backend recovers and clears the queue', async () => {
    submitVisit.mockResolvedValue('retry');
    await enqueueVisitOp(upsert('v1'));
    await enqueueVisitOp(upsert('v2'));
    expect(await readQueue()).toHaveLength(2);

    submitVisit.mockResolvedValue('ok');
    await flushVisitsQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('routes delete ops through deleteVisit', async () => {
    deleteVisit.mockResolvedValue('retry');
    await enqueueVisitOp({ op: 'delete', clientId: 'v1' });
    expect(deleteVisit).toHaveBeenCalledWith('v1');
  });

  it('does nothing on an empty queue', async () => {
    await flushVisitsQueue();
    expect(submitVisit).not.toHaveBeenCalled();
    expect(deleteVisit).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushVisitsQueue()).resolves.toBeUndefined();
  });
});
