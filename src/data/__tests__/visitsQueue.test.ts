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

import {
  clearVisitsQueue,
  enqueueVisitOp,
  flushVisitsQueue,
  type VisitQueueItem,
} from '../visitsQueue';
import type { SubmitVisitResult, VisitEntry } from '../visitsClient';

const STORAGE_KEY = 'na-pivo-visits-queue';

function entry(clientId: string, over: Partial<VisitEntry> = {}): VisitEntry {
  return {
    client_id: clientId,
    name: 'U Testu',
    lat: 50.08,
    lng: 14.42,
    started_at: '2026-06-14T19:00:00.000Z',
    ended_at: null,
    updated_at: '2026-06-14T19:00:00.000Z',
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

async function waitForExpectation(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      // Queue delivery now acquires the process-wide private-account lease
      // before entering the queue-local lock. Yield the event loop instead of
      // relying on a fixed number of promise turns inside that implementation.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw lastError;
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

  it('persists a newer enqueue while an older delivery is still in flight', async () => {
    let resolveSubmit!: (value: SubmitVisitResult) => void;
    // Every send retries so the trailing flush keeps both ops queued (the point
    // here is that the mid-flight enqueue is not clobbered).
    submitVisit.mockResolvedValue('retry');
    submitVisit.mockReturnValueOnce(
      new Promise<SubmitVisitResult>((resolve) => {
        resolveSubmit = resolve;
      }),
    );

    const first = enqueueVisitOp(upsert('v1'));
    await waitForExpectation(() => expect(submitVisit).toHaveBeenCalledTimes(1));

    const second = enqueueVisitOp(upsert('v2'));
    await waitForExpectation(async () => {
      const queuedIds = (await readQueue()).map((item) => item.clientId);
      expect(queuedIds).toContain('v2');
    });

    resolveSubmit('retry');
    await first;
    await second;
    expect((await readQueue()).map((item) => item.clientId).sort()).toEqual(['v1', 'v2']);
  });

  it('keeps a newer operation for the same client_id when an older in-flight op settles', async () => {
    let resolveSubmit!: (value: SubmitVisitResult) => void;
    // The trailing flush re-attempts but retries, so the newer op stays queued
    // (the point here is that the stale in-flight result does not clobber it).
    submitVisit.mockResolvedValue('retry');
    submitVisit.mockReturnValueOnce(
      new Promise<SubmitVisitResult>((resolve) => {
        resolveSubmit = resolve;
      }),
    );

    const first = enqueueVisitOp(upsert('v1', { ended_at: '2026-06-14T19:10:00.000Z' }));
    await waitForExpectation(() => expect(submitVisit).toHaveBeenCalledTimes(1));

    const second = enqueueVisitOp(upsert('v1', { ended_at: '2026-06-14T20:30:00.000Z' }));
    await waitForExpectation(async () => {
      const queue = await readQueue();
      expect((queue[0] as { entry: VisitEntry }).entry.ended_at).toBe('2026-06-14T20:30:00.000Z');
    });

    resolveSubmit('ok');
    await first;
    await second;

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect((queue[0] as { entry: VisitEntry }).entry.ended_at).toBe('2026-06-14T20:30:00.000Z');
  });

  it('keeps the queue cleared when clear runs during an in-flight flush', async () => {
    let resolveSubmit!: (value: SubmitVisitResult) => void;
    submitVisit.mockReturnValueOnce(
      new Promise<SubmitVisitResult>((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([upsert('v1')]));

    const flushing = flushVisitsQueue();
    await waitForExpectation(() => expect(submitVisit).toHaveBeenCalledTimes(1));
    await clearVisitsQueue();
    expect(await readQueue()).toEqual([]);

    resolveSubmit('ok');
    await flushing;
    expect(await readQueue()).toEqual([]);
  });

  it('does not deliver remaining items after clear runs during an in-flight flush', async () => {
    // Account boundary (logout / delete account) clears the queue while a launch
    // flush is mid-delivery. v1 is already in flight under the previous account;
    // v2 must NOT be POSTed afterwards — otherwise it goes out under whatever
    // session replaces this one, attributing the old account's visit to the new.
    let resolveFirst!: (value: SubmitVisitResult) => void;
    submitVisit.mockReturnValueOnce(
      new Promise<SubmitVisitResult>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([upsert('v1'), upsert('v2')]));

    const flushing = flushVisitsQueue();
    await waitForExpectation(() => expect(submitVisit).toHaveBeenCalledTimes(1));

    await clearVisitsQueue();
    resolveFirst('ok');
    await flushing;

    expect(submitVisit).toHaveBeenCalledTimes(1);
    expect((submitVisit as jest.Mock).mock.calls[0][0]).toMatchObject({ client_id: 'v1' });
    expect(await readQueue()).toEqual([]);
  });

  it('runs exactly one trailing pass for a flush requested mid-flight', async () => {
    let resolveSubmit!: (value: SubmitVisitResult) => void;
    submitVisit
      .mockReturnValueOnce(
        new Promise<SubmitVisitResult>((resolve) => {
          resolveSubmit = resolve;
        }),
      )
      .mockResolvedValue('retry');
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([upsert('v1')]));

    const first = flushVisitsQueue();
    const second = flushVisitsQueue();
    await waitForExpectation(() => expect(submitVisit).toHaveBeenCalledTimes(1));
    // While the first pass is in flight, no second concurrent pass starts.
    expect(submitVisit).toHaveBeenCalledTimes(1);

    resolveSubmit('retry');
    await first;
    await second;
    // The mid-flight caller scheduled exactly one trailing pass — not zero (so a
    // mid-flush enqueue is retried) and not more than one (no busy loop).
    expect(submitVisit).toHaveBeenCalledTimes(2);
    expect((await readQueue()).map((item) => item.clientId)).toEqual(['v1']);
  });
});
