import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const submitAmenityVotes: jest.Mock = jest.fn(async (_votes?: unknown) => 'ok');
jest.mock('../pubAmenitiesClient', () => ({
  submitAmenityVotes: (...args: unknown[]) => submitAmenityVotes(...(args as [])),
}));

import {
  enqueueAmenityOp,
  flushPubAmenitiesQueue,
  getQueuedAmenityDeletes,
  clearPubAmenitiesQueue,
  type AmenityQueueItem,
} from '../pubAmenitiesQueue';
import type { WireAmenityVote } from '../pubAmenitiesClient';

const STORAGE_KEY = 'na-pivo-pub-amenities-queue';

function upsert(pubKey: string, amenityKey: string, over: Partial<WireAmenityVote> = {}): AmenityQueueItem {
  return {
    op: 'upsert',
    pubKey,
    amenityKey,
    payload: {
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
      amenity_key: amenityKey,
      value: 'yes',
      taxonomy_version: 1,
      client_updated_at: '2026-06-14T19:00:00.000Z',
      ...over,
    },
  };
}

function tombstone(pubKey: string, amenityKey: string, over: Partial<WireAmenityVote> = {}): AmenityQueueItem {
  return {
    op: 'delete',
    pubKey,
    amenityKey,
    payload: {
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
      amenity_key: amenityKey,
      value: null,
      taxonomy_version: 1,
      client_updated_at: '2026-06-14T20:00:00.000Z',
      ...over,
    },
  };
}

async function readQueue(): Promise<AmenityQueueItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  submitAmenityVotes.mockResolvedValue('ok');
  await AsyncStorage.clear();
  await clearPubAmenitiesQueue();
});

afterEach(async () => {
  // scheduleFlush() arms a debounced flush via a module-level timer handle.
  // flushPubAmenitiesQueue() cancels that timer AND resets the handle to null —
  // jest.clearAllTimers() does neither for a real timer, so the stale handle
  // would leak into the next test and make scheduleFlush's `if (_flushTimer)
  // return` guard silently skip arming a fresh flush.
  await flushPubAmenitiesQueue();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('enqueueAmenityOp — dedup per (pubKey, amenityKey)', () => {
  it('replaces a pending op for the same pair instead of appending', async () => {
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts', { value: 'yes' }));
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts', { value: 'no' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('upsert');
    expect((queue[0] as { payload: WireAmenityVote }).payload.value).toBe('no');
  });

  it('keeps sibling amenities at the same pub as separate items (NOT pubKey-only dedup)', async () => {
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await enqueueAmenityOp(upsert('aaaaaaaa', 'practical_wifi'));

    const queue = await readQueue();
    expect(queue).toHaveLength(2);
    expect(queue.map((i) => i.amenityKey).sort()).toEqual(['game_darts', 'practical_wifi']);
  });

  it('lets a delete supersede a queued upsert for the same pair', async () => {
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await enqueueAmenityOp(tombstone('aaaaaaaa', 'game_darts'));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('delete');
    expect((queue[0] as { payload: WireAmenityVote }).payload.value).toBeNull();
  });

  it('keeps distinct pubs separate', async () => {
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await enqueueAmenityOp(upsert('bbbbbbbb', 'game_darts'));
    const queue = await readQueue();
    expect(queue.map((i) => i.pubKey).sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('does not flush synchronously, then flushes when the debounce fires', async () => {
    jest.useFakeTimers();
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    // The debounce timer has not fired, so no delivery attempt yet.
    expect(submitAmenityVotes).not.toHaveBeenCalled();
    expect(await readQueue()).toHaveLength(1);

    // Fire the debounce AND drain the resulting flush microtask chain so the
    // delivery actually runs (the flush is a fire-and-forget async chain).
    await jest.advanceTimersByTimeAsync(250);
    expect(submitAmenityVotes).toHaveBeenCalledTimes(1);
  });
});

describe('getQueuedAmenityDeletes', () => {
  it('returns the dedupKeys of pending deletes only', async () => {
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await enqueueAmenityOp(tombstone('bbbbbbbb', 'practical_wifi'));
    const deletes = await getQueuedAmenityDeletes();
    expect(deletes.has('bbbbbbbb practical_wifi')).toBe(true);
    expect(deletes.has('aaaaaaaa game_darts')).toBe(false);
  });
});

describe('flushPubAmenitiesQueue', () => {
  it('delivers each queued op and clears the queue on success', async () => {
    submitAmenityVotes.mockResolvedValue('ok');
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await enqueueAmenityOp(upsert('aaaaaaaa', 'practical_wifi'));
    await flushPubAmenitiesQueue();
    expect(submitAmenityVotes).toHaveBeenCalledTimes(2);
    expect(await readQueue()).toEqual([]);
  });

  it('keeps ops that still need retrying', async () => {
    submitAmenityVotes.mockResolvedValue('retry');
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await enqueueAmenityOp(upsert('bbbbbbbb', 'practical_wifi'));
    await flushPubAmenitiesQueue();
    expect(await readQueue()).toHaveLength(2);

    submitAmenityVotes.mockResolvedValue('ok');
    await flushPubAmenitiesQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('drops a permanently-rejected op', async () => {
    submitAmenityVotes.mockResolvedValue('permanent-error');
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await flushPubAmenitiesQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('keeps only the ops that still need retrying when mixed', async () => {
    submitAmenityVotes.mockImplementation(async (votes: WireAmenityVote[]) =>
      votes[0]?.amenity_key === 'practical_wifi' ? 'retry' : 'ok',
    );
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts'));
    await enqueueAmenityOp(upsert('aaaaaaaa', 'practical_wifi'));
    await flushPubAmenitiesQueue();

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].amenityKey).toBe('practical_wifi');
  });

  it('keeps a pair whose op content changed mid-flush (content-signature preservation)', async () => {
    // The user re-taps the SAME (pubKey, amenityKey) WHILE a slow flush is in
    // flight. flushLocked re-loads the queue after delivery and must KEEP the
    // newer op even though the stale 'ok' said the old one settled. We simulate
    // the mid-flush write by replacing the persisted op during delivery (writing
    // AsyncStorage directly bypasses the mutex flushLocked is holding).
    await enqueueAmenityOp(upsert('aaaaaaaa', 'game_darts', { value: 'yes' }));
    submitAmenityVotes.mockImplementationOnce(async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([upsert('aaaaaaaa', 'game_darts', { value: 'no' })]),
      );
      return 'ok';
    });

    await flushPubAmenitiesQueue();

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect((queue[0] as { payload: WireAmenityVote }).payload.value).toBe('no');
  });

  it('does nothing on an empty queue', async () => {
    await flushPubAmenitiesQueue();
    expect(submitAmenityVotes).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushPubAmenitiesQueue()).resolves.toBeUndefined();
  });
});
