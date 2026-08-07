/**
 * Tests for the beer-photos store (src/stores/beerPhotosStore.ts) — the merge
 * logic between the authoritative server list and locally-pending uploads.
 *
 * AsyncStorage is the jest mock (persist middleware writes there); the client
 * is mocked so loadBeerPhotos never touches the network.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const fetchMyBeerPhotos = jest.fn(async (): Promise<unknown> => null);
jest.mock('@/data/beerPhotosClient', () => ({
  fetchMyBeerPhotos: (...args: unknown[]) => fetchMyBeerPhotos(...(args as [])),
}));

import {
  beerPhotosForDrinkingDay,
  beerPhotoUri,
  loadBeerPhotos,
  useBeerPhotosStore,
  type PendingBeerPhotoInput,
} from '@/stores/beerPhotosStore';
import type { BeerPhoto } from '@/data/beerPhotosClient';

function serverPhoto(clientId: string, over: Partial<BeerPhoto> = {}): BeerPhoto {
  return {
    id: `srv-${clientId}`,
    clientId,
    imageUrl: `https://api.test/media/${clientId}.jpg`,
    caption: 'Večer',
    pubCacheKey: '',
    pubName: '',
    pubCity: '',
    visibility: 'private',
    takenAt: '2026-07-01T19:00:00.000Z',
    createdAt: '2026-07-01T19:00:05.000Z',
    inContest: false,
    ...over,
  };
}

function pendingInput(clientId: string, over: Partial<PendingBeerPhotoInput> = {}): PendingBeerPhotoInput {
  return {
    clientId,
    localUri: `file:///docs/beer-photos/${clientId}.jpg`,
    caption: 'Čerstvé',
    visibility: 'friends',
    takenAt: '2026-07-05T20:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useBeerPhotosStore.setState({ photos: [] });
});

describe('addPendingPhoto', () => {
  it('inserts an optimistic pending entry with the local uri', () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('c1'));

    expect(useBeerPhotosStore.getState().photos).toEqual([
      {
        id: null,
        clientId: 'c1',
        imageUrl: null,
        caption: 'Čerstvé',
        pubCacheKey: '',
        pubName: '',
        pubCity: '',
        visibility: 'friends',
        takenAt: '2026-07-05T20:00:00.000Z',
        createdAt: '2026-07-05T20:00:00.000Z',
        inContest: false,
        localUri: 'file:///docs/beer-photos/c1.jpg',
        syncState: 'pending',
      },
    ]);
  });

  it('replaces an existing entry with the same clientId (no duplicates)', () => {
    const store = useBeerPhotosStore.getState();
    store.addPendingPhoto(pendingInput('c1', { caption: 'první' }));
    store.addPendingPhoto(pendingInput('c1', { caption: 'druhá' }));

    const photos = useBeerPhotosStore.getState().photos;
    expect(photos).toHaveLength(1);
    expect(photos[0].caption).toBe('druhá');
  });
});

describe('setServerPhotos (merge)', () => {
  it('keeps pending/failed locals the server does not know, newest first', () => {
    const store = useBeerPhotosStore.getState();
    store.addPendingPhoto(pendingInput('local-1', { takenAt: '2026-07-05T20:00:00.000Z' }));
    store.addPendingPhoto(pendingInput('local-2', { takenAt: '2026-06-20T20:00:00.000Z' }));
    useBeerPhotosStore.getState().markFailed('local-2');

    useBeerPhotosStore
      .getState()
      .setServerPhotos([serverPhoto('c-old', { takenAt: '2026-07-01T19:00:00.000Z' })]);

    const photos = useBeerPhotosStore.getState().photos;
    expect(photos.map((p) => p.clientId)).toEqual(['local-1', 'c-old', 'local-2']);
    expect(photos.map((p) => p.syncState)).toEqual(['pending', 'synced', 'failed']);
  });

  it('replaces a pending local twin with its server copy (idempotent upload landed elsewhere)', () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('c1'));

    useBeerPhotosStore.getState().setServerPhotos([serverPhoto('c1')]);

    const photos = useBeerPhotosStore.getState().photos;
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({
      id: 'srv-c1',
      clientId: 'c1',
      imageUrl: 'https://api.test/media/c1.jpg',
      syncState: 'synced',
    });
    expect(photos[0].localUri).toBeUndefined();
  });

  it('drops previously-synced locals missing from the server list (deleted elsewhere)', () => {
    useBeerPhotosStore.getState().setServerPhotos([serverPhoto('c1'), serverPhoto('c2')]);

    useBeerPhotosStore.getState().setServerPhotos([serverPhoto('c2')]);

    expect(useBeerPhotosStore.getState().photos.map((p) => p.clientId)).toEqual(['c2']);
  });
});

describe('markSynced / markFailed', () => {
  it('markSynced swaps in the server photo and drops the local uri', () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('c1'));

    useBeerPhotosStore.getState().markSynced('c1', serverPhoto('c1'));

    const [photo] = useBeerPhotosStore.getState().photos;
    expect(photo).toMatchObject({
      id: 'srv-c1',
      imageUrl: 'https://api.test/media/c1.jpg',
      syncState: 'synced',
    });
    expect(photo.localUri).toBeUndefined();
  });

  it('markFailed flips only the matching pending entry, never a synced one', () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('c1'));
    useBeerPhotosStore.getState().setServerPhotos([serverPhoto('c2')]);

    useBeerPhotosStore.getState().markFailed('c1');
    useBeerPhotosStore.getState().markFailed('c2');

    const byClientId = new Map(
      useBeerPhotosStore.getState().photos.map((p) => [p.clientId, p.syncState]),
    );
    expect(byClientId.get('c1')).toBe('failed');
    expect(byClientId.get('c2')).toBe('synced');
  });

  it('markFailed persists the backend failure code for the specific error copy', () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('c1'));

    useBeerPhotosStore.getState().markFailed('c1', 'photo_limit_reached');

    expect(useBeerPhotosStore.getState().photos[0]).toMatchObject({
      syncState: 'failed',
      failureCode: 'photo_limit_reached',
    });
  });

  it('a retry (re-addPendingPhoto) clears the failure code, markSynced drops it too', () => {
    const store = useBeerPhotosStore.getState();
    store.addPendingPhoto(pendingInput('c1'));
    store.markFailed('c1', 'photo_invalid');

    // Retry: the detail screen re-enqueues, which re-adds the pending entry.
    store.addPendingPhoto(pendingInput('c1'));
    expect(useBeerPhotosStore.getState().photos[0].failureCode).toBeUndefined();
    expect(useBeerPhotosStore.getState().photos[0].syncState).toBe('pending');

    store.markSynced('c1', serverPhoto('c1'));
    expect(useBeerPhotosStore.getState().photos[0].failureCode).toBeUndefined();
  });
});

describe('removePhoto', () => {
  it('removes by server id or by clientId', () => {
    useBeerPhotosStore.getState().setServerPhotos([serverPhoto('c1'), serverPhoto('c2')]);
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('c3'));

    useBeerPhotosStore.getState().removePhoto('srv-c1');
    useBeerPhotosStore.getState().removePhoto('c3');

    expect(useBeerPhotosStore.getState().photos.map((p) => p.clientId)).toEqual(['c2']);
  });
});

describe('party drinking-day view', () => {
  it('keeps a 03:59 photo with the previous evening and starts the next at 04:00', () => {
    const beforeCutoff = pendingInput('before', { takenAt: '2026-07-05T03:59:00' });
    const atCutoff = pendingInput('after', { takenAt: '2026-07-05T04:00:00' });
    const previousDay = '2026-07-04';
    useBeerPhotosStore.getState().addPendingPhoto(beforeCutoff);
    useBeerPhotosStore.getState().addPendingPhoto(atCutoff);

    const photos = beerPhotosForDrinkingDay(
      useBeerPhotosStore.getState().photos,
      previousDay,
    );

    expect(photos.map((photo) => photo.clientId)).toEqual(['before']);
    expect(beerPhotoUri(photos[0])).toBe('file:///docs/beer-photos/before.jpg');
  });

  it('ignores invalid timestamps instead of leaking them into a recap', () => {
    useBeerPhotosStore.getState().addPendingPhoto(
      pendingInput('broken', { takenAt: 'not-a-date' }),
    );

    expect(
      beerPhotosForDrinkingDay(useBeerPhotosStore.getState().photos, '2026-07-04'),
    ).toEqual([]);
  });
});

describe('loadBeerPhotos', () => {
  it('reconciles with the server list when the fetch succeeds', async () => {
    fetchMyBeerPhotos.mockResolvedValueOnce([serverPhoto('c1')]);

    await loadBeerPhotos();

    expect(useBeerPhotosStore.getState().photos.map((p) => p.clientId)).toEqual(['c1']);
  });

  it('keeps the local view when the fetch fails (offline)', async () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('c1'));
    fetchMyBeerPhotos.mockResolvedValueOnce(null);

    await loadBeerPhotos();

    expect(useBeerPhotosStore.getState().photos.map((p) => p.clientId)).toEqual(['c1']);
  });

  it('rehydrates the persisted snapshot only once per process', async () => {
    fetchMyBeerPhotos.mockResolvedValue(null);
    // Consume the one-time rehydrate (earlier tests may already have).
    await loadBeerPhotos();

    const rehydrateSpy = jest.spyOn(useBeerPhotosStore.persist, 'rehydrate');
    await loadBeerPhotos();
    await loadBeerPhotos();

    // Re-running rehydrate would clobber live in-memory state (e.g. a
    // markSynced that landed mid-flush) with the stale persisted snapshot.
    expect(rehydrateSpy).not.toHaveBeenCalled();
    rehydrateSpy.mockRestore();
  });
});
