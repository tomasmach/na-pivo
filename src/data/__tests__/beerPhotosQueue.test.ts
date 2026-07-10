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

/** Shared ordered event log — store updates and file deletes both append here. */
const events: string[] = [];

const uploadBeerPhoto: jest.Mock<Promise<BeerPhotoUploadResult>, unknown[]> = jest.fn(
  async () => ({ status: 'ok' as const, photo: serverPhoto('c1') }),
);
jest.mock('../beerPhotosClient', () => ({
  uploadBeerPhoto: (...args: unknown[]) => uploadBeerPhoto(...(args as [])),
}));

const addPendingPhoto = jest.fn();
const markSynced = jest.fn(() => {
  events.push('markSynced');
});
const markFailed = jest.fn(() => {
  events.push('markFailed');
});
/** Store photos visible to the orphaned-pending reconciliation. */
let mockStorePhotos: {
  clientId: string;
  syncState: string;
  createdAt: string;
  takenAt: string;
}[] = [];
jest.mock('@/stores/beerPhotosStore', () => ({
  useBeerPhotosStore: {
    getState: () => ({ addPendingPhoto, markSynced, markFailed, photos: mockStorePhotos }),
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
  type BeerPhotoUploadOp,
} from '../beerPhotosQueue';
import type { BeerPhoto, BeerPhotoUploadResult } from '../beerPhotosClient';

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

beforeEach(async () => {
  jest.clearAllMocks();
  events.length = 0;
  mockStorePhotos = [];
  uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
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
});

describe('enqueueBeerPhoto', () => {
  it('adds an optimistic pending entry to the store and persists BEFORE sending', async () => {
    let resolveUpload!: (value: BeerPhotoUploadResult) => void;
    uploadBeerPhoto.mockReturnValueOnce(
      new Promise<BeerPhotoUploadResult>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const enqueued = enqueueBeerPhoto(op('c1'));
    await waitForExpectation(() => expect(uploadBeerPhoto).toHaveBeenCalledTimes(1));

    // The op is already on disk while the upload is still in flight.
    expect(addPendingPhoto).toHaveBeenCalledWith(op('c1'));
    expect(await readQueue()).toHaveLength(1);

    resolveUpload({ status: 'ok', photo: serverPhoto('c1') });
    await enqueued;
    expect(await readQueue()).toEqual([]);
  });

  it('dedups by clientId — a re-enqueue replaces the pending op (last write wins)', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await enqueueBeerPhoto(op('c1', { caption: 'první' }));
    await enqueueBeerPhoto(op('c1', { caption: 'druhá' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].caption).toBe('druhá');
  });

  it('keeps distinct clientIds as separate items', async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });
    await enqueueBeerPhoto(op('c1'));
    await enqueueBeerPhoto(op('c2'));
    expect((await readQueue()).map((item) => item.clientId).sort()).toEqual(['c1', 'c2']);
  });
});

describe('flush keep/drop contract', () => {
  it("'ok' → markSynced with the server photo, THEN delete the local file, drop from queue", async () => {
    const photo = serverPhoto('c1');
    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo });

    await enqueueBeerPhoto(op('c1'));

    expect(markSynced).toHaveBeenCalledWith('c1', photo);
    // The store swaps to the remote imageUrl BEFORE the local file dies — the
    // diary must never point at a deleted uri.
    expect(events).toEqual(['markSynced', 'file-delete']);
    expect(await readQueue()).toEqual([]);
  });

  it("'permanent-error' → markFailed WITH the backend code, drop from queue, local file KEPT", async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'permanent-error', code: 'photo_limit_reached' });

    await enqueueBeerPhoto(op('c1'));

    // The code is persisted so the diary can show the specific Czech message
    // (album full / too large / invalid) instead of a generic failure.
    expect(markFailed).toHaveBeenCalledWith('c1', 'photo_limit_reached');
    expect(fileDelete).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });

  it("'retry' → kept for the next flush, no store finalization", async () => {
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });

    await enqueueBeerPhoto(op('c1'));

    expect(markSynced).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(await readQueue()).toHaveLength(1);

    uploadBeerPhoto.mockResolvedValue({ status: 'ok', photo: serverPhoto('c1') });
    await flushBeerPhotosQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('does nothing on an empty queue and survives corrupted storage', async () => {
    await flushBeerPhotosQueue();
    expect(uploadBeerPhoto).not.toHaveBeenCalled();

    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushBeerPhotosQueue()).resolves.toBeUndefined();
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

describe('queue overflow (MAX_QUEUE_LENGTH)', () => {
  it('marks overflow-dropped ops failed instead of leaving them stuck pending', async () => {
    // Prefill exactly at the cap; the new enqueue pushes the oldest out.
    const backlog = Array.from({ length: 100 }, (_, i) => op(`old-${i}`));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(backlog));
    uploadBeerPhoto.mockResolvedValue({ status: 'retry' });

    await enqueueBeerPhoto(op('newest'));

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
    await enqueueBeerPhoto(op('c1'));
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
