import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueDrink, flushDrinksQueue, removeQueuedDrink } from '../drinksQueue';
import { submitDrink, type DrinkEntry } from '../drinksClient';

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
  submitDrink: jest.fn(async () => 'ok'),
}));

const STORAGE_KEY = 'na-pivo-drinks-queue';

let seq = 0;
function entry(overrides: Partial<DrinkEntry> = {}): DrinkEntry {
  seq += 1;
  return {
    client_id: `c${seq}`,
    name: 'U Testu',
    lat: 50.0812,
    lng: 14.4182,
    external_id: 'mapy:1',
    beer: { name: 'Plzeň', price_czk: 62, volume_ml: 500 },
    drank_at: '2026-06-12T19:45:00+02:00',
    ...overrides,
  };
}

async function readQueue(): Promise<DrinkEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  seq = 0;
  jest.clearAllMocks();
  (submitDrink as jest.Mock).mockResolvedValue('ok');
  await AsyncStorage.clear();
});

describe('enqueueDrink', () => {
  it('sends the drink and leaves the queue empty on success', async () => {
    await expect(enqueueDrink(entry())).resolves.toBe(true);
    expect(submitDrink).toHaveBeenCalledTimes(1);
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps a drink queued when the send must retry (network/5xx/429)', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    await expect(enqueueDrink(entry())).resolves.toBe(false);
    expect(await readQueue()).toHaveLength(1);
  });

  it('drops a permanently-rejected drink (4xx) from the queue', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('permanent-error');
    // It left the queue (true), but is NOT retried later.
    await expect(enqueueDrink(entry())).resolves.toBe(true);
    expect(await readQueue()).toHaveLength(0);
  });

  it('does NOT dedup — every drink is a distinct event keyed by client_id', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    // Same pub/coords, two drinks → both kept.
    await enqueueDrink(entry({ client_id: 'a' }));
    await enqueueDrink(entry({ client_id: 'b' }));
    const queue = await readQueue();
    expect(queue.map((e) => e.client_id).sort()).toEqual(['a', 'b']);
  });

  it('caps the stored queue at 200 items', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    for (let i = 0; i < 205; i++) {
      await enqueueDrink(entry({ client_id: `id-${i}` }));
    }
    const queue = await readQueue();
    expect(queue).toHaveLength(200);
    // Oldest dropped, newest kept.
    expect(queue[queue.length - 1].client_id).toBe('id-204');
    expect(queue.some((e) => e.client_id === 'id-0')).toBe(false);
  });
});

describe('flushDrinksQueue', () => {
  it('re-sends queued drinks once the backend recovers and clears the queue', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDrink(entry({ client_id: 'a' }));
    await enqueueDrink(entry({ client_id: 'b' }));
    expect(await readQueue()).toHaveLength(2);

    (submitDrink as jest.Mock).mockResolvedValue('ok');
    await flushDrinksQueue();
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps only the drinks that still need retrying', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDrink(entry({ client_id: 'a' }));
    await enqueueDrink(entry({ client_id: 'b' }));

    (submitDrink as jest.Mock).mockImplementation(async (e: DrinkEntry) =>
      e.client_id === 'a' ? 'ok' : 'retry',
    );
    await flushDrinksQueue();

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('b');
  });

  it('drops a permanently-rejected drink during flush', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDrink(entry({ client_id: 'a' }));

    (submitDrink as jest.Mock).mockResolvedValue('permanent-error');
    await flushDrinksQueue();
    expect(await readQueue()).toHaveLength(0);
  });

  it('does nothing on an empty queue', async () => {
    await flushDrinksQueue();
    expect(submitDrink).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushDrinksQueue()).resolves.toBeUndefined();
    expect(submitDrink).not.toHaveBeenCalled();
  });
});

describe('removeQueuedDrink', () => {
  it('removes a queued drink by client_id (undo before delivery)', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDrink(entry({ client_id: 'a' }));
    await enqueueDrink(entry({ client_id: 'b' }));

    await expect(removeQueuedDrink('a')).resolves.toBe(true);
    const queue = await readQueue();
    expect(queue.map((e) => e.client_id)).toEqual(['b']);
  });

  it('is a no-op when the drink already flushed', async () => {
    await expect(removeQueuedDrink('missing')).resolves.toBe(false);
    expect(await readQueue()).toEqual([]);
  });
});
