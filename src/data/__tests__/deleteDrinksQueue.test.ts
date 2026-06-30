import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearDeleteDrinksQueue, enqueueDelete, flushDeleteDrinksQueue } from '../deleteDrinksQueue';
import { deleteDrink } from '../drinksClient';
import type { SubmitDrinkResult } from '../drinksClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// drinksClient → account → expo-secure-store; mock so requireActual loads.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../drinksClient', () => ({
  ...jest.requireActual('../drinksClient'),
  deleteDrink: jest.fn(async () => 'ok'),
}));

const STORAGE_KEY = 'na-pivo-delete-drinks-queue';

async function readQueue(): Promise<string[]> {
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
      await Promise.resolve();
    }
  }
  throw lastError;
}

beforeEach(async () => {
  jest.clearAllMocks();
  (deleteDrink as jest.Mock).mockResolvedValue('ok');
  await AsyncStorage.clear();
});

describe('enqueueDelete', () => {
  it('sends the deletion and drops it from the queue on success', async () => {
    await enqueueDelete('a');
    expect(deleteDrink).toHaveBeenCalledWith('a');
    expect(await readQueue()).toEqual([]);
  });

  it('keeps the id queued when the deletion must retry', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDelete('a');
    expect(await readQueue()).toEqual(['a']);
  });

  it('drops a permanently-rejected deletion from the queue', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('permanent-error');
    await enqueueDelete('a');
    expect(await readQueue()).toEqual([]);
  });

  it('dedupes the same client_id (no double queueing)', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDelete('a');
    await enqueueDelete('a');
    expect(await readQueue()).toEqual(['a']);
  });
});

describe('flushDeleteDrinksQueue', () => {
  it('retries every queued deletion and removes the ones that succeed', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDelete('a');
    await enqueueDelete('b');
    expect(await readQueue()).toEqual(['a', 'b']);

    // Now the backend is reachable again → both delete and the queue empties.
    (deleteDrink as jest.Mock).mockResolvedValue('ok');
    await flushDeleteDrinksQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('is a no-op on an empty queue and never throws', async () => {
    await expect(flushDeleteDrinksQueue()).resolves.toBeUndefined();
    expect(deleteDrink).not.toHaveBeenCalled();
  });

  it('persists a newer delete while an older delivery is still in flight', async () => {
    let resolveDelete!: (value: SubmitDrinkResult) => void;
    // Every send retries so the trailing flush keeps both ids queued (the point
    // here is that the mid-flight enqueue is not clobbered).
    (deleteDrink as jest.Mock).mockResolvedValue('retry');
    (deleteDrink as jest.Mock).mockReturnValueOnce(
      new Promise<SubmitDrinkResult>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    const first = enqueueDelete('a');
    await waitForExpectation(() => expect(deleteDrink).toHaveBeenCalledTimes(1));

    const second = enqueueDelete('b');
    await waitForExpectation(async () => {
      expect(await readQueue()).toContain('b');
    });

    resolveDelete('retry');
    await first;
    await second;
    expect(await readQueue()).toEqual(['a', 'b']);
  });

  it('keeps the queue cleared when clear runs during an in-flight flush', async () => {
    let resolveDelete!: (value: SubmitDrinkResult) => void;
    (deleteDrink as jest.Mock).mockReturnValueOnce(
      new Promise<SubmitDrinkResult>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(['a']));

    const flushing = flushDeleteDrinksQueue();
    await waitForExpectation(() => expect(deleteDrink).toHaveBeenCalledTimes(1));
    await clearDeleteDrinksQueue();
    expect(await readQueue()).toEqual([]);

    resolveDelete('retry');
    await flushing;
    expect(await readQueue()).toEqual([]);
  });

  it('runs exactly one trailing pass for a flush requested mid-flight', async () => {
    let resolveDelete!: (value: SubmitDrinkResult) => void;
    (deleteDrink as jest.Mock)
      .mockReturnValueOnce(
        new Promise<SubmitDrinkResult>((resolve) => {
          resolveDelete = resolve;
        }),
      )
      .mockResolvedValue('retry');
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(['a']));

    const first = flushDeleteDrinksQueue();
    const second = flushDeleteDrinksQueue();
    await waitForExpectation(() => expect(deleteDrink).toHaveBeenCalledTimes(1));
    // While the first pass is in flight, no second concurrent pass starts.
    expect(deleteDrink).toHaveBeenCalledTimes(1);

    resolveDelete('retry');
    await first;
    await second;
    // The mid-flight caller scheduled exactly one trailing pass — not zero (so a
    // mid-flush enqueue is retried) and not more than one (no busy loop).
    expect(deleteDrink).toHaveBeenCalledTimes(2);
    expect(await readQueue()).toEqual(['a']);
  });
});
