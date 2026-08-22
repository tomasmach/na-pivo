import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  enqueueRatingOp,
  flushPubRatingsQueue,
  type RatingQueueItem,
} from '../pubRatingsQueue';
import type { WireRatingUpsert } from '../pubRatingsClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const submitRatingUpsert: jest.Mock = jest.fn(async (_payload?: unknown) => 'ok');
jest.mock('../pubRatingsClient', () => ({
  submitRatingUpsert: (...args: unknown[]) => submitRatingUpsert(...(args as [])),
}));

const STORAGE_KEY = 'na-pivo-pub-ratings-queue';

function upsert(pubKey: string, over: Partial<WireRatingUpsert> = {}): RatingQueueItem {
  return {
    op: 'upsert',
    pubKey,
    payload: {
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
      verdict: 'like',
      tag: null,
      note: null,
      updated_at: '2026-06-14T19:00:00.000Z',
      ...over,
    },
  };
}

function tombstone(pubKey: string, over: Partial<WireRatingUpsert> = {}): RatingQueueItem {
  return {
    op: 'delete',
    pubKey,
    payload: {
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
      verdict: null,
      tag: null,
      note: null,
      updated_at: '2026-06-14T20:00:00.000Z',
      ...over,
    },
  };
}

async function readQueue(): Promise<RatingQueueItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  submitRatingUpsert.mockResolvedValue('ok');
  await AsyncStorage.clear();
});

describe('enqueueRatingOp — dedup per pubKey (last write wins)', () => {
  it('replaces a pending op for the same pubKey instead of appending', async () => {
    submitRatingUpsert.mockResolvedValue('retry');
    await enqueueRatingOp(upsert('aaaaaaaa', { verdict: 'like' }));
    await enqueueRatingOp(upsert('aaaaaaaa', { verdict: 'dislike' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('upsert');
    expect((queue[0] as { payload: WireRatingUpsert }).payload.verdict).toBe('dislike');
  });

  it('lets a delete supersede a queued upsert for the same pubKey', async () => {
    submitRatingUpsert.mockResolvedValue('retry');
    await enqueueRatingOp(upsert('aaaaaaaa'));
    await enqueueRatingOp(tombstone('aaaaaaaa'));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('delete');
    expect((queue[0] as { payload: WireRatingUpsert }).payload.updated_at).toBe(
      '2026-06-14T20:00:00.000Z',
    );
  });

  it('keeps distinct pubKeys as separate items', async () => {
    submitRatingUpsert.mockResolvedValue('retry');
    await enqueueRatingOp(upsert('aaaaaaaa'));
    await enqueueRatingOp(upsert('bbbbbbbb'));
    const queue = await readQueue();
    expect(queue.map((i) => i.pubKey).sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('clears the queue once delivery succeeds', async () => {
    await enqueueRatingOp(upsert('aaaaaaaa'));
    expect(submitRatingUpsert).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('drops a permanently-rejected op', async () => {
    submitRatingUpsert.mockResolvedValue('permanent-error');
    await enqueueRatingOp(upsert('aaaaaaaa'));
    expect(await readQueue()).toEqual([]);
  });

  it('persists a new rating while an older flush is waiting on the network', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([upsert('aaaaaaaa')]));
    let release!: () => void;
    submitRatingUpsert
      .mockReturnValueOnce(new Promise((resolve) => { release = () => resolve('retry'); }))
      .mockResolvedValue('retry');

    const flushing = flushPubRatingsQueue();
    await flushMicrotasks();
    const enqueueing = enqueueRatingOp(upsert('bbbbbbbb'));
    await flushMicrotasks();

    expect((await readQueue()).map((item) => item.pubKey)).toContain('bbbbbbbb');
    release();
    await Promise.all([flushing, enqueueing]);
  });

  it('does not evict an older offline rating when the former cap is reached', async () => {
    const queued = Array.from({ length: 500 }, (_, index) => upsert(`pub-${index}`));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queued));
    submitRatingUpsert.mockResolvedValue('retry');

    await enqueueRatingOp(upsert('pub-500'));

    expect(await readQueue()).toHaveLength(501);
    expect((await readQueue()).some((item) => item.pubKey === 'pub-0')).toBe(true);
  });
});

describe('flushPubRatingsQueue', () => {
  it('re-sends queued ops once the backend recovers and clears the queue', async () => {
    submitRatingUpsert.mockResolvedValue('retry');
    await enqueueRatingOp(upsert('aaaaaaaa'));
    await enqueueRatingOp(upsert('bbbbbbbb'));
    expect(await readQueue()).toHaveLength(2);

    submitRatingUpsert.mockResolvedValue('ok');
    await flushPubRatingsQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('keeps only the ops that still need retrying', async () => {
    submitRatingUpsert.mockResolvedValue('retry');
    await enqueueRatingOp(upsert('aaaaaaaa'));
    await enqueueRatingOp(upsert('bbbbbbbb'));

    submitRatingUpsert.mockImplementation(async (p: WireRatingUpsert) =>
      p?.name === 'keep' ? 'retry' : 'ok',
    );
    await enqueueRatingOp(upsert('bbbbbbbb', { name: 'keep' }));
    await flushPubRatingsQueue();

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].pubKey).toBe('bbbbbbbb');
  });

  it('does nothing on an empty queue', async () => {
    await flushPubRatingsQueue();
    expect(submitRatingUpsert).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushPubRatingsQueue()).resolves.toBeUndefined();
  });
});
