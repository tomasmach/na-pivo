import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueuePubCommunity, flushCommunityQueue } from '../communityQueue';
import { submitPubCommunity, type CommunityEntry } from '../communityClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// communityClient → account → expo-secure-store, which isn't transformed for the
// node test env; mock it so requireActual('../communityClient') loads.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../communityClient', () => ({
  ...jest.requireActual('../communityClient'),
  submitPubCommunity: jest.fn(async () => ({ cacheKey: 'k', hours: null, beers: [] })),
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

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('enqueuePubCommunity', () => {
  it('sends the entry and leaves the queue empty on success', async () => {
    await expect(enqueuePubCommunity(entry())).resolves.toBe(true);
    expect(submitPubCommunity).toHaveBeenCalledTimes(1);
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps a failed entry queued instead of dropping it', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await expect(enqueuePubCommunity(entry())).resolves.toBe(false);
    expect(await readQueue()).toHaveLength(1);
  });

  it('dedups by geohash-8 cell — a newer edit of the same pub replaces the old one', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);

    // Same coordinates → same cell; the second submission has a fresh client_id
    // and replaces the first.
    await enqueuePubCommunity(entry({ client_id: 'old' }));
    await enqueuePubCommunity(entry({ client_id: 'new' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('new');
  });

  it('keeps separate entries for pubs in different cells', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);

    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));

    expect(await readQueue()).toHaveLength(2);
  });
});

describe('flushCommunityQueue', () => {
  it('re-sends queued entries once the backend recovers and clears the queue', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));
    expect(await readQueue()).toHaveLength(2);

    (submitPubCommunity as jest.Mock).mockResolvedValue({ cacheKey: 'k', hours: null, beers: [] });
    await flushCommunityQueue();

    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps only the entries that failed again', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));

    (submitPubCommunity as jest.Mock).mockImplementation(async (e: CommunityEntry) =>
      e.client_id === 'a' ? { cacheKey: 'k', hours: null, beers: [] } : null,
    );
    await flushCommunityQueue();

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('b');
  });

  it('does nothing on an empty queue', async () => {
    await flushCommunityQueue();
    expect(submitPubCommunity).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushCommunityQueue()).resolves.toBeUndefined();
    expect(submitPubCommunity).not.toHaveBeenCalled();
  });
});
