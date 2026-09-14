import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  enqueueAddedPubEdit,
  enqueueAddedPub,
  flushAddedPubsQueue,
  loadAddedPubSubmissions,
  retryAddedPub,
  syncOwnAddedPubs,
  type AddedPubSubmission,
} from '../addedPubsQueue';
import { fetchOwnAddedPubs, submitAddedPub, submitAddedPubEdit } from '../addedPubsClient';
import { removeLocalPub, upsertLocalPub, upsertLocalPubs } from '../pubs';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../addedPubsClient', () => ({
  submitAddedPub: jest.fn(),
  submitAddedPubEdit: jest.fn(),
  fetchOwnAddedPubs: jest.fn(async () => null),
}));

jest.mock('../pubs', () => ({
  clearPubsSnapshot: jest.fn(async () => undefined),
  pubIdForCoords: jest.fn((lat: number, lng: number) => `local:${lat}:${lng}`),
  removeLocalPub: jest.fn(),
  upsertLocalPub: jest.fn(),
  upsertLocalPubs: jest.fn(),
}));

const ENTRY = {
  client_id: '9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d',
  name: 'Hospoda U Fronty',
  lat: 50.0812,
  lng: 14.4182,
  city: 'Praha',
  address: 'Testovací 12',
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('added pub state registry', () => {
  it('persists a new pub while an older submit is still pending', async () => {
    await AsyncStorage.setItem('na-pivo-added-pubs-queue', JSON.stringify([{
      ...ENTRY,
      syncState: 'pending',
      pendingOperation: 'create',
      updatedAt: '2026-07-21T10:00:00.000Z',
    }]));
    let releaseDelivery!: (result: 'retry') => void;
    (submitAddedPub as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { releaseDelivery = resolve; }),
    );

    const flush = flushAddedPubsQueue();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitAddedPub).toHaveBeenCalledTimes(1);
    const enqueue = enqueueAddedPub({
      ...ENTRY,
      client_id: 'second-client',
      name: 'Nová hospoda',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const persistedBeforeDeliverySettled = JSON.parse(
      (await AsyncStorage.getItem('na-pivo-added-pubs-queue')) ?? '[]',
    ) as AddedPubSubmission[];

    releaseDelivery('retry');
    await Promise.all([flush, enqueue]);
    expect(persistedBeforeDeliverySettled.map((entry) => entry.client_id)).toContain('second-client');
  });

  it('keeps a retryable submit visible as pending and syncs after connectivity returns', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValueOnce('retry');

    await expect(enqueueAddedPub(ENTRY)).resolves.toBe('pending');
    await expect(loadAddedPubSubmissions()).resolves.toEqual([
      expect.objectContaining({
        client_id: ENTRY.client_id,
        syncState: 'pending',
        pendingOperation: 'create',
      }),
    ]);

    (submitAddedPub as jest.Mock).mockResolvedValueOnce({
      clientId: ENTRY.client_id,
      cacheKey: 'u2fkbnvy',
      name: ENTRY.name,
      lat: ENTRY.lat,
      lng: ENTRY.lng,
      city: ENTRY.city,
      address: ENTRY.address,
    });
    await flushAddedPubsQueue();

    await expect(loadAddedPubSubmissions()).resolves.toEqual([
      expect.objectContaining({ syncState: 'synced', pendingOperation: null }),
    ]);
  });

  it('keeps a permanent rejection as failed and lets the user retry it', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValueOnce('permanent-error');

    await expect(enqueueAddedPub(ENTRY)).resolves.toBe('failed');
    await expect(loadAddedPubSubmissions()).resolves.toEqual([
      expect.objectContaining({ syncState: 'failed', pendingOperation: 'create' }),
    ]);

    (submitAddedPub as jest.Mock).mockResolvedValueOnce({
      clientId: ENTRY.client_id,
      cacheKey: 'u2fkbnvy',
      name: ENTRY.name,
      lat: ENTRY.lat,
      lng: ENTRY.lng,
      city: ENTRY.city,
      address: ENTRY.address,
    });
    await expect(retryAddedPub(ENTRY.client_id)).resolves.toBe('synced');
  });

  it('migrates the legacy queue array into pending submissions', async () => {
    await AsyncStorage.setItem('na-pivo-added-pubs-queue', JSON.stringify([ENTRY]));

    await expect(loadAddedPubSubmissions()).resolves.toEqual([
      expect.objectContaining({ syncState: 'pending', pendingOperation: 'create' }),
    ]);
  });

  it('keeps two different additions instead of deduping by coordinates', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');
    await enqueueAddedPub(ENTRY);
    await enqueueAddedPub({ ...ENTRY, client_id: 'second-client', name: 'Hospoda vedle' });

    const rows = await loadAddedPubSubmissions();
    expect(rows.map((row) => row.client_id)).toEqual([ENTRY.client_id, 'second-client']);
  });

  it('restores the last confirmed point when an edit is permanently rejected', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValueOnce({
      clientId: ENTRY.client_id,
      cacheKey: 'u2fkbnvy',
      name: ENTRY.name,
      lat: ENTRY.lat,
      lng: ENTRY.lng,
      city: ENTRY.city,
      address: ENTRY.address,
    });
    await enqueueAddedPub(ENTRY);
    jest.clearAllMocks();
    (submitAddedPubEdit as jest.Mock).mockResolvedValueOnce('permanent-error');

    await expect(enqueueAddedPubEdit({
      client_id: ENTRY.client_id,
      name: ENTRY.name,
      lat: 50.09,
      lng: 14.43,
      city: 'Praha',
      address: 'Špatná 99',
    })).resolves.toBe('failed');

    expect(removeLocalPub).toHaveBeenCalledWith('local:50.09:14.43');
    expect(upsertLocalPub).toHaveBeenLastCalledWith(expect.objectContaining({
      lat: ENTRY.lat,
      lng: ENTRY.lng,
      address: ENTRY.address,
    }));
  });

  it('does not let an older GET response erase a pending offline edit', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValueOnce({
      clientId: ENTRY.client_id,
      cacheKey: 'u2fkbnvy',
      name: ENTRY.name,
      lat: ENTRY.lat,
      lng: ENTRY.lng,
      city: ENTRY.city,
      address: ENTRY.address,
    });
    await enqueueAddedPub(ENTRY);
    (submitAddedPubEdit as jest.Mock).mockResolvedValueOnce('retry');
    await enqueueAddedPubEdit({
      client_id: ENTRY.client_id,
      name: ENTRY.name,
      lat: 50.09,
      lng: 14.43,
      city: 'Praha',
      address: 'Nová 9',
    });
    (fetchOwnAddedPubs as jest.Mock).mockResolvedValueOnce([{
      clientId: ENTRY.client_id,
      cacheKey: 'u2fkbnvy',
      name: ENTRY.name,
      lat: ENTRY.lat,
      lng: ENTRY.lng,
      city: ENTRY.city,
      address: ENTRY.address,
    }]);

    await syncOwnAddedPubs();

    await expect(loadAddedPubSubmissions()).resolves.toEqual([
      expect.objectContaining({
        syncState: 'pending',
        pendingOperation: 'edit',
        lat: 50.09,
        address: 'Nová 9',
      }),
    ]);
  });

  it('never evicts unsettled creates when the history limit is exceeded', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValue('retry');

    for (let index = 0; index < 31; index += 1) {
      await enqueueAddedPub({
        ...ENTRY,
        client_id: `pending-${index}`,
        name: `Hospoda ${index}`,
      });
    }

    const rows = await loadAddedPubSubmissions();
    expect(rows).toHaveLength(31);
    expect(rows.every((row) => row.syncState === 'pending')).toBe(true);
    expect(rows.map((row) => row.client_id)).toContain('pending-0');
  });

  it('keeps a pending edit while syncing a full page of server history', async () => {
    await AsyncStorage.setItem('na-pivo-added-pubs-queue', JSON.stringify([{
      ...ENTRY,
      syncState: 'pending',
      pendingOperation: 'edit',
      pendingEdit: { client_id: ENTRY.client_id, name: 'Nový název' },
      updatedAt: '2026-07-21T10:00:00.000Z',
    }]));
    (fetchOwnAddedPubs as jest.Mock).mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, index) => ({
        clientId: `remote-${index}`,
        cacheKey: `cache-${index}`,
        name: `Server ${index}`,
        lat: ENTRY.lat + index / 1000,
        lng: ENTRY.lng,
      })),
    );

    await syncOwnAddedPubs();

    const rows = await loadAddedPubSubmissions();
    expect(rows).toHaveLength(31);
    expect(rows).toContainEqual(expect.objectContaining({
      client_id: ENTRY.client_id,
      syncState: 'pending',
      pendingEdit: expect.objectContaining({ name: 'Nový název' }),
    }));
  });

  it('keeps the newest server rows when trimming synced history', async () => {
    (fetchOwnAddedPubs as jest.Mock).mockResolvedValueOnce(
      Array.from({ length: 35 }, (_, index) => ({
        clientId: `remote-${index}`,
        cacheKey: `cache-${index}`,
        name: `Server ${index}`,
        lat: ENTRY.lat + index / 1000,
        lng: ENTRY.lng,
      })),
    );

    await syncOwnAddedPubs();

    const rows = await loadAddedPubSubmissions();
    expect(rows).toHaveLength(30);
    expect(rows.map((row) => row.client_id)).toEqual(
      Array.from({ length: 30 }, (_, index) => `remote-${index}`),
    );
    expect(upsertLocalPubs).toHaveBeenCalledTimes(1);
    expect(upsertLocalPubs).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'Server 0' }),
      expect.objectContaining({ name: 'Server 29' }),
    ]));
  });

  it('uses insertion order to break equal history timestamps in favor of newer rows', async () => {
    await AsyncStorage.setItem(
      'na-pivo-added-pubs-queue',
      JSON.stringify(Array.from({ length: 31 }, (_, index) => ({
        ...ENTRY,
        client_id: `synced-${index}`,
        syncState: 'synced',
        pendingOperation: null,
        updatedAt: '2026-07-21T10:00:00.000Z',
      }))),
    );
    (fetchOwnAddedPubs as jest.Mock).mockResolvedValueOnce([]);

    await syncOwnAddedPubs();

    const rows = await loadAddedPubSubmissions();
    expect(rows).toHaveLength(30);
    expect(rows.map((row) => row.client_id)).not.toContain('synced-0');
    expect(rows.map((row) => row.client_id)).toContain('synced-30');
  });

  it('retries a rename as a name-only PATCH', async () => {
    (submitAddedPub as jest.Mock).mockResolvedValueOnce({
      clientId: ENTRY.client_id,
      cacheKey: 'u2fkbnvy',
      name: ENTRY.name,
      lat: ENTRY.lat,
      lng: ENTRY.lng,
      city: ENTRY.city,
      address: ENTRY.address,
    });
    await enqueueAddedPub(ENTRY);
    (submitAddedPubEdit as jest.Mock).mockResolvedValueOnce('retry');

    await enqueueAddedPubEdit({ client_id: ENTRY.client_id, name: 'U Krátkého patche' });

    expect(submitAddedPubEdit).toHaveBeenCalledWith({
      client_id: ENTRY.client_id,
      name: 'U Krátkého patche',
    }, expect.any(AbortSignal));
    await expect(loadAddedPubSubmissions()).resolves.toEqual([
      expect.objectContaining({
        name: 'U Krátkého patche',
        lat: ENTRY.lat,
        lng: ENTRY.lng,
        pendingEdit: { client_id: ENTRY.client_id, name: 'U Krátkého patche' },
      }),
    ]);
  });
});
