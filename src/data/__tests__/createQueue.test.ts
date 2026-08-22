import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createCoalescingFlush,
  createQueueStorage,
  QueueStorageReadError,
} from '../createQueue';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type Item = { id: string };

const isItem = (value: unknown): value is Item =>
  typeof value === 'object' && value !== null && typeof (value as Item).id === 'string';

describe('createQueue storage read errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.clear();
  });

  test('wraps a failing getItem into QueueStorageReadError on first load', async () => {
    const storage = createQueueStorage<Item>('test-queue-key', isItem);
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(storage.load()).rejects.toBeInstanceOf(QueueStorageReadError);

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  test('returns a defensive copy of the last validated snapshot after a later read failure', async () => {
    const storage = createQueueStorage<Item>('cached-queue', isItem);
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockResolvedValueOnce(JSON.stringify([{ id: 'old' }]))
      .mockRejectedValueOnce(new Error('storage unavailable'));

    const first = await storage.load();
    expect(first).toEqual([{ id: 'old' }]);

    const second = await storage.load();
    expect(second).toEqual([{ id: 'old' }]);
    expect(second).not.toBe(first);

    second.push({ id: 'mutated' });

    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('storage unavailable again'));

    const third = await storage.load();
    expect(third).toEqual([{ id: 'old' }]);
  });

  test('preserves a retry item when the reconcile read fails', async () => {
    const storage = createQueueStorage<Item>('flush-reconcile', isItem);
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockResolvedValueOnce(JSON.stringify([{ id: 'pending' }]))
      .mockRejectedValueOnce(new Error('storage unavailable'));

    const snapshot = await storage.load();

    const deliveredOrDropped = new Set<string>();

    const current = await storage.load();
    const remaining = current.filter((item) => !deliveredOrDropped.has(item.id));
    await storage.save(remaining);

    expect(snapshot).toEqual([{ id: 'pending' }]);
    expect(remaining).toEqual([{ id: 'pending' }]);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'flush-reconcile',
      JSON.stringify([{ id: 'pending' }]),
    );
  });

  test('keeps malformed JSON and invalid entries non-fatal', async () => {
    const storage = createQueueStorage<Item>('malformed-queue', isItem);
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockResolvedValueOnce('not-json');

    await expect(storage.load()).resolves.toEqual([]);

    const validatingStorage = createQueueStorage<Item>('invalid-entries-queue', isItem);
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockResolvedValueOnce(
        JSON.stringify([{ id: 'valid' }, { nope: true }, null]),
      );

    expect(await validatingStorage.load()).toEqual([{ id: 'valid' }]);
  });

  test('treats a cold queue read failure as a reusable no-op flush', async () => {
    const run = jest.fn(async () => {
      throw new QueueStorageReadError();
    });
    const { flush } = createCoalescingFlush(run, {
      protectPrivateAccount: false,
    });

    const first = flush();
    const coalesced = flush();
    await expect(first).resolves.toBeUndefined();
    await expect(coalesced).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(2);

    await expect(flush()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
