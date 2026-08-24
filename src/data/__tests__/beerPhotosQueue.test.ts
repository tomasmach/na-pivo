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

import {
  clearBeerPhotosQueue,
  deleteBeerPhotoLocalFile,
  enqueueBeerPhoto,
  flushBeerPhotosQueue,
  persistBeerPhotoLocally,
  releaseOrphanedBeerPhotoPartyAssociations,
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

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
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
const markSynced = jest.fn(async () => {
  events.push('markSynced');
  return true;
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

  it('recovers every reserved photo after a restart confirms there is no table', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await (await enqueueBeerPhoto(op('c1', { pendingPartyCode: 'PIVOXY' }))).completion;
    await (await enqueueBeerPhoto(op('c2', { pendingPartyCode: 'STULIK' }))).completion;
    expect(uploadBeerPhoto).not.toHaveBeenCalled();

    await expect(releaseOrphanedBeerPhotoPartyAssociations()).resolves.toBe(true);

    // Retryable uploads stay visibly reserved in both the store and queue.
    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(await readQueue()).toEqual([
      expect.objectContaining({
        pendingPartyCode: 'PIVOXY',
        orphanReleaseCandidate: true,
      }),
      expect.objectContaining({
        pendingPartyCode: 'STULIK',
        orphanReleaseCandidate: true,
      }),
    ]);
  });

  it('keeps a crash-left recovery candidate inert until a current refresh reauthorizes it', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      op('c1', {
        pendingPartyCode: 'PIVOXY',
        orphanReleaseCandidate: true,
      }),
    ]));

    // The persisted marker can survive a process crash, but its in-memory
    // authorization cannot. A startup flush must therefore keep it reserved.
    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([
      expect.objectContaining({
        clientId: 'c1',
        pendingPartyCode: 'PIVOXY',
        orphanReleaseCandidate: true,
      }),
    ]);

    await expect(releaseOrphanedBeerPhotoPartyAssociations()).resolves.toBe(true);

    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale cached table reclaim a confirmed-none candidate after restart', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      op('c1', {
        pendingPartyCode: 'PIVOXY',
        orphanReleaseCandidate: true,
      }),
    ]));
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });

    await (
      resolveBeerPhotoPartyAssociation as unknown as (
        pendingCode: string,
        confirmedCode: string,
        options: { authoritative: boolean },
      ) => Promise<boolean>
    )('PIVOXY', 'PIVOXY', { authoritative: false });

    expect(await readQueue()).toEqual([
      expect.objectContaining({
        clientId: 'c1',
        pendingPartyCode: 'PIVOXY',
        orphanReleaseCandidate: true,
      }),
    ]);
    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();

    // The next authoritative confirmed-none refresh clears its cache and
    // reauthorizes the durable candidate. It uploads and detaches exactly once.
    await expect(releaseOrphanedBeerPhotoPartyAssociations()).resolves.toBe(true);

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
    expect(resolvePendingPartyAssociation).toHaveBeenCalledTimes(1);
    expect(resolvePendingPartyAssociation).toHaveBeenCalledWith('PIVOXY', null);
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('releases an old reservation while protecting the currently confirmed table', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('old') });
    await (await enqueueBeerPhoto(op('current', { pendingPartyCode: 'STULIK' }))).completion;
    await (await enqueueBeerPhoto(op('old', { pendingPartyCode: 'PIVOXY' }))).completion;

    await expect(
      releaseOrphanedBeerPhotoPartyAssociations(() => true, 'STULIK'),
    ).resolves.toBe(true);

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
    expect(uploadBeerPhoto.mock.calls[0][1]).toMatchObject({ clientId: 'old' });
    expect(resolvePendingPartyAssociation).toHaveBeenCalledWith('PIVOXY', null);
    expect(resolvePendingPartyAssociation).not.toHaveBeenCalledWith('STULIK', null);
    expect(await readQueue()).toEqual([
      expect.objectContaining({
        clientId: 'current',
        pendingPartyCode: 'STULIK',
      }),
    ]);
  });

  it('keeps an authoritative orphan release committed when a new table starts during its upload', async () => {
    let resolveUpload!: (result: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValue(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    await (await enqueueBeerPhoto(op('old', { pendingPartyCode: 'PIVOXY' }))).completion;
    let canRelease = true;

    const recovering = releaseOrphanedBeerPhotoPartyAssociations(
      () => canRelease,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));
    canRelease = false;
    resolveUpload({ status: 'retry' });

    await expect(recovering).resolves.toBe(true);
    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([
      expect.objectContaining({
        clientId: 'old',
        pendingPartyCode: 'PIVOXY',
        orphanReleaseCandidate: true,
      }),
    ]);

    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('old') });
    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(resolvePendingPartyAssociation).toHaveBeenCalledWith('PIVOXY', null);
    expect(await readQueue()).toEqual([]);
  });

  it('settles an authorized orphan when upload succeeds after a newer table starts', async () => {
    let resolveUpload!: (result: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValue(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    await (await enqueueBeerPhoto(op('old', { pendingPartyCode: 'PIVOXY' }))).completion;
    let canRelease = true;

    const recovering = releaseOrphanedBeerPhotoPartyAssociations(
      () => canRelease,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));
    canRelease = false;
    resolveUpload({ status: 'ok', photo: serverPhoto('old') });

    await expect(recovering).resolves.toBe(true);
    expect(markSynced).toHaveBeenCalledWith('old', serverPhoto('old'));
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(resolvePendingPartyAssociation).toHaveBeenCalledWith('PIVOXY', null);
    expect(await readQueue()).toEqual([]);
  });

  it('keeps reserved photos untouched when a new table starts during recovery', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await (await enqueueBeerPhoto(op('c1', { pendingPartyCode: 'PIVOXY' }))).completion;
    const canRelease = jest.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await expect(
      releaseOrphanedBeerPhotoPartyAssociations(canRelease),
    ).resolves.toBe(false);

    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([
      expect.objectContaining({ clientId: 'c1', pendingPartyCode: 'PIVOXY' }),
    ]);
  });

  it('needs no destructive rollback when the table starts after the recovery checkpoint', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await (await enqueueBeerPhoto(op('c1', { pendingPartyCode: 'PIVOXY' }))).completion;
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    setItem.mockResolvedValueOnce(undefined);
    const canRelease = jest.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await expect(
      releaseOrphanedBeerPhotoPartyAssociations(canRelease),
    ).resolves.toBe(false);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([
      expect.objectContaining({ clientId: 'c1', pendingPartyCode: 'PIVOXY' }),
    ]);
  });

  it('keeps old and newly enqueued reservations when a new table starts during the recovery write', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await (await enqueueBeerPhoto(op('old', { pendingPartyCode: 'PIVOXY' }))).completion;
    let resolveRecoveryWrite!: () => void;
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    setItem.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveRecoveryWrite = resolve;
    }));
    let canRelease = true;

    const recovering = releaseOrphanedBeerPhotoPartyAssociations(() => canRelease);
    await waitForExpectation(() => expect(setItem).toHaveBeenCalledTimes(1));
    canRelease = false;
    const enqueuing = enqueueBeerPhoto(op('new', { pendingPartyCode: 'STULIK' }));
    resolveRecoveryWrite();

    await expect(recovering).resolves.toBe(false);
    const queued = await enqueuing;
    await queued.completion;

    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([
      expect.objectContaining({ clientId: 'old', pendingPartyCode: 'PIVOXY' }),
      expect.objectContaining({ clientId: 'new', pendingPartyCode: 'STULIK' }),
    ]);
  });

  it('does not release a reserved photo when the recovery rewrite cannot be persisted', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await (await enqueueBeerPhoto(op('c1', { pendingPartyCode: 'PIVOXY' }))).completion;
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    await expect(releaseOrphanedBeerPhotoPartyAssociations()).resolves.toBe(false);

    expect(resolvePendingPartyAssociation).not.toHaveBeenCalled();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([
      expect.objectContaining({ clientId: 'c1', pendingPartyCode: 'PIVOXY' }),
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

  it('keeps the local file and durable op when the final queue removal fails', async () => {
    const photo = serverPhoto('c1');
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo });
    jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk full'));

    await enqueueAndComplete(op('c1'));

    expect(markSynced).toHaveBeenCalledWith('c1', photo);
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([expect.objectContaining({ clientId: 'c1' })]);

    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('keeps the local file and durable op until the synced store snapshot is durable', async () => {
    const photo = serverPhoto('c1');
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo });
    markSynced.mockResolvedValueOnce(false);

    await enqueueAndComplete(op('c1'));

    expect(markSynced).toHaveBeenCalledWith('c1', photo);
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([expect.objectContaining({ clientId: 'c1' })]);

    // A restart/lifecycle retry sends the same clientId idempotently. Only the
    // first durably-persisted synced snapshot may release the queue and JPEG.
    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(markSynced).toHaveBeenCalledTimes(2);
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('handles a rejected synced-store checkpoint and retries without losing the JPEG', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
    markSynced.mockRejectedValueOnce(new Error('store disk full'));

    await expect(enqueueAndComplete(op('c1'))).resolves.toBeUndefined();

    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([expect.objectContaining({ clientId: 'c1' })]);

    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('does not settle account A when its synced-store checkpoint crosses the boundary', async () => {
    let resolveStorePersistence!: (persisted: boolean) => void;
    markSynced.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveStorePersistence = resolve;
      }),
    );
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });

    const queued = await enqueueBeerPhoto(op('c1'));
    await waitForExpectation(() => expect(markSynced).toHaveBeenCalledTimes(1));

    const transition = beginBeerPhotoSessionTransition();
    resolveStorePersistence(true);
    await queued.completion;

    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([expect.objectContaining({ clientId: 'c1' })]);

    transition.release();
    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(fileDelete).toHaveBeenCalledTimes(1);
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
    const [retained] = await readQueue();
    expect(retained).toMatchObject({
      clientId: 'c1',
      enterContest: true,
      contestCheckpoint: { photo: { id: 'srv-c1' } },
    });
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

  it.each([
    [
      'missing required BeerPhoto fields',
      { photo: { id: 'srv-broken' } },
    ],
    [
      'a mismatched checkpoint clientId',
      { photo: { ...serverPhoto('someone-else'), id: 'srv-broken' } },
    ],
  ])(
    'rejects a persisted contestCheckpoint with %s instead of resuming it',
    async (_label, brokenCheckpoint) => {
      const broken = {
        clientId: 'broken',
        localUri: 'file:///docs/beer-photos/broken.jpg',
        caption: '',
        visibility: 'private',
        takenAt: '2026-07-01T19:00:00.000Z',
        enterContest: true,
        contestCheckpoint: brokenCheckpoint,
      };
      const legacy = {
        clientId: 'legacy',
        localUri: 'file:///docs/beer-photos/legacy.jpg',
        caption: '',
        visibility: 'private',
        takenAt: '2026-07-01T19:00:00.000Z',
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([broken, legacy]));
      uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('legacy') });

      await flushBeerPhotosQueue();

      // Only the valid legacy op may be delivered; the malformed checkpoint
      // must be rejected by validation and never resumed into a contest entry
      // or a store finalization built from an incomplete server photo.
      expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
      expect((uploadBeerPhoto.mock.calls[0] as unknown[])[1]).toMatchObject({
        clientId: 'legacy',
      });
      expect(enterPhotoContest).not.toHaveBeenCalled();
      expect(markSynced).toHaveBeenCalledTimes(1);
      expect(markSynced).toHaveBeenCalledWith('legacy', serverPhoto('legacy'));
      expect(events).toEqual(['markSynced', 'file-delete']);
      expect(await readQueue()).toEqual([]);
    },
  );

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

describe('UGC consent retry contract for contest entry', () => {
  const ugc428Failures = [
    { ok: false as const, code: 'http_428', detail: 'Precondition required.' },
    { ok: false as const, code: 'ugc_consent_required', detail: 'Potřebujeme souhlas.' },
    { ok: false as const, code: 'ugc_policy_update_required', detail: 'Pravidla se změnila.' },
  ];

  it.each(ugc428Failures)(
    'keeps the durable op and contest intent when entry returns $code',
    async (failure) => {
      uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
      enterPhotoContest.mockResolvedValue(failure);

      await enqueueAndComplete(op('c1', { enterContest: true }));

      // REGRESSION: the consent/policy gate is transient — the uploaded photo
      // must not be finalized (synced + local file deleted) and the durable
      // op must survive with its contest intent AND the stable server photo
      // checkpoint, so a restart never forces another upload.
      expect(markSynced).not.toHaveBeenCalled();
      expect(fileDelete).not.toHaveBeenCalled();
      const [retained] = await readQueue();
      expect(retained).toMatchObject({
        clientId: 'c1',
        enterContest: true,
        contestCheckpoint: { photo: { id: 'srv-c1' } },
      });
    },
  );

  it.each(ugc428Failures)(
    'retries ONLY the contest after a restart ($code): same photo id, no re-upload',
    async (failure) => {
      uploadBeerPhoto.mockResolvedValueOnce({ status: 'ok', photo: serverPhoto('c1') });
      enterPhotoContest.mockResolvedValueOnce(failure);
      enterPhotoContest.mockResolvedValueOnce(failure);
      enterPhotoContest.mockResolvedValue({ ok: true, entry: {} });

      await enqueueAndComplete(op('c1', { enterContest: true }));

      expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);

      // The checkpoint is durable — read and parse it straight from storage.
      const persisted = JSON.parse(
        (await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]',
      ) as BeerPhotoUploadOp[];
      expect(persisted).toHaveLength(1);
      expect(persisted[0].contestCheckpoint?.photo).toEqual(serverPhoto('c1'));
      expect(persisted[0].enterContest).toBe(true);

      // Simulated app restart: the retained op is re-read from storage and
      // flushed again by the launch/foreground hook.
      await flushBeerPhotosQueue();

      expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
      expect(enterPhotoContest).toHaveBeenCalledTimes(2);
      expect(enterPhotoContest).toHaveBeenLastCalledWith('srv-c1', expect.anything());

      // A repeated retry keeps the checkpoint and still never re-uploads.
      const retainedAfterRetry = JSON.parse(
        (await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]',
      ) as BeerPhotoUploadOp[];
      expect(retainedAfterRetry[0].contestCheckpoint?.photo.id).toBe('srv-c1');

      await flushBeerPhotosQueue();

      expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
      expect(enterPhotoContest).toHaveBeenCalledTimes(3);
      expect(markSynced).toHaveBeenCalledWith(
        'c1',
        { ...serverPhoto('c1'), inContest: true },
      );
      expect(await readQueue()).toEqual([]);
    },
  );

  it('never stamps a stale checkpoint onto a newer replacement op', async () => {
    let resolveUpload!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValueOnce(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const enqueued = await enqueueBeerPhoto(
      op('c1', { caption: 'stará', enterContest: true }),
    );
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));

    // Replacement enqueue lands while the stale delivery is still in flight.
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
    const replacing = await enqueueBeerPhoto(
      op('c1', { caption: 'nová', enterContest: true }),
    );

    resolveUpload({ status: 'ok', photo: serverPhoto('c1') });
    await enqueued.completion;
    await replacing.completion;
    await flushBeerPhotosQueue();

    // The stale delivery must not finalize or touch the replacement; the
    // replacement flushes cleanly on its own (one upload + one contest).
    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(enterPhotoContest).toHaveBeenCalledTimes(1);
    expect(enterPhotoContest).toHaveBeenLastCalledWith('srv-c1', expect.anything());
    expect(markSynced).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });

  it('does not finalize a stale delivery whose op was replaced after the checkpoint persisted', async () => {
    let resolveUploadOld!: (value: BeerPhotoUploadResult) => void;
    let resolveUploadNew!: (value: BeerPhotoUploadResult) => void;
    let resolveContestOld!: (value: Record<string, unknown>) => void;
    uploadBeerPhoto
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadOld = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadNew = resolve;
        }),
      );
    enterPhotoContest.mockReturnValueOnce(
      new Promise<Record<string, unknown>>((resolve) => {
        resolveContestOld = resolve;
      }),
    );

    const first = await enqueueBeerPhoto(op('c1', { caption: 'stará', enterContest: true }));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));
    resolveUploadOld({ status: 'ok', photo: serverPhoto('c1') });

    // The old delivery reached the checkpoint phase: the checkpoint is durable
    // and its contest POST is in flight.
    await waitForExpectation(() => expect(enterPhotoContest).toHaveBeenCalledTimes(1));
    const checkpointed = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]') as {
      contestCheckpoint?: { photo?: { id?: string } };
    }[];
    expect(checkpointed).toHaveLength(1);
    expect(checkpointed[0].contestCheckpoint?.photo?.id).toBe('srv-c1');

    // A newer same-client op replaces the queued one while the old contest is
    // still pending — this window opens AFTER the checkpoint persistence, not
    // during the upload.
    const newerOp = op('c1', { caption: 'nová', enterContest: true });
    const replacing = await enqueueBeerPhoto(newerOp);

    resolveContestOld({ ok: true, entry: {} });
    await first.completion;
    try {
      // The stale delivery must not finalize anything once it lost the queue
      // slot, and the newer op must remain durable unchanged.
      expect(markSynced).not.toHaveBeenCalled();
      expect(fileDelete).not.toHaveBeenCalled();
      expect(await readQueue()).toEqual([newerOp]);
    } finally {
      // Always drain the replacement delivery — an aborted assertion must not
      // leave the shared coalescing flush stuck on a never-resolving upload.
      resolveUploadNew({ status: 'ok', photo: serverPhoto('c1') });
      await replacing.completion;
    }

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
    expect(enterPhotoContest).toHaveBeenCalledTimes(2);
    expect(markSynced).toHaveBeenCalledTimes(1);
    expect(markSynced).toHaveBeenCalledWith('c1', { ...serverPhoto('c1'), inContest: true });
    expect(events).toEqual(['markSynced', 'file-delete']);
    expect(await readQueue()).toEqual([]);
  });

  it('still delivers a legacy stored op that predates any retry metadata', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          clientId: 'legacy',
          localUri: 'file:///docs/beer-photos/legacy.jpg',
          caption: '',
          visibility: 'private',
          takenAt: '2026-07-01T19:00:00.000Z',
        },
      ]),
    );

    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
    expect((uploadBeerPhoto.mock.calls[0] as unknown[])[1]).toMatchObject({
      clientId: 'legacy',
    });
    expect(await readQueue()).toEqual([]);
  });
});

describe('stale plain delivery vs same-client replacement', () => {
  it("an old plain 'ok' delivery must not sync or delete the file once a newer same-client op replaced it", async () => {
    let resolveUploadOld!: (value: BeerPhotoUploadResult) => void;
    let resolveUploadNew!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadOld = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadNew = resolve;
        }),
      );

    const first = await enqueueBeerPhoto(op('c1', { caption: 'stará' }));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));

    // Replacement lands while the stale delivery is in flight. The durable
    // <clientId>.jpg now belongs to the NEWER op — deleting it would destroy
    // the replacement's only copy.
    const newerOp = op('c1', { caption: 'nová' });
    const replacing = await enqueueBeerPhoto(newerOp);

    resolveUploadOld({ status: 'ok', photo: serverPhoto('c1') });
    try {
      await first.completion;

      // REGRESSION (P1): the stale delivery resolved 'ok' but lost the queue
      // slot — it must not markSynced the shared clientId nor delete the file.
      expect(markSynced).not.toHaveBeenCalled();
      expect(markFailed).not.toHaveBeenCalled();
      expect(fileDelete).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(await readQueue()).toEqual([newerOp]);

      // The newer op still delivers successfully afterwards.
      resolveUploadNew({ status: 'ok', photo: serverPhoto('c1') });
      await replacing.completion;
      await flushBeerPhotosQueue();

      expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
      expect((uploadBeerPhoto.mock.calls[1] as unknown[])[1]).toMatchObject({
        clientId: 'c1',
        caption: 'nová',
      });
      expect(markSynced).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['markSynced', 'file-delete']);
      expect(await readQueue()).toEqual([]);
    } finally {
      resolveUploadNew({ status: 'ok', photo: serverPhoto('c1') });
      await replacing.completion;
    }
  });

  it("an old plain permanent-error delivery must not markFailed a newer same-client replacement", async () => {
    let resolveUploadOld!: (value: BeerPhotoUploadResult) => void;
    let resolveUploadNew!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadOld = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadNew = resolve;
        }),
      );

    const first = await enqueueBeerPhoto(op('c1', { caption: 'stará' }));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));

    const newerOp = op('c1', { caption: 'nová' });
    const replacing = await enqueueBeerPhoto(newerOp);

    resolveUploadOld({ status: 'permanent-error', code: 'photo_limit_reached' });
    try {
      await first.completion;

      // REGRESSION (P1): the rejection belongs to the OLD caption — it must
      // never flip the replacement's optimistic row to failed.
      expect(markFailed).not.toHaveBeenCalled();
      expect(markSynced).not.toHaveBeenCalled();
      expect(fileDelete).not.toHaveBeenCalled();
      expect(await readQueue()).toEqual([newerOp]);

      resolveUploadNew({ status: 'ok', photo: serverPhoto('c1') });
      await replacing.completion;
      await flushBeerPhotosQueue();

      expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
      expect(markSynced).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['markSynced', 'file-delete']);
      expect(await readQueue()).toEqual([]);
    } finally {
      resolveUploadNew({ status: 'ok', photo: serverPhoto('c1') });
      await replacing.completion;
    }
  });
});

describe('server-echo clientId identity contract', () => {
  it('normalizes an empty echoed clientId onto the checkpoint so a restart never re-uploads', async () => {
    const echoed = { ...serverPhoto('c1'), clientId: '' };
    uploadBeerPhoto.mockResolvedValueOnce({ status: 'ok', photo: echoed });
    enterPhotoContest.mockResolvedValueOnce({
      ok: false,
      code: 'network',
      detail: 'Bez sítě.',
    });

    await enqueueAndComplete(op('c1', { enterContest: true }));

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
    // REGRESSION (P2a): the checkpoint must validate against the OP's clientId,
    // otherwise the next load drops the whole op and the restart re-uploads.
    const persisted = JSON.parse(
      (await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]',
    ) as BeerPhotoUploadOp[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0].contestCheckpoint?.photo.clientId).toBe('c1');

    // Simulated restart: only the contest retries, the upload never repeats.
    enterPhotoContest.mockResolvedValue({ ok: true, entry: {} });
    await flushBeerPhotosQueue();

    expect(uploadBeerPhoto).toHaveBeenCalledTimes(1);
    expect(enterPhotoContest).toHaveBeenLastCalledWith('srv-c1', expect.anything());
    expect(markSynced).toHaveBeenCalledWith(
      'c1',
      { ...echoed, clientId: 'c1', inContest: true },
    );
    expect(await readQueue()).toEqual([]);
  });

  it('rejects a success with a conflicting nonempty echoed clientId — safe guarded failure', async () => {
    const foreign = { ...serverPhoto('other-client'), id: 'srv-other' };
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: foreign });

    await enqueueAndComplete(op('c1', { enterContest: true }));

    // REGRESSION: the server committed a DIFFERENT photo under this client_id.
    // The delivery must never be accepted: no contest entry, no markSynced (no
    // foreign URL in the local store), no local file deletion. The exact
    // current op ends as a guarded permanent failure with a stable internal
    // code, and the durable file stays for the detail screen's retry.
    expect(enterPhotoContest).not.toHaveBeenCalled();
    expect(markSynced).not.toHaveBeenCalled();
    expect(fileDelete).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith('c1', 'photo_identity_mismatch');
    expect(await readQueue()).toEqual([]);
  });

  it("a stale 'ok' delivery with a conflicting echoed clientId must not fail the newer same-client replacement", async () => {
    let resolveUploadOld!: (value: BeerPhotoUploadResult) => void;
    let resolveUploadNew!: (value: BeerPhotoUploadResult) => void;
    const foreign = { ...serverPhoto('other-client'), id: 'srv-other' };
    uploadBeerPhoto
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadOld = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<BeerPhotoUploadResult>((resolve) => {
          resolveUploadNew = resolve;
        }),
      );

    const first = await enqueueBeerPhoto(op('c1', { caption: 'stará' }));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));

    const newerOp = op('c1', { caption: 'nová' });
    const replacing = await enqueueBeerPhoto(newerOp);

    resolveUploadOld({ status: 'ok', photo: foreign });
    try {
      await first.completion;

      // The identity mismatch belongs to the OLD delivery — the guarded
      // finalize must never flip the replacement's optimistic row to failed
      // nor delete the replacement's durable file.
      expect(markFailed).not.toHaveBeenCalled();
      expect(markSynced).not.toHaveBeenCalled();
      expect(fileDelete).not.toHaveBeenCalled();
      expect(await readQueue()).toEqual([newerOp]);

      resolveUploadNew({ status: 'ok', photo: serverPhoto('c1') });
      await replacing.completion;
      await flushBeerPhotosQueue();

      expect(uploadBeerPhoto).toHaveBeenCalledTimes(2);
      expect(markSynced).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['markSynced', 'file-delete']);
      expect(await readQueue()).toEqual([]);
    } finally {
      resolveUploadNew({ status: 'ok', photo: serverPhoto('c1') });
      await replacing.completion;
    }
  });

  it('retains a friends-visibility photo op across a 428 consent gate until delivery succeeds', async () => {
    // Real classification chain: beerPhotosClient maps BOTH a bare 428 (empty
    // body) and a semantic 428 (ugc_consent_required / ugc_policy_update_required)
    // through classifyQueueHttpFailure to {status:'retry'} — never
    // permanent-error. This pins the queue side of that contract.
    uploadBeerPhoto.mockResolvedValueOnce({ status: 'retry' });

    await enqueueAndComplete(op('c1', { visibility: 'friends' }));

    // REGRESSION (P2b): a consent/policy gate is transient — retain the op,
    // never mark failed, never delete the durable file.
    expect(markFailed).not.toHaveBeenCalled();
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([op('c1', { visibility: 'friends' })]);

    uploadBeerPhoto.mockResolvedValueOnce({ status: 'ok', photo: serverPhoto('c1') });
    await flushBeerPhotosQueue();

    expect(markSynced).toHaveBeenCalledWith('c1', serverPhoto('c1'));
    expect(events).toEqual(['markSynced', 'file-delete']);
    expect(await readQueue()).toEqual([]);
  });
});

describe('pending-photo deletion', () => {
  it('reports failure and preserves the durable delete retry when storage is full', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op('delete-me')]));
    jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk full'));

    await expect(removeQueuedBeerPhoto('delete-me')).resolves.toBe(false);

    expect(deleteBeerPhotoByClientId).not.toHaveBeenCalled();
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([expect.objectContaining({ clientId: 'delete-me' })]);
    expect(
      JSON.parse(
        (await AsyncStorage.getItem('na-pivo-beer-photo-deletion-tombstones')) ?? '[]',
      ),
    ).toEqual([{ clientId: 'delete-me', accountId: 'account-a' }]);

    await expect(removeQueuedBeerPhoto('delete-me')).resolves.toBe(true);
    await flushBeerPhotosQueue();

    expect(deleteBeerPhotoByClientId).toHaveBeenCalledTimes(1);
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
    expect(await AsyncStorage.getItem('na-pivo-beer-photo-deletion-tombstones')).toBeNull();
  });

  it('waits for durable upload-op removal before deleting after a cold restart', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op('delete-me')]));
    await AsyncStorage.setItem(
      'na-pivo-beer-photo-deletion-tombstones',
      JSON.stringify([{ clientId: 'delete-me', accountId: 'account-a' }]),
    );
    const removeItem = jest.spyOn(AsyncStorage, 'removeItem');
    removeItem.mockRejectedValueOnce(new Error('disk full'));

    await flushBeerPhotosQueue();

    expect(deleteBeerPhotoByClientId).not.toHaveBeenCalled();
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([expect.objectContaining({ clientId: 'delete-me' })]);
    expect(
      JSON.parse(
        (await AsyncStorage.getItem('na-pivo-beer-photo-deletion-tombstones')) ?? '[]',
      ),
    ).toEqual([{ clientId: 'delete-me', accountId: 'account-a' }]);

    await flushBeerPhotosQueue();

    expect(deleteBeerPhotoByClientId).toHaveBeenCalledTimes(1);
    expect(fileDelete).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
    expect(await AsyncStorage.getItem('na-pivo-beer-photo-deletion-tombstones')).toBeNull();
  });

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
