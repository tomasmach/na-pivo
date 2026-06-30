import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueAddedPub, flushAddedPubsQueue, restoreQueuedAddedPubs } from '../addedPubsQueue';
import { submitAddedPub, type AddedPubEntry } from '../addedPubsClient';
import { clearPubsSnapshot, removeLocalPub, upsertLocalPub } from '../pubs';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../addedPubsClient', () => ({
  submitAddedPub: jest.fn(async () => 'retry'),
  buildAddedPubEntry: jest.requireActual('../addedPubsClient').buildAddedPubEntry,
}));

jest.mock('../pubs', () => ({
  clearPubsSnapshot: jest.fn(async () => undefined),
  pubIdForCoords: (lat: number, lng: number) => `mapy:${lat.toFixed(5)},${lng.toFixed(5)}`,
  removeLocalPub: jest.fn(),
  upsertLocalPub: jest.fn(),
}));

const STORAGE_KEY = 'na-pivo-added-pubs-queue';

// Two distinct pubs whose coordinates fall in the SAME geohash-8 cell
// (~38 m × 19 m). The old dedup keyed on the cell, so the second submit
// silently overwrote the first; dedup must key on client_id instead.
const PUB_A: AddedPubEntry = {
  client_id: 'client-a',
  name: 'Hospoda U Testu',
  lat: 50.0812,
  lng: 14.4182,
  city: 'Praha',
  address: 'Testovací 12',
};

const PUB_B: AddedPubEntry = {
  client_id: 'client-b',
  name: 'Pivnice Za Rohem',
  lat: 50.08121,
  lng: 14.41821,
  city: 'Praha',
  address: 'Testovací 14',
};

async function readQueue(): Promise<AddedPubEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('enqueueAddedPub', () => {
  it('sends the pub and leaves the queue empty on success', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue({ cacheKey: 'k', name: PUB_A.name, lat: PUB_A.lat, lng: PUB_A.lng });

    await expect(enqueueAddedPub(PUB_A)).resolves.toBe(true);

    expect(submitAddedPub).toHaveBeenCalledWith(PUB_A);
    expect(upsertLocalPub).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mapy:50.08120,14.41820',
        name: PUB_A.name,
        lat: PUB_A.lat,
        lng: PUB_A.lng,
        venueKind: 'pub',
      }),
    );
    expect(clearPubsSnapshot).toHaveBeenCalled();
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps a failed submit queued instead of dropping it', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');

    await expect(enqueueAddedPub(PUB_A)).resolves.toBe(false);

    await expect(readQueue()).resolves.toEqual([PUB_A]);
  });

  it('drops a permanently rejected submit and removes the optimistic local pub', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('permanent-error');

    await expect(enqueueAddedPub(PUB_A)).resolves.toBe(true);

    expect(removeLocalPub).toHaveBeenCalledWith('mapy:50.08120,14.41820');
    expect(clearPubsSnapshot).not.toHaveBeenCalled();
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps two different pubs in the same geohash cell (regression: dedup by client_id, not cell)', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');

    await enqueueAddedPub(PUB_A);
    await enqueueAddedPub(PUB_B);

    const queue = await readQueue();
    expect(queue).toHaveLength(2);
    expect(queue.map((e) => e.client_id)).toEqual(['client-a', 'client-b']);
  });

  it('dedupes a retry of the same client_id (idempotent re-enqueue)', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');

    await enqueueAddedPub(PUB_A);
    await enqueueAddedPub({ ...PUB_A, name: 'Hospoda U Testu (edit)' });

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('client-a');
    expect(queue[0].name).toBe('Hospoda U Testu (edit)');
  });

  it('trims the queue to the maximum length, keeping the newest entries', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');

    for (let i = 0; i < 35; i += 1) {
      await enqueueAddedPub({ ...PUB_A, client_id: `client-${i}`, lat: 50.0812 + i * 0.01 });
    }

    const queue = await readQueue();
    expect(queue).toHaveLength(30);
    expect(queue[0].client_id).toBe('client-5');
    expect(queue[queue.length - 1].client_id).toBe('client-34');
  });
});

describe('flushAddedPubsQueue', () => {
  it('re-sends queued pubs once the backend recovers and clears the queue', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');
    await enqueueAddedPub(PUB_A);
    await enqueueAddedPub(PUB_B);
    expect(await readQueue()).toHaveLength(2);

    (submitAddedPub as jest.Mock).mockResolvedValue({ cacheKey: 'k', name: 'x', lat: 1, lng: 1 });
    await flushAddedPubsQueue();

    expect(submitAddedPub).toHaveBeenCalledWith(PUB_A);
    expect(submitAddedPub).toHaveBeenCalledWith(PUB_B);
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps only the pubs that failed again', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');
    await enqueueAddedPub(PUB_A);
    await enqueueAddedPub(PUB_B);

    (submitAddedPub as jest.Mock).mockImplementation(
      async (entry: AddedPubEntry) =>
        entry.client_id === PUB_A.client_id ? { cacheKey: 'k', name: 'x', lat: 1, lng: 1 } : 'retry',
    );
    await flushAddedPubsQueue();

    await expect(readQueue()).resolves.toEqual([PUB_B]);
  });

  it('replaces the optimistic local position when the backend geocodes a better address', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');
    await enqueueAddedPub(PUB_A);
    (submitAddedPub as jest.Mock).mockResolvedValue({
      cacheKey: 'server-key',
      name: PUB_A.name,
      lat: 50.09,
      lng: 14.43,
      city: 'Praha',
      address: 'Přesná 1',
    });

    await flushAddedPubsQueue();

    expect(removeLocalPub).toHaveBeenCalledWith('mapy:50.08120,14.41820');
    expect(upsertLocalPub).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'mapy:50.09000,14.43000',
        name: PUB_A.name,
        lat: 50.09,
        lng: 14.43,
        city: 'Praha',
        address: 'Přesná 1',
        venueKind: 'pub',
      }),
    );
  });

  it('does nothing on an empty queue', async () => {
    await flushAddedPubsQueue();
    expect(submitAddedPub).not.toHaveBeenCalled();
  });

  it('drops corrupted storage entries instead of submitting them', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ client_id: 'broken' }, PUB_A]),
    );
    (submitAddedPub as jest.Mock).mockResolvedValue({ cacheKey: 'k', name: 'x', lat: 1, lng: 1 });

    await flushAddedPubsQueue();

    expect(submitAddedPub).toHaveBeenCalledTimes(1);
    expect(submitAddedPub).toHaveBeenCalledWith(PUB_A);
  });

  it('survives non-JSON storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushAddedPubsQueue()).resolves.toBeUndefined();
    expect(submitAddedPub).not.toHaveBeenCalled();
  });
});

describe('restoreQueuedAddedPubs', () => {
  it('restores queued pubs into the local compass index without submitting them', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([PUB_A, PUB_B]));

    await expect(restoreQueuedAddedPubs()).resolves.toBe(2);

    expect(submitAddedPub).not.toHaveBeenCalled();
    expect(upsertLocalPub).toHaveBeenCalledTimes(2);
    expect(upsertLocalPub).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mapy:50.08120,14.41820', name: PUB_A.name }),
    );
    expect(upsertLocalPub).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mapy:50.08121,14.41821', name: PUB_B.name }),
    );
  });
});
