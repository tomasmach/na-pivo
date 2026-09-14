import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearUpdateDrinksQueue,
  enqueueDrinkUpdate,
  flushUpdateDrinksQueue,
  removeQueuedDrinkUpdate,
  type DrinkUpdateEntry,
} from '../updateDrinksQueue';
import { updateDrinkName } from '../drinksClient';
import type { SubmitDrinkResult } from '../drinksClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../drinksClient', () => ({
  ...jest.requireActual('../drinksClient'),
  updateDrinkName: jest.fn(async () => 'ok'),
}));

const STORAGE_KEY = 'na-pivo-update-drinks-queue';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

async function readQueue(): Promise<DrinkUpdateEntry[]> {
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
      // Queue delivery acquires the process-wide private-account lease before
      // entering the queue-local lock. Yield the event loop instead of relying
      // on a fixed number of promise turns inside that implementation.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw lastError;
}

beforeEach(async () => {
  jest.clearAllMocks();
  (updateDrinkName as jest.Mock).mockResolvedValue('ok');
  await AsyncStorage.clear();
});

describe('enqueueDrinkUpdate', () => {
  it('reports a storage failure and never sends a non-durable update', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Kozel' }),
    ).resolves.toBe('storage-error');

    expect(updateDrinkName).not.toHaveBeenCalled();
  });

  it('sends the update and drops it from the queue on success', async () => {
    await enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Kozel' });
    expect(updateDrinkName).toHaveBeenCalledWith(UUID_A, 'Kozel');
    expect(await readQueue()).toEqual([]);
  });

  it('keeps the latest name queued when the update must retry', async () => {
    (updateDrinkName as jest.Mock).mockResolvedValue('retry');
    await enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Plzen' });
    await enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Plzeň' });
    expect(await readQueue()).toEqual([{ client_id: UUID_A, beer_name: 'Plzeň' }]);
  });

  it('drops a permanently-rejected update from the queue', async () => {
    (updateDrinkName as jest.Mock).mockResolvedValue('permanent-error');
    await enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Kozel' });
    expect(await readQueue()).toEqual([]);
  });
});

describe('removeQueuedDrinkUpdate', () => {
  it('removes a pending update without sending it again', async () => {
    (updateDrinkName as jest.Mock).mockResolvedValue('retry');
    await enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Plzeň' });

    await expect(removeQueuedDrinkUpdate(UUID_A)).resolves.toBe(true);

    expect(await readQueue()).toEqual([]);
  });

  it('is a no-op when there is no pending update for the drink', async () => {
    await expect(removeQueuedDrinkUpdate('missing')).resolves.toBe(false);
  });

  it('keeps an update removed when removal runs during an in-flight flush', async () => {
    let resolveUpdate!: (value: SubmitDrinkResult) => void;
    (updateDrinkName as jest.Mock).mockReturnValueOnce(
      new Promise<SubmitDrinkResult>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ client_id: UUID_A, beer_name: 'Kozel' }]));

    const flushing = flushUpdateDrinksQueue();
    await waitForExpectation(() => expect(updateDrinkName).toHaveBeenCalledTimes(1));
    await expect(removeQueuedDrinkUpdate(UUID_A)).resolves.toBe(true);
    expect(await readQueue()).toEqual([]);

    resolveUpdate('retry');
    await flushing;
    expect(await readQueue()).toEqual([]);
  });
});

describe('flushUpdateDrinksQueue', () => {
  it('drops malformed persisted client IDs instead of retrying them forever', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      { client_id: 'not-a-uuid', beer_name: 'Rozbité' },
      { client_id: UUID_A, beer_name: 'Kozel' },
    ]));

    await flushUpdateDrinksQueue();

    expect(updateDrinkName).toHaveBeenCalledTimes(1);
    expect(updateDrinkName).toHaveBeenCalledWith(UUID_A, 'Kozel');
  });

  it('drops malformed update fields instead of sending a poisoned PATCH', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      { client_id: UUID_A, beer_name: 42 },
      { client_id: UUID_B, junk: { nested: true } },
    ]));

    await flushUpdateDrinksQueue();

    expect(updateDrinkName).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });

  it('retries queued updates and keeps only retryable failures', async () => {
    (updateDrinkName as jest.Mock).mockResolvedValue('retry');
    await enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Kozel' });
    await enqueueDrinkUpdate({ client_id: UUID_B, beer_name: 'Plzeň' });

    (updateDrinkName as jest.Mock).mockImplementation(async (clientId: string) =>
      clientId === UUID_A ? 'ok' : 'retry',
    );
    await flushUpdateDrinksQueue();

    expect(await readQueue()).toEqual([{ client_id: UUID_B, beer_name: 'Plzeň' }]);
  });

  it('is a no-op on an empty queue', async () => {
    await flushUpdateDrinksQueue();
    expect(updateDrinkName).not.toHaveBeenCalled();
  });

  it('persists a newer update while an older delivery is still in flight', async () => {
    let resolveUpdate!: (value: SubmitDrinkResult) => void;
    // Every send retries so the trailing flush keeps both updates queued (the
    // point here is that the mid-flight enqueue is not clobbered).
    (updateDrinkName as jest.Mock).mockResolvedValue('retry');
    (updateDrinkName as jest.Mock).mockReturnValueOnce(
      new Promise<SubmitDrinkResult>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const first = enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Kozel' });
    await waitForExpectation(() => expect(updateDrinkName).toHaveBeenCalledTimes(1));

    const second = enqueueDrinkUpdate({ client_id: UUID_B, beer_name: 'Plzeň' });
    await waitForExpectation(async () => {
      expect((await readQueue()).map((entry) => entry.client_id)).toContain(UUID_B);
    });

    resolveUpdate('retry');
    await first;
    await second;
    expect((await readQueue()).map((entry) => entry.client_id).sort()).toEqual([UUID_A, UUID_B]);
  });

  it('keeps a newer update for the same client_id when an older in-flight op settles', async () => {
    let resolveUpdate!: (value: SubmitDrinkResult) => void;
    // The trailing flush re-attempts but retries, so the newer name stays queued
    // (the point here is that the stale in-flight result does not clobber it).
    (updateDrinkName as jest.Mock).mockResolvedValue('retry');
    (updateDrinkName as jest.Mock).mockReturnValueOnce(
      new Promise<SubmitDrinkResult>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const first = enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Plzen' });
    await waitForExpectation(() => expect(updateDrinkName).toHaveBeenCalledTimes(1));

    const second = enqueueDrinkUpdate({ client_id: UUID_A, beer_name: 'Plzeň' });
    await waitForExpectation(async () => {
      expect(await readQueue()).toEqual([{ client_id: UUID_A, beer_name: 'Plzeň' }]);
    });

    resolveUpdate('ok');
    await first;
    await second;
    expect(await readQueue()).toEqual([{ client_id: UUID_A, beer_name: 'Plzeň' }]);
  });

  it('keeps the queue cleared when clear runs during an in-flight flush', async () => {
    let resolveUpdate!: (value: SubmitDrinkResult) => void;
    (updateDrinkName as jest.Mock).mockReturnValueOnce(
      new Promise<SubmitDrinkResult>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ client_id: UUID_A, beer_name: 'Kozel' }]));

    const flushing = flushUpdateDrinksQueue();
    await waitForExpectation(() => expect(updateDrinkName).toHaveBeenCalledTimes(1));
    await clearUpdateDrinksQueue();
    expect(await readQueue()).toEqual([]);

    resolveUpdate('retry');
    await flushing;
    expect(await readQueue()).toEqual([]);
  });

  it('runs exactly one trailing pass for a flush requested mid-flight', async () => {
    let resolveUpdate!: (value: SubmitDrinkResult) => void;
    (updateDrinkName as jest.Mock)
      .mockReturnValueOnce(
        new Promise<SubmitDrinkResult>((resolve) => {
          resolveUpdate = resolve;
        }),
      )
      .mockResolvedValue('retry');
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ client_id: UUID_A, beer_name: 'Kozel' }]));

    const first = flushUpdateDrinksQueue();
    const second = flushUpdateDrinksQueue();
    await waitForExpectation(() => expect(updateDrinkName).toHaveBeenCalledTimes(1));
    // While the first pass is in flight, no second concurrent pass starts.
    expect(updateDrinkName).toHaveBeenCalledTimes(1);

    resolveUpdate('retry');
    await first;
    await second;
    // The mid-flight caller scheduled exactly one trailing pass — not zero (so a
    // mid-flush enqueue is retried) and not more than one (no busy loop).
    expect(updateDrinkName).toHaveBeenCalledTimes(2);
    expect(await readQueue()).toEqual([{ client_id: UUID_A, beer_name: 'Kozel' }]);
  });
});
