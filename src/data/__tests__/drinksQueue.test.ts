import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearDrinksQueue,
  enqueueDrink,
  ensureDrinkQueued,
  flushDrinksQueue,
  removeQueuedDrink,
  updateQueuedDrinkBeerName,
} from '../drinksQueue';
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

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
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

describe('ensureDrinkQueued', () => {
  it('persists one replayable client id only once without delivering it', async () => {
    const repeated = entry({ client_id: 'lock-screen-add' });

    await ensureDrinkQueued(repeated);
    await ensureDrinkQueued(repeated);

    expect((await readQueue()).map((queued) => queued.client_id)).toEqual([
      'lock-screen-add',
    ]);
    expect(submitDrink).not.toHaveBeenCalled();
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

  it('persists a new drink while a slow flush is still delivering an older snapshot', async () => {
    let resolveSubmit!: (value: 'retry') => void;
    const slowSubmit = new Promise<'retry'>((resolve) => {
      resolveSubmit = resolve;
    });

    (submitDrink as jest.Mock).mockReturnValueOnce(slowSubmit);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([entry({ client_id: 'a' })]));

    const flushing = flushDrinksQueue();
    await flushMicrotasks();
    expect(submitDrink).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'a' }));

    const enqueueing = enqueueDrink(entry({ client_id: 'b' }), { deliver: false });
    await flushMicrotasks();

    expect((await readQueue()).map((e) => e.client_id)).toEqual(['a', 'b']);

    resolveSubmit('retry');
    await flushing;
    await enqueueing;
    expect((await readQueue()).map((e) => e.client_id)).toEqual(['a', 'b']);
  });

  it('coalesces concurrent flush calls so the same snapshot is not sent twice', async () => {
    let resolveSubmit!: (value: 'ok') => void;
    const slowSubmit = new Promise<'ok'>((resolve) => {
      resolveSubmit = resolve;
    });

    (submitDrink as jest.Mock).mockReturnValueOnce(slowSubmit);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([entry({ client_id: 'a' })]));

    const firstFlush = flushDrinksQueue();
    const secondFlush = flushDrinksQueue();
    await flushMicrotasks();

    expect(submitDrink).toHaveBeenCalledTimes(1);
    expect(submitDrink).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'a' }));

    resolveSubmit('ok');
    await Promise.all([firstFlush, secondFlush]);
    expect(await readQueue()).toEqual([]);
  });

  it('delivers a drink enqueued during an in-flight flush via a trailing flush', async () => {
    // The in-flight snapshot's send stalls; every later send succeeds.
    let resolveFirst!: (value: 'ok') => void;
    const slowSubmit = new Promise<'ok'>((resolve) => {
      resolveFirst = resolve;
    });
    (submitDrink as jest.Mock).mockReturnValueOnce(slowSubmit);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([entry({ client_id: 'a' })]));

    const flushing = flushDrinksQueue();
    await flushMicrotasks();
    expect(submitDrink).toHaveBeenCalledTimes(1); // 'a' is in flight

    // Enqueue a NEW drink mid-flight — it is NOT in the in-flight snapshot.
    const enqueueing = enqueueDrink(entry({ client_id: 'b' }));
    await flushMicrotasks();
    expect(submitDrink).toHaveBeenCalledTimes(1); // no second concurrent pass

    resolveFirst('ok');
    // The trailing flush re-snapshots the queue and delivers 'b', so enqueueDrink
    // reports it left the queue (true) without waiting for a new app launch.
    await expect(enqueueing).resolves.toBe(true);
    await flushing;

    expect(submitDrink).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'b' }));
    expect(await readQueue()).toEqual([]);
  });

  it('does not deliver remaining drinks after clear runs during an in-flight flush', async () => {
    // Account boundary (logout / delete account) clears the queue mid-flush. 'a'
    // is already in flight under the previous account; 'b' must NOT be POSTed
    // afterwards, or it uploads under whatever session replaces this one.
    let resolveFirst!: (value: 'ok') => void;
    (submitDrink as jest.Mock).mockReturnValueOnce(
      new Promise<'ok'>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([entry({ client_id: 'a' }), entry({ client_id: 'b' })]),
    );

    const flushing = flushDrinksQueue();
    await flushMicrotasks();
    expect(submitDrink).toHaveBeenCalledTimes(1); // 'a' is in flight

    await clearDrinksQueue();
    resolveFirst('ok');
    await flushing;

    expect(submitDrink).toHaveBeenCalledTimes(1);
    expect((submitDrink as jest.Mock).mock.calls[0][0]).toMatchObject({ client_id: 'a' });
    expect(await readQueue()).toEqual([]);
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

  it('reports not safely pulled when the drink POST is already in flight', async () => {
    let resolveSubmit!: (value: 'ok') => void;
    const slowSubmit = new Promise<'ok'>((resolve) => {
      resolveSubmit = resolve;
    });

    (submitDrink as jest.Mock).mockReturnValueOnce(slowSubmit);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([entry({ client_id: 'a' })]));

    const flushing = flushDrinksQueue();
    await flushMicrotasks();

    await expect(removeQueuedDrink('a')).resolves.toBe(false);
    expect(await readQueue()).toEqual([]);

    resolveSubmit('ok');
    await flushing;
  });
});

describe('updateQueuedDrinkBeerName', () => {
  it('updates the beer name on a drink that has not been delivered yet', async () => {
    (submitDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDrink(entry({ client_id: 'a', beer: { name: 'Plzen', price_czk: 62, volume_ml: 500 } }));

    await expect(updateQueuedDrinkBeerName('a', 'Plzeň')).resolves.toBe('queued');

    const queue = await readQueue();
    expect(queue[0].beer.name).toBe('Plzeň');
  });

  it('reports in-flight when the original POST may already be sending the old name', async () => {
    let resolveSubmit!: (value: 'ok') => void;
    const slowSubmit = new Promise<'ok'>((resolve) => {
      resolveSubmit = resolve;
    });

    (submitDrink as jest.Mock).mockReturnValueOnce(slowSubmit);
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([entry({ client_id: 'a', beer: { name: 'Plzen', price_czk: 62, volume_ml: 500 } })]),
    );

    const flushing = flushDrinksQueue();
    await flushMicrotasks();

    await expect(updateQueuedDrinkBeerName('a', 'Plzeň')).resolves.toBe('in-flight');
    expect((await readQueue())[0].beer.name).toBe('Plzeň');

    resolveSubmit('ok');
    await flushing;
  });

  it('reports missing when the drink is no longer queued', async () => {
    await expect(updateQueuedDrinkBeerName('missing', 'Kozel')).resolves.toBe('missing');
  });
});

describe('queue validator (persistence round-trip)', () => {
  it('keeps outside (publess) entries and still drops malformed ones on load', async () => {
    const outside: DrinkEntry = {
      client_id: 'out-1',
      place_context: 'private',
      beer: { name: 'Kozel 11', serving_type: 'bottle' },
      drank_at: '2026-07-17T20:00:00+02:00',
    };
    // No pub fields AND no place_context → legacy shape missing its pub → invalid.
    const malformed = { client_id: 'bad-1', beer: { name: 'X', price_czk: 40 } };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([entry(), outside, malformed]));

    await flushDrinksQueue();

    const sent = (submitDrink as jest.Mock).mock.calls.map((call) => call[0].client_id);
    expect(sent).toContain('c1');
    expect(sent).toContain('out-1');
    expect(sent).not.toContain('bad-1');
  });

  it('rejects an outside entry that smuggles coordinates', async () => {
    const leaky = {
      client_id: 'leak-1',
      place_context: 'private',
      lat: 50.1,
      lng: 14.4,
      beer: { name: 'Kozel 11' },
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([leaky]));

    await flushDrinksQueue();

    expect(submitDrink).not.toHaveBeenCalled();
  });
});
