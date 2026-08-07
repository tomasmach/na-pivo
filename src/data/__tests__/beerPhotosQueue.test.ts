/**
 * Tests for the beer-photos upload queue (src/data/beerPhotosQueue.ts) — the
 * persist-before-send retry contract, dedup by clientId, the ok/permanent/retry
 * keep-drop rule, and the store/file side effects (markSynced BEFORE the local
 * file delete; markFailed keeps the file).
 *
 * Collaborators are mocked: uploadBeerPhoto (the network), the beerPhotosStore
 * (side-effect spies), AsyncStorage (jest mock), and expo-file-system (records
 * copy/delete calls in a shared `events` log so ordering can be asserted).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const ACCOUNT_A = {
  deviceId: 'device-a',
  accountId: 'account-a',
  token: 'token-a',
  authenticated: true,
};
const ACCOUNT_B = {
  deviceId: 'device-b',
  accountId: 'account-b',
  token: 'token-b',
  authenticated: true,
};
let mockCurrentAccount = ACCOUNT_A;
const mockEnsureAccount = jest.fn(async () => mockCurrentAccount);
jest.mock('../account', () => ({
  ensureAccount: (...args: unknown[]) => mockEnsureAccount(...(args as [])),
}));

/** Shared ordered event log — store updates and file deletes both append here. */
const events: string[] = [];

const uploadBeerPhoto: jest.Mock<Promise<BeerPhotoUploadResult>, unknown[]> = jest.fn(
  async () => ({ status: 'ok' as const, photo: serverPhoto('c1') }),
);
const deleteBeerPhotoByClientId: jest.Mock<Promise<boolean>, unknown[]> = jest.fn(
  async () => true,
);
jest.mock('../beerPhotosClient', () => ({
  uploadBeerPhoto: (...args: unknown[]) => uploadBeerPhoto(...(args as [])),
  deleteBeerPhotoByClientId: (...args: unknown[]) =>
    deleteBeerPhotoByClientId(...args),
}));

const enterPhotoContest: jest.Mock<Promise<Record<string, unknown>>, unknown[]> = jest.fn(
  async () => ({ ok: true, entry: {} }),
);
jest.mock('../photoContestClient', () => ({
  enterPhotoContest: (...args: unknown[]) => enterPhotoContest(...args),
}));

const addPendingPhoto = jest.fn();
const markSynced = jest.fn(() => {
  events.push('markSynced');
});
const markFailed = jest.fn(() => {
  events.push('markFailed');
});
const resolvePendingPartyAssociation = jest.fn();
const removePhoto = jest.fn();
/** Store photos visible to the orphaned-pending reconciliation. */
let mockStorePhotos: {
  clientId: string;
  syncState: string;
  createdAt: string;
  takenAt: string;
}[] = [];
jest.mock('@/stores/beerPhotosStore', () => ({
  useBeerPhotosStore: {
    getState: () => ({
      addPendingPhoto,
      markSynced,
      markFailed,
      resolvePendingPartyAssociation,
      removePhoto,
      photos: mockStorePhotos,
    }),
  },
}));

const fileDelete = jest.fn(() => {
  events.push('file-delete');
});
const fileCopy = jest.fn(async () => {
  events.push('file-copy');
});
jest.mock('expo-file-system', () => {
  type UriPart = string | { uri: string };
  const join = (uris: UriPart[]) =>
    uris.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  class Directory {
    uri: string;
    exists = true;
    constructor(...uris: UriPart[]) {
      this.uri = join(uris);
    }
    create(): void {}
    delete(): void {}
  }
  class File {
    uri: string;
    exists = true;
    constructor(...uris: UriPart[]) {
      this.uri = join(uris);
    }
    copy = (...args: unknown[]) => fileCopy(...(args as []));
    delete = () => fileDelete();
  }
  return {
    File,
    Directory,
    Paths: { document: new Directory('file:///docs'), cache: new Directory('file:///cache') },
    UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  };
});

import {
  clearBeerPhotosQueue,
  deleteBeerPhotoLocalFile,
  enqueueBeerPhoto,
  flushBeerPhotosQueue,
  persistBeerPhotoLocally,
  removeQueuedBeerPhoto,
  resolveBeerPhotoPartyAssociation,
  type BeerPhotoUploadOp,
} from '../beerPhotosQueue';
import type { BeerPhoto, BeerPhotoUploadResult } from '../beerPhotosClient';
import { clearBeerPhotoDeletionTombstones } from '../beerPhotoDeletionTombstones';
import {
  beginBeerPhotoSessionTransition,
  resetBeerPhotoSessionBoundaryForTests,
} from '../beerPhotoSessionBoundary';

const STORAGE_KEY = 'na-pivo-beer-photos-queue';

function serverPhoto(clientId: string): BeerPhoto {
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
  };
}

function op(clientId: string, over: Partial<BeerPhotoUploadOp> = {}): BeerPhotoUploadOp {
  return {
    clientId,
    localUri: `file:///docs/beer-photos/${clientId}.jpg`,
    caption: 'Večer',
    visibility: 'private',
    takenAt: '2026-07-01T19:00:00.000Z',
    ...over,
  };
}

async function readQueue(): Promise<BeerPhotoUploadOp[]> {
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

async function enqueueAndComplete(photoOp: BeerPhotoUploadOp): Promise<void> {
  const queued = await enqueueBeerPhoto(photoOp);
  expect(queued.persisted).toBe(true);
  await queued.completion;
}

beforeEach(async () => {
  resetBeerPhotoSessionBoundaryForTests();
  await clearBeerPhotoDeletionTombstones();
  await clearBeerPhotosQueue();
  jest.clearAllMocks();
  mockCurrentAccount = ACCOUNT_A;
  events.length = 0;
  mockStorePhotos = [];
  uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
  enterPhotoContest.mockResolvedValue({ ok: true, entry: {} });
  deleteBeerPhotoByClientId.mockResolvedValue(true);
  await AsyncStorage.clear();
});

describe('persistBeerPhotoLocally', () => {
  it('copies the picked image into the durable diary path and returns its uri', async () => {
    const uri = await persistBeerPhotoLocally('file:///cache/picked.jpg', 'c1');

    expect(fileCopy).toHaveBeenCalledTimes(1);
    expect(uri).toBe('file:///docs/beer-photos/c1.jpg');
  });

  it('falls back to the picked uri when the copy fails', async () => {
    fileCopy.mockRejectedValueOnce(new Error('disk full'));

    const uri = await persistBeerPhotoLocally('file:///cache/picked.jpg', 'c1');

    expect(uri).toBe('file:///cache/picked.jpg');
  });

  it('removes a copy that finishes after an account transition begins', async () => {
    let resolveCopy!: () => void;
    fileCopy.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCopy = resolve;
      }),
    );
    const persisting = persistBeerPhotoLocally('file:///cache/picked.jpg', 'c1');
    await waitForExpectation(() => expect(fileCopy).toHaveBeenCalledTimes(1));

    const transition = beginBeerPhotoSessionTransition();
    resolveCopy();

    await expect(persisting).resolves.toBe('file:///cache/picked.jpg');
    // The mock reports a pre-existing destination, so it is replaced first and
    // the newly copied file is deleted again when the generation changes.
    expect(fileDelete).toHaveBeenCalledTimes(2);
    transition.release();
  });
});

describe('photo session transition barrier', () => {
  it('rejects new copies, enqueues, and removals for the whole frozen interval', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op('c1')]));
    const transition = beginBeerPhotoSessionTransition();

    await expect(
      persistBeerPhotoLocally('file:///cache/picked.jpg', 'new-photo'),
    ).resolves.toBe('file:///cache/picked.jpg');
    await expect(enqueueBeerPhoto(op('new-photo'))).resolves.toEqual({
      persisted: false,
      completion: expect.any(Promise),
    });
    await expect(removeQueuedBeerPhoto('c1')).resolves.toBe(false);

    expect(fileCopy).not.toHaveBeenCalled();
    expect(addPendingPhoto).not.toHaveBeenCalled();
    expect(mockEnsureAccount).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([op('c1')]);
    transition.release();
  });

  it('rolls back a durable enqueue write when the transition starts before confirmation', async () => {
    let resolveWrite!: () => void;
    jest.spyOn(AsyncStorage, 'setItem').mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const enqueueing = enqueueBeerPhoto(op('old-account'));
    await waitForExpectation(() => expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1));

    const transition = beginBeerPhotoSessionTransition();
    resolveWrite();

    await expect(enqueueing).resolves.toEqual({
      persisted: false,
      completion: expect.any(Promise),
    });
    expect(addPendingPhoto).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
    transition.release();
  });

  it('restores an older retry op when a replacement enqueue overlaps the transition', async () => {
    const previous = op('same-photo', { caption: 'původní' });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([previous]));
    let resolveWrite!: () => void;
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    setItem.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const enqueueing = enqueueBeerPhoto(op('same-photo', { caption: 'nová' }));
    await waitForExpectation(() => expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1));

    const transition = beginBeerPhotoSessionTransition();
    resolveWrite();

    await expect(enqueueing).resolves.toEqual({
      persisted: false,
      completion: expect.any(Promise),
    });
    expect(await readQueue()).toEqual([previous]);
    transition.release();
  });
});

describe('enqueueBeerPhoto', () => {
  it('adds an optimistic pending entry to the store and persists BEFORE sending', async () => {
    let resolveUpload!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValueOnce(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const enqueued = await enqueueBeerPhoto(op('c1'));
    expect(enqueued.persisted).toBe(true);
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));

    // The op is already on disk while the upload is still in flight.
    expect(addPendingPhoto).toHaveBeenCalledWith(op('c1'));
    expect(await readQueue()).toHaveLength(1);

    resolveUpload({ status: 'ok', photo: serverPhoto('c1') });
    await enqueued.completion;
    expect(await readQueue()).toEqual([]);
  });

  it('does not expose or upload a photo when the durable queue write fails', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    const queued = await enqueueBeerPhoto(op('c1'));

    expect(queued.persisted).toBe(false);
    await expect(queued.completion).resolves.toBeUndefined();
    expect(addPendingPhoto).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });

  it('dedups by clientId — a re-enqueue replaces the pending op (last write wins)', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await enqueueAndComplete(op('c1', { caption: 'první' }));
    await enqueueAndComplete(op('c1', { caption: 'druhá' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].caption).toBe('druhá');
  });

  it('keeps distinct clientIds as separate items', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await enqueueAndComplete(op('c1'));
    await enqueueAndComplete(op('c2'));
    expect((await readQueue()).map((item) => item.clientId).sort()).toEqual(['c1', 'c2']);
  });

  it('keeps the party code through persistence and upload delivery', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });

    await enqueueAndComplete(op('c1', { partyCode: 'PIVOXY' }));

    expect((await readQueue())[0].partyCode).toBe('PIVOXY');
    expect(uploadBeerPhoto.mock.calls[0][1]).toMatchObject({ partyCode: 'PIVOXY' });
  });

  it('keeps an offline-only Party drinking day local through persistence', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });

    await enqueueAndComplete(op('c1', { partyDrinkingDay: '2026-08-05' }));

    expect((await readQueue())[0].partyDrinkingDay).toBe('2026-08-05');
    expect(addPendingPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ partyDrinkingDay: '2026-08-05' }),
    );
    expect(uploadBeerPhoto.mock.calls[0][1]).not.toHaveProperty('partyDrinkingDay');
  });

  it('holds a photo behind a reserved table code until create is confirmed', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });

    const queued = await enqueueBeerPhoto(
      op('c1', { pendingPartyCode: 'PIVOXY', partyDrinkingDay: '2026-08-05' }),
    );
    await queued.completion;

    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([
      expect.objectContaining({ clientId: 'c1', pendingPartyCode: 'PIVOXY' }),
    ]);

    await expect(
      resolveBeerPhotoPartyAssociation('pivoxy', 'PIVOXY'),
    ).resolves.toBe(true);

    expect(resolvePendingPartyAssociation).toHaveBeenCalledWith('PIVOXY', 'PIVOXY');
    expect(uploadBeerPhoto).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ partyCode: 'PIVOXY' }),
      expect.any(AbortSignal),
    );
    expect(await readQueue()).toEqual([]);
  });

  it('releases a deferred photo without a party code when table create fails', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    const queued = await enqueueBeerPhoto(op('c1', { pendingPartyCode: 'PIVOXY' }));
    await queued.completion;

    await expect(
      resolveBeerPhotoPartyAssociation('PIVOXY', null),
    ).resolves.toBe(true);

    expect(resolvePendingPartyAssociation).toHaveBeenCalledWith('PIVOXY', null);
    expect(uploadBeerPhoto.mock.calls[0][1]).toHaveProperty('partyCode', undefined);
    expect(await readQueue()).toEqual([
      expect.not.objectContaining({ pendingPartyCode: expect.anything() }),
    ]);
  });
});

describe('flush keep/drop contract', () => {
  it("'ok' → markSynced with the server photo, THEN delete the local file, drop from queue", async () => {
    const photo = serverPhoto('c1');
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo });

    await enqueueAndComplete(op('c1'));

    expect(markSynced).toHaveBeenCalledWith('c1', photo);
    // The store swaps to the remote imageUrl BEFORE the local file dies — the
    // diary must never point at a deleted uri.
    expect(events).toEqual(['markSynced', 'file-delete']);
    expect(await readQueue()).toEqual([]);
  });

  it("'permanent-error' → markFailed WITH the backend code, drop from queue, local file KEPT", async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'permanent-error', code: 'photo_limit_reached' });

    await enqueueAndComplete(op('c1'));

    // The code is persisted so the diary can show the specific Czech message
    // (album full / too large / invalid) instead of a generic failure.
    expect(markFailed).toHaveBeenCalledWith('c1', 'photo_limit_reached');
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });

  it("'retry' → kept for the next flush, no store finalization", async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });

    await enqueueAndComplete(op('c1'));

    expect(markSynced).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(await readQueue()).toHaveLength(1);

    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
    await flushBeerPhotosQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('enters FotoPivař after upload and marks the synced photo as entered', async () => {
    const photo = serverPhoto('c1');
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo });

    await enqueueAndComplete(op('c1', { enterContest: true }));

    expect(enterPhotoContest).toHaveBeenCalledWith(photo.id, expect.anything());
    expect(markSynced).toHaveBeenCalledWith('c1', { ...photo, inContest: true });
    expect(await readQueue()).toEqual([]);
  });

  it('keeps the durable contest intent when entry fails transiently', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
    enterPhotoContest.mockResolvedValue({
      ok: false,
      code: 'network',
      detail: 'Bez sítě.',
    });

    await enqueueAndComplete(op('c1', { enterContest: true }));

    expect(markSynced).not.toHaveBeenCalled();
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([op('c1', { enterContest: true })]);
  });

  it('keeps the diary photo when contest entry is permanently rejected', async () => {
    const photo = serverPhoto('c1');
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo });
    enterPhotoContest.mockResolvedValue({
      ok: false,
      code: 'nickname_required',
      detail: 'Chybí přezdívka.',
    });

    await enqueueAndComplete(op('c1', { enterContest: true }));

    expect(markSynced).toHaveBeenCalledWith('c1', photo);
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('does nothing on an empty queue and survives corrupted storage', async () => {
    await flushBeerPhotosQueue();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();

    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushBeerPhotosQueue()).resolves.toBeUndefined();
  });

  it('does not upload when privacy tombstones cannot be read strictly', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op('c1')]));
    const getItem = AsyncStorage.getItem as jest.MockedFunction<
      typeof AsyncStorage.getItem
    >;
    getItem.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(flushBeerPhotosQueue()).resolves.toBeUndefined();

    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([op('c1')]);
  });

  it('drops malformed persisted entries instead of delivering them', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ clientId: 'c1' }, op('c2'), 42, null]),
    );
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c2') });

    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
    expect((uploadBeerPhoto.mock.calls[0] as unknown[])[1]).toMatchObject({ clientId: 'c2' });
  });
});

describe('pending-photo deletion', () => {
  it('cancels an in-flight upload and deletes a late native success without re-adding it', async () => {
    let resolveUpload!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValueOnce(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const enqueued = await enqueueBeerPhoto(op('delete-me'));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));
    const uploadSignal = uploadBeerPhoto.mock.calls[0][2] as AbortSignal;

    await expect(removeQueuedBeerPhoto('delete-me')).resolves.toBe(true);
    expect(uploadSignal.aborted).toBe(true);
    expect(await readQueue()).toEqual([]);

    // Expo's native upload can ignore/observe abort too late and still return
    // the committed server row. Deletion must win without markSynced re-adding
    // the photo to the local diary.
    resolveUpload({ status: 'ok', photo: serverPhoto('delete-me') });
    await enqueued.completion;
    await flushBeerPhotosQueue();

    expect(markSynced).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(removePhoto).toHaveBeenCalledWith('delete-me');
    expect(deleteBeerPhotoByClientId).toHaveBeenCalledWith(
      'delete-me',
      undefined,
      expect.objectContaining({ accountId: 'account-a', token: 'token-a' }),
    );
    expect(await AsyncStorage.getItem('na-pivo-beer-photo-deletion-tombstones')).toBeNull();
  });

  it('keeps an account A delete durable across clear and never sends it as account B', async () => {
    let resolveUpload!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValueOnce(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const enqueued = await enqueueBeerPhoto(op('old-account-photo'));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));
    await expect(removeQueuedBeerPhoto('old-account-photo')).resolves.toBe(true);

    // Account A disappears locally while its native POST is still unresolved.
    await clearBeerPhotosQueue();
    mockCurrentAccount = ACCOUNT_B;
    resolveUpload({ status: 'ok', photo: serverPhoto('old-account-photo') });
    await enqueued.completion;
    await flushBeerPhotosQueue();

    expect(deleteBeerPhotoByClientId).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        (await AsyncStorage.getItem('na-pivo-beer-photo-deletion-tombstones')) ?? '[]',
      ),
    ).toEqual([
      { clientId: 'old-account-photo', accountId: 'account-a' },
    ]);

    // The marker can only leave disk after account A is authenticated again.
    mockCurrentAccount = ACCOUNT_A;
    await flushBeerPhotosQueue();

    expect(deleteBeerPhotoByClientId).toHaveBeenCalledWith(
      'old-account-photo',
      expect.any(AbortSignal),
      expect.objectContaining({ accountId: 'account-a', token: 'token-a' }),
    );
    expect(await AsyncStorage.getItem('na-pivo-beer-photo-deletion-tombstones')).toBeNull();
    expect(markSynced).not.toHaveBeenCalled();
  });
});

describe('queue overflow (MAX_QUEUE_LENGTH)', () => {
  it('marks overflow-dropped ops failed instead of leaving them stuck pending', async () => {
    // Prefill exactly at the cap; the new enqueue pushes the oldest out.
    const backlog = Array.from({ length: 100 }, (_, i) => op(`old-${i}`));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(backlog));
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });

    await enqueueAndComplete(op('newest'));

    // The dropped op is flipped to failed (local file KEPT → retry works)…
    expect(markFailed).toHaveBeenCalledWith('old-0', 'queue_overflow');
    expect(fileDelete).not.toHaveBeenCalled();
    // …and the queue holds the cap with the newest op included.
    const queue = await readQueue();
    expect(queue).toHaveLength(100);
    expect(queue.map((item) => item.clientId)).toContain('newest');
    expect(queue.map((item) => item.clientId)).not.toContain('old-0');
  });
});

describe('orphaned-pending reconciliation (crash window repair)', () => {
  const OLD = '2026-07-01T19:00:00.000Z';

  function storePhoto(clientId: string, over: Partial<(typeof mockStorePhotos)[number]> = {}) {
    return { clientId, syncState: 'pending', createdAt: OLD, takenAt: OLD, ...over };
  }

  it('flips a stale pending store entry with no queue op to failed', async () => {
    mockStorePhotos = [storePhoto('ghost')];

    await flushBeerPhotosQueue();

    expect(markFailed).toHaveBeenCalledWith('ghost');
  });

  it('leaves queued, fresh, and non-pending entries alone', async () => {
    mockStorePhotos = [
      // Still covered by a queue op → not an orphan.
      storePhoto('queued'),
      // Queue-less but too fresh — enqueue may still be persisting it.
      storePhoto('fresh', { createdAt: new Date().toISOString() }),
      // Not pending → never touched.
      storePhoto('done', { syncState: 'synced' }),
    ];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op('queued')]));
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });

    await flushBeerPhotosQueue();

    expect(markFailed).not.toHaveBeenCalled();
  });
});

describe('clearBeerPhotosQueue (account boundary)', () => {
  it('wipes pending ops without delivering them', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await enqueueAndComplete(op('c1'));
    expect(await readQueue()).toHaveLength(1);

    await clearBeerPhotosQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('does not deliver remaining items after clear runs during an in-flight flush', async () => {
    let resolveFirst!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValueOnce(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op('c1'), op('c2')]));

    const flushing = flushBeerPhotosQueue();
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));

    await clearBeerPhotosQueue();
    resolveFirst({ status: 'ok', photo: serverPhoto('c1') });
    await flushing;

    // c2 must never be uploaded under the session that replaces this one.
    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
    expect((uploadBeerPhoto.mock.calls[0] as unknown[])[1]).toMatchObject({ clientId: 'c1' });
    expect(markSynced).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });

  it('rejects an enqueue whose durable write overlaps an account clear', async () => {
    let resolveWrite!: () => void;
    jest.spyOn(AsyncStorage, 'setItem').mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );

    const enqueueing = enqueueBeerPhoto(op('old-account'));
    await waitForExpectation(() => expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1));

    // Invalidate synchronously while enqueue still owns the mutation lock.
    const clearing = clearBeerPhotosQueue();
    resolveWrite();

    const queued = await enqueueing;
    await clearing;

    expect(queued.persisted).toBe(false);
    await expect(queued.completion).resolves.toBeUndefined();
    expect(addPendingPhoto).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });
});

describe('deleteBeerPhotoLocalFile', () => {
  it('best-effort deletes the durable file and never throws', () => {
    deleteBeerPhotoLocalFile('c1');
    expect(fileDelete).toHaveBeenCalledTimes(1);

    fileDelete.mockImplementationOnce(() => {
      throw new Error('gone');
    });
    expect(() => deleteBeerPhotoLocalFile('c1')).not.toThrow();
  });
});
