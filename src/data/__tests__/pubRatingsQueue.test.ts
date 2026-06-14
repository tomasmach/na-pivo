import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const submitRatingUpsert: jest.Mock = jest.fn(async (_payload?: unknown) => 'ok');
const submitRatingDelete: jest.Mock = jest.fn(async (_pubKey?: unknown) => 'ok');
jest.mock('../pubRatingsClient', () => ({
  submitRatingUpsert: (...args: unknown[]) => submitRatingUpsert(...(args as [])),
  submitRatingDelete: (...args: unknown[]) => submitRatingDelete(...(args as [])),
}));

import {
  enqueueRatingOp,
  flushPubRatingsQueue,
  type RatingQueueItem,
} from '../pubRatingsQueue';
import type { WireRatingUpsert } from '../pubRatingsClient';

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

async function readQueue(): Promise<RatingQueueItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  submitRatingUpsert.mockResolvedValue('ok');
  submitRatingDelete.mockResolvedValue('ok');
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
    submitRatingDelete.mockResolvedValue('retry');
    await enqueueRatingOp(upsert('aaaaaaaa'));
    await enqueueRatingOp({ op: 'delete', pubKey: 'aaaaaaaa' });

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('delete');
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
    expect(submitRatingDelete).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushPubRatingsQueue()).resolves.toBeUndefined();
  });
});
