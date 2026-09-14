import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCommunityQueue, enqueuePubCommunity, flushCommunityQueue } from '../communityQueue';
import { submitPubCommunityForQueue, type CommunityEntry } from '../communityClient';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// communityClient → account → expo-secure-store, which isn't transformed for the
// node test env; mock it so requireActual('../communityClient') loads.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const OK_RESPONSE = {
  cacheKey: 'k',
  hours: null,
  beers: [],
  historicalBeers: [],
  beersUpdatedAt: null,
  beerMenuRotates: false,
  xpAwarded: 0,
  mapper: null,
};

// The queue talks only to the queue-aware API — never the public wrapper.
jest.mock('../communityClient', () => ({
  ...jest.requireActual('../communityClient'),
  submitPubCommunityForQueue: jest.fn(async () => ({ status: 'ok', response: OK_RESPONSE })),
}));

const STORAGE_KEY = 'na-pivo-community-queue';

function entry(overrides: Partial<CommunityEntry> = {}): CommunityEntry {
  return {
    client_id: 'c1',
    name: 'U Testu',
    lat: 50.0812,
    lng: 14.4182,
    external_id: 'mapy:1',
    hours: { mo: [], tu: [], we: [], th: [], fr: [], sa: [], su: [] },
    ...overrides,
  };
}

async function readQueue(): Promise<CommunityEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

beforeEach(async () => {
  resetPrivateAccountBoundaryForTests();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(() => {
  resetPrivateAccountBoundaryForTests();
});

describe('enqueuePubCommunity', () => {
  it('sends the entry and leaves the queue empty on success', async () => {
    await expect(enqueuePubCommunity(entry())).resolves.toMatchObject({ cacheKey: 'k' });
    expect(submitPubCommunityForQueue).toHaveBeenCalledTimes(1);
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('removes a permanent-error (400/422 poison) row and resolves null', async () => {
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'permanent-error' });
    await expect(enqueuePubCommunity(entry())).resolves.toBeNull();
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps a failed entry queued instead of dropping it', async () => {
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'retry' });
    await expect(enqueuePubCommunity(entry())).resolves.toBeNull();
    expect(await readQueue()).toHaveLength(1);
  });

  it('dedups by geohash-8 cell — a newer edit of the same pub replaces the old one', async () => {
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'retry' });

    // Same coordinates → same cell; the second submission has a fresh client_id
    // and replaces the first.
    await enqueuePubCommunity(entry({ client_id: 'old' }));
    await enqueuePubCommunity(entry({ client_id: 'new' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('new');
  });

  it('keeps separate entries for pubs in different cells', async () => {
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'retry' });

    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));

    expect(await readQueue()).toHaveLength(2);
  });

  it('persists a new contribution while an older flush is waiting on the network', async () => {
    const older = entry({ client_id: 'older', lat: 50.0812, lng: 14.4182 });
    const newer = entry({ client_id: 'newer', lat: 49.1951, lng: 16.6068 });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([older]));
    let release!: () => void;
    (submitPubCommunityForQueue as jest.Mock)
      .mockReturnValueOnce(new Promise((resolve) => { release = () => resolve({ status: 'retry' }); }))
      .mockResolvedValue({ status: 'retry' });

    const flushing = flushCommunityQueue();
    await flushMicrotasks();
    const enqueueing = enqueuePubCommunity(newer);
    await flushMicrotasks();

    expect((await readQueue()).map((queued) => queued.client_id)).toContain('newer');
    release();
    await Promise.all([flushing, enqueueing]);
  });

  it('does not evict an older offline contribution when the former cap is reached', async () => {
    const queued = Array.from({ length: 30 }, (_, index) =>
      entry({ client_id: `old-${index}`, lat: 48 + index * 0.01, lng: 12 + index * 0.01 }),
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queued));
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'retry' });

    await enqueuePubCommunity(entry({ client_id: 'new-31', lat: 51, lng: 18 }));

    expect(await readQueue()).toHaveLength(31);
    expect((await readQueue()).some((item) => item.client_id === 'old-0')).toBe(true);
  });

  it('aborts direct delivery and removes the old account queue at a credential boundary', async () => {
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => { sendStarted = resolve; });
    (submitPubCommunityForQueue as jest.Mock).mockImplementationOnce(
      async (_entry: CommunityEntry, signal: AbortSignal) => {
        sendStarted();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { status: 'retry' };
      },
    );

    const enqueueing = enqueuePubCommunity(entry({ client_id: 'account-a' }));
    await started;
    const transition = beginPrivateAccountTransition('account-switch', 'account-a');
    expect(transition).not.toBeNull();
    await transition!.drain();
    await expect(enqueueing).resolves.toBeNull();
    await clearCommunityQueue();
    transition!.release();

    expect(await readQueue()).toEqual([]);
  });
});

describe('flushCommunityQueue', () => {
  it('re-sends queued entries once the backend recovers and clears the queue', async () => {
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'retry' });
    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));
    expect(await readQueue()).toHaveLength(2);

    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({
      status: 'ok',
      response: OK_RESPONSE,
    });
    await flushCommunityQueue();

    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps only the entries that failed again', async () => {
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'retry' });
    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));

    (submitPubCommunityForQueue as jest.Mock).mockImplementation(async (e: CommunityEntry) =>
      e.client_id === 'a'
        ? { status: 'ok', response: OK_RESPONSE }
        : { status: 'retry' },
    );
    await flushCommunityQueue();

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('b');
  });

  it('drops 400/422 permanent-error poison rows during background flush', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      entry({ client_id: 'poison' }),
      entry({ client_id: 'healthy', lat: 49.1951, lng: 16.6068 }),
    ]));
    (submitPubCommunityForQueue as jest.Mock).mockImplementation(async (e: CommunityEntry) =>
      e.client_id === 'poison' ? { status: 'permanent-error' } : { status: 'retry' },
    );

    await flushCommunityQueue();

    expect((await readQueue()).map((queued) => queued.client_id)).toEqual(['healthy']);
  });

  it('keeps 401/428 retry rows queued during background flush', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      entry({ client_id: 'stale-auth', lat: 50.0812, lng: 14.4182 }),
      entry({ client_id: 'consent-428', lat: 49.1951, lng: 16.6068 }),
    ]));
    (submitPubCommunityForQueue as jest.Mock).mockResolvedValue({ status: 'retry' });

    await flushCommunityQueue();

    expect(submitPubCommunityForQueue).toHaveBeenCalledTimes(2);
    expect(await readQueue()).toHaveLength(2);
  });

  it('does nothing on an empty queue', async () => {
    await flushCommunityQueue();
    expect(submitPubCommunityForQueue).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushCommunityQueue()).resolves.toBeUndefined();
    expect(submitPubCommunityForQueue).not.toHaveBeenCalled();
  });

  it('drops malformed persisted contributions while delivering healthy siblings', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      entry({ client_id: 'healthy' }),
      entry({ client_id: 'bad-coordinates', lat: 999 }),
      entry({ client_id: 'bad-menu', hours: undefined, beers: [{ name: '', price_czk: 0 }] }),
    ]));

    await flushCommunityQueue();

    expect(submitPubCommunityForQueue).toHaveBeenCalledTimes(1);
    expect(submitPubCommunityForQueue).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'healthy' }),
      expect.any(AbortSignal),
    );
  });
});
