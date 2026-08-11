/**
 * Tests for the beer-photos store (src/stores/beerPhotosStore.ts) — the merge
 * logic between the authoritative server list and locally-pending uploads.
 *
 * AsyncStorage is the jest mock (persist middleware writes there); the client
 * is mocked so loadBeerPhotos never touches the network.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearBeerPhotoDeletionTombstones,
  completeBeerPhotoDeletionTombstone,
  queueBeerPhotoDeletionTombstone,
} from '@/data/beerPhotoDeletionTombstones';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const fetchMyBeerPhotos = jest.fn(async (): Promise<unknown> => null);
jest.mock('@/data/beerPhotosClient', () => ({
  fetchMyBeerPhotos: (...args: unknown[]) => fetchMyBeerPhotos(...(args as [])),
}));

let currentAccountId: string | null = 'account-a';
const ensureAccount = jest.fn(async () =>
  currentAccountId
    ? {
        deviceId: `device-${currentAccountId}`,
        accountId: currentAccountId,
        token: `token-${currentAccountId}`,
        authenticated: true,
      }
    : null,
);
/** Whether SecureStore already holds a session — no account means nothing to
 *  reconcile, and asking ensureAccount() would silently provision one. */
let durableSessionExists = true;
const readDurableAccountSession = jest.fn(async () => ({
  available: true,
  session:
    durableSessionExists && currentAccountId
      ? {
          deviceId: `device-${currentAccountId}`,
          accountId: currentAccountId,
          token: `token-${currentAccountId}`,
          authenticated: true,
        }
      : null,
}));
jest.mock('@/data/account', () => ({
  ensureAccount: (...args: unknown[]) => ensureAccount(...(args as [])),
  readDurableAccountSession: (...args: unknown[]) =>
    readDurableAccountSession(...(args as [])),
}));

import {
  clearBeerPhotosAccountData,
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
  await clearBeerPhotoDeletionTombstones();
  jest.clearAllMocks();
  currentAccountId = 'account-a';
  await AsyncStorage.clear();
  useBeerPhotosStore.setState({ photos: [] });
});

async function waitForCallCount(mock: jest.Mock, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && mock.mock.calls.length < count; attempt += 1) {
    await Promise.resolve();
  }
}

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

  it('retains the party association after the queued photo syncs', () => {
    const store = useBeerPhotosStore.getState();
    store.addPendingPhoto(
      pendingInput('c1', { partyCode: 'PIVOXY', partyDrinkingDay: '2026-07-05' }),
    );

    store.markSynced('c1', serverPhoto('c1'));

    expect(useBeerPhotosStore.getState().photos[0].partyCode).toBe('PIVOXY');
    expect(useBeerPhotosStore.getState().photos[0].partyDrinkingDay).toBe('2026-07-05');
  });

  it('replaces a reserved table code only after create is confirmed', async () => {
    const store = useBeerPhotosStore.getState();
    store.addPendingPhoto(
      pendingInput('c1', {
        pendingPartyCode: 'PIVOXY',
        partyDrinkingDay: '2026-07-05',
      }),
    );

    store.resolvePendingPartyAssociation('pivoxy', 'STUL24');

    expect(useBeerPhotosStore.getState().photos[0]).toMatchObject({
      partyCode: 'STUL24',
      partyDrinkingDay: '2026-07-05',
    });
    expect(useBeerPhotosStore.getState().photos[0].pendingPartyCode).toBeUndefined();
    // Let Zustand's async persistence finish before the next test clears the
    // shared AsyncStorage mock.
    await Promise.resolve();
    await Promise.resolve();
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

  it('never re-adds a stale GET row after its durable delete was acknowledged', async () => {
    await queueBeerPhotoDeletionTombstone('c1', 'account-a');
    useBeerPhotosStore.getState().setServerPhotos([serverPhoto('c1')], 'account-a');
    expect(useBeerPhotosStore.getState().photos).toEqual([]);

    // Server acknowledgement removes the disk retry, but same-process read
    // suppression stays until the account boundary so an older GET cannot win.
    await completeBeerPhotoDeletionTombstone('c1', 'account-a');
    useBeerPhotosStore.getState().setServerPhotos([serverPhoto('c1')], 'account-a');
    expect(useBeerPhotosStore.getState().photos).toEqual([]);
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

describe('loadBeerPhotos', () => {
  it('does not fetch or apply a server snapshot when tombstones are unreadable', async () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('local-safe'));
    const getItem = AsyncStorage.getItem as jest.MockedFunction<
      typeof AsyncStorage.getItem
    >;
    getItem.mockRejectedValueOnce(new Error('storage unavailable'));

    await loadBeerPhotos();

    expect(fetchMyBeerPhotos).not.toHaveBeenCalled();
    expect(useBeerPhotosStore.getState().photos.map((photo) => photo.clientId)).toEqual([
      'local-safe',
    ]);
  });

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

  it('ignores an account A fetch that resolves after the private-data boundary clear', async () => {
    let resolveFetch!: (photos: BeerPhoto[] | null) => void;
    fetchMyBeerPhotos.mockImplementationOnce(
      () => new Promise<BeerPhoto[] | null>((resolve) => { resolveFetch = resolve; }),
    );

    const loading = loadBeerPhotos();
    await waitForCallCount(fetchMyBeerPhotos, 1);
    expect(fetchMyBeerPhotos).toHaveBeenCalledTimes(1);
    expect(fetchMyBeerPhotos).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ accountId: 'account-a' }),
    );

    const clearing = clearBeerPhotosAccountData();
    currentAccountId = 'account-b';
    resolveFetch([serverPhoto('account-a-photo')]);

    await Promise.all([loading, clearing]);

    expect(useBeerPhotosStore.getState().photos).toEqual([]);
    expect(await AsyncStorage.getItem('na-pivo-beer-photos')).toBeNull();

    // Observing the replacement identity releases the exact outgoing-session
    // guard, so a later login to another account loads normally.
    fetchMyBeerPhotos.mockResolvedValueOnce(null);
    await loadBeerPhotos();
  });

  it('does not start or commit a load inside the account-clear window', async () => {
    let resolveOutgoing!: (session: {
      deviceId: string;
      accountId: string;
      token: string;
      authenticated: boolean;
    }) => void;
    ensureAccount.mockImplementationOnce(
      () => new Promise((resolve) => { resolveOutgoing = resolve; }),
    );

    const clearing = clearBeerPhotosAccountData();
    const loadingInsideClear = loadBeerPhotos();
    await loadingInsideClear;

    expect(fetchMyBeerPhotos).not.toHaveBeenCalled();
    resolveOutgoing({
      deviceId: 'device-account-a',
      accountId: 'account-a',
      token: 'token-account-a',
      authenticated: true,
    });
    await clearing;

    // The old credential is still installed until auth rotates it; it remains
    // blocked even though the storage clear itself has finished.
    await loadBeerPhotos();
    expect(fetchMyBeerPhotos).not.toHaveBeenCalled();

    currentAccountId = 'account-b';
    fetchMyBeerPhotos.mockResolvedValueOnce(null);
    await loadBeerPhotos();
    expect(fetchMyBeerPhotos).toHaveBeenCalledTimes(1);
  });

  it('never provisions an account for a visitor who has none yet', async () => {
    useBeerPhotosStore.getState().addPendingPhoto(pendingInput('local-only'));
    durableSessionExists = false;
    ensureAccount.mockClear();

    await loadBeerPhotos();

    expect(ensureAccount).not.toHaveBeenCalled();
    expect(fetchMyBeerPhotos).not.toHaveBeenCalled();
    // The local album is untouched; only the server round trip is skipped.
    expect(useBeerPhotosStore.getState().photos.map((photo) => photo.clientId)).toEqual([
      'local-only',
    ]);
    durableSessionExists = true;
  });

  it('reconciles once per account when the caller opts into `once`', async () => {
    fetchMyBeerPhotos.mockResolvedValue([]);
    await loadBeerPhotos(undefined, { once: true });
    const afterFirst = fetchMyBeerPhotos.mock.calls.length;

    await loadBeerPhotos(undefined, { once: true });
    await loadBeerPhotos(undefined, { once: true });
    expect(fetchMyBeerPhotos).toHaveBeenCalledTimes(afterFirst);

    // A different account is different data, so the next open asks again.
    const clearing = clearBeerPhotosAccountData();
    currentAccountId = 'account-c';
    await clearing;
    await loadBeerPhotos(undefined, { once: true });
    expect(fetchMyBeerPhotos).toHaveBeenCalledTimes(afterFirst + 1);
    currentAccountId = 'account-a';
    fetchMyBeerPhotos.mockReset();
    fetchMyBeerPhotos.mockResolvedValue(null);
    await loadBeerPhotos();
  });

  it('lets the newest overlapping load win for the same account', async () => {
    let resolveFirst!: (photos: BeerPhoto[] | null) => void;
    let resolveSecond!: (photos: BeerPhoto[] | null) => void;
    fetchMyBeerPhotos
      .mockImplementationOnce(
        () => new Promise<BeerPhoto[] | null>((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise<BeerPhoto[] | null>((resolve) => { resolveSecond = resolve; }),
      );

    const firstLoad = loadBeerPhotos();
    await waitForCallCount(fetchMyBeerPhotos, 1);
    const secondLoad = loadBeerPhotos();
    await waitForCallCount(fetchMyBeerPhotos, 2);
    expect(fetchMyBeerPhotos).toHaveBeenCalledTimes(2);

    resolveSecond([serverPhoto('newest')]);
    await secondLoad;
    resolveFirst([serverPhoto('stale')]);
    await firstLoad;

    expect(useBeerPhotosStore.getState().photos.map((photo) => photo.clientId)).toEqual([
      'newest',
    ]);
  });
});

describe('account-boundary hydration', () => {
  it('never waits forever when two hydrations start but Zustand completes only the newest', async () => {
    const stalePhoto = {
      id: null,
      clientId: 'account-a-local',
      imageUrl: null,
      caption: 'Soukromá fotka A',
      pubCacheKey: '',
      pubName: '',
      pubCity: '',
      visibility: 'private' as const,
      takenAt: '2026-07-05T20:00:00.000Z',
      createdAt: '2026-07-05T20:00:00.000Z',
      inContest: false,
      localUri: 'file:///account-a.jpg',
      syncState: 'pending' as const,
    };
    const getItemMock = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    const originalGetItem = getItemMock.getMockImplementation();
    expect(originalGetItem).toBeDefined();
    const resolveReads: ((value: string | null) => void)[] = [];
    getItemMock.mockImplementation((key) => {
      if (key !== 'na-pivo-beer-photos' || resolveReads.length >= 2) {
        return originalGetItem!(key);
      }
      return new Promise<string | null>((resolve) => { resolveReads.push(resolve); });
    });

    try {
      const olderHydration = useBeerPhotosStore.persist.rehydrate();
      const newestHydration = useBeerPhotosStore.persist.rehydrate();
      for (let attempt = 0; attempt < 20 && resolveReads.length < 2; attempt += 1) {
        await Promise.resolve();
      }
      expect(resolveReads).toHaveLength(2);

      // The clear must settle without waiting for hydration completion hooks:
      // Zustand suppresses the older hook once a newer hydration has started.
      const clearing = clearBeerPhotosAccountData();
      await clearing;
      expect(useBeerPhotosStore.getState().photos).toEqual([]);

      const staleSnapshot = JSON.stringify({ state: { photos: [stalePhoto] }, version: 1 });
      resolveReads[0](staleSnapshot);
      resolveReads[1](staleSnapshot);
      await Promise.all([olderHydration, newestHydration]);

      expect(useBeerPhotosStore.getState().photos).toEqual([]);
      expect(await originalGetItem!('na-pivo-beer-photos')).toBeNull();
    } finally {
      getItemMock.mockImplementation(originalGetItem!);
    }
  });
});
