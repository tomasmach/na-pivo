import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  enqueueAddedPubEdit,
  enqueueAddedPub,
  flushAddedPubsQueue,
  loadAddedPubSubmissions,
  retryAddedPub,
} from '../addedPubsQueue';
import { fetchOwnAddedPubs, submitAddedPub, submitAddedPubEdit } from '../addedPubsClient';
import { removeLocalPub, upsertLocalPub } from '../pubs';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
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

    const { syncOwnAddedPubs } = await import('../addedPubsQueue');
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
});
