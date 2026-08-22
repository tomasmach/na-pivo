import { ensureAccount } from '../account';
import {
  restorePubRatings,
  installPubRatingsSync,
  runWithoutPubRatingsSync,
  resetPubRatingsPullGateForTests,
} from '../pubRatingsSync';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { useTallyStore } from '@/stores/tallyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const fetchRatings = jest.fn();
jest.mock('../pubRatingsClient', () => ({
  fetchRatings: (...args: unknown[]) => fetchRatings(...(args as [])),
}));

const enqueueRatingOp: jest.Mock = jest.fn((_item?: unknown) => Promise.resolve(undefined));
const flushPubRatingsQueue: jest.Mock = jest.fn(() => Promise.resolve(undefined));
const getQueuedRatingDeletePubKeys: jest.Mock = jest.fn(async () => new Set<string>());
jest.mock('../pubRatingsQueue', () => ({
  enqueueRatingOp: (...args: unknown[]) => enqueueRatingOp(...(args as [])),
  flushPubRatingsQueue: () => flushPubRatingsQueue(),
  getQueuedRatingDeletePubKeys: () => getQueuedRatingDeletePubKeys(),
}));

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'dev-1',
    accountId: 'acc-1',
    token: 'tok-1',
    authenticated: false,
  })),
}));

const PUB = 'aaaaaaaa';
const OTHER = 'bbbbbbbb';

function wire(over: Record<string, unknown> = {}) {
  return {
    cache_key: PUB,
    name: 'U Testu',
    lat: 50.08,
    lng: 14.42,
    external_id: null,
    verdict: 'like',
    tag: null,
    note: null,
    updated_at: '2026-06-14T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPubRatingsPullGateForTests();
  getQueuedRatingDeletePubKeys.mockResolvedValue(new Set<string>());
  usePubRatingsStore.setState({ ratings: {} });
  useTallyStore.setState({ current: null, history: [] });
});

describe('restorePubRatings — pull + merge (LWW)', () => {
  it('merges a server rating into an empty local store', async () => {
    fetchRatings.mockResolvedValue([wire()]);
    await restorePubRatings();
    expect(usePubRatingsStore.getState().ratings[PUB]?.verdict).toBe('like');
    expect(flushPubRatingsQueue).toHaveBeenCalled();
  });

  it('gates a repeat pull for the same account, but pulls immediately for a new account', async () => {
    fetchRatings.mockResolvedValue([wire()]);
    await restorePubRatings();
    expect(fetchRatings).toHaveBeenCalledTimes(1);

    // Same account within the freshness window: pull skipped, flush still runs.
    await restorePubRatings();
    expect(fetchRatings).toHaveBeenCalledTimes(1);
    expect(flushPubRatingsQueue).toHaveBeenCalledTimes(3);

    // Account switch (anonymous → claim keeps stores, so the gate must be
    // per-account): the new owner pulls without waiting out the window.
    jest.mocked(ensureAccount).mockResolvedValueOnce({
      deviceId: 'dev-1',
      accountId: 'acc-2',
      token: 'tok-2',
      authenticated: true,
    });
    await restorePubRatings();
    expect(fetchRatings).toHaveBeenCalledTimes(2);
  });

  it('does NOT echo a pulled rating back out as an upsert (suppress flag)', async () => {
    fetchRatings.mockResolvedValue([wire()]);
    // Install the push subscriber so a non-suppressed write WOULD enqueue.
    const unsub = installPubRatingsSync();
    await restorePubRatings();
    // The only thing pulled was the server copy; nothing local is newer, so no
    // upsert should have been enqueued.
    expect(enqueueRatingOp).not.toHaveBeenCalled();
    unsub();
  });

  it('pushes a local rating the server is missing', async () => {
    usePubRatingsStore.setState({
      ratings: { [OTHER]: { verdict: 'dislike', updatedAt: '2026-06-14T11:00:00.000Z' } },
    });
    fetchRatings.mockResolvedValue([wire()]); // server only has PUB
    await restorePubRatings();
    const calls = enqueueRatingOp.mock.calls.map((c) => c[0] as unknown as { op: string; pubKey: string });
    expect(calls).toContainEqual(expect.objectContaining({ op: 'upsert', pubKey: OTHER }));
  });

  it('pushes the local copy when it is newer than the server copy', async () => {
    usePubRatingsStore.setState({
      ratings: { [PUB]: { verdict: 'dislike', updatedAt: '2026-06-14T18:00:00.000Z' } },
    });
    fetchRatings.mockResolvedValue([wire({ updated_at: '2026-06-14T12:00:00.000Z' })]);
    await restorePubRatings();
    // Local stays (newer) and is pushed up.
    expect(usePubRatingsStore.getState().ratings[PUB]?.verdict).toBe('dislike');
    const calls = enqueueRatingOp.mock.calls.map((c) => c[0] as unknown as { op: string; pubKey: string });
    expect(calls).toContainEqual(expect.objectContaining({ op: 'upsert', pubKey: PUB }));
  });

  it('lets a strictly-newer server copy overwrite local', async () => {
    usePubRatingsStore.setState({
      ratings: { [PUB]: { verdict: 'dislike', updatedAt: '2026-06-14T08:00:00.000Z' } },
    });
    fetchRatings.mockResolvedValue([wire({ verdict: 'like', updated_at: '2026-06-14T12:00:00.000Z' })]);
    await restorePubRatings();
    expect(usePubRatingsStore.getState().ratings[PUB]?.verdict).toBe('like');
  });

  it('flushes the queue even when the fetch fails (returns null)', async () => {
    fetchRatings.mockResolvedValue(null);
    await restorePubRatings();
    expect(flushPubRatingsQueue).toHaveBeenCalled();
    expect(enqueueRatingOp).not.toHaveBeenCalled();
  });

  it('does not hydrate server ratings with a pending local delete tombstone', async () => {
    getQueuedRatingDeletePubKeys.mockResolvedValue(new Set([PUB]));
    fetchRatings.mockResolvedValue([wire()]);
    await restorePubRatings();
    expect(usePubRatingsStore.getState().ratings[PUB]).toBeUndefined();
    expect(enqueueRatingOp).not.toHaveBeenCalled();
  });
});

describe('installPubRatingsSync — push subscribe-diff', () => {
  it('does not surface a rejected background enqueue to the UI', async () => {
    enqueueRatingOp.mockRejectedValueOnce(new Error('credential transition'));
    const unsub = installPubRatingsSync();

    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    await Promise.resolve();
    await Promise.resolve();

    expect(enqueueRatingOp).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('enqueues an upsert when a rating is added locally', () => {
    const unsub = installPubRatingsSync();
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    expect(enqueueRatingOp).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'upsert', pubKey: PUB }),
    );
    unsub();
  });

  it('enqueues a delete when a rating is cleared locally', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    const unsub = installPubRatingsSync();
    usePubRatingsStore.getState().clearRating(PUB);
    expect(enqueueRatingOp).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'delete',
        pubKey: PUB,
        payload: expect.objectContaining({
          verdict: null,
          tag: null,
          note: null,
          updated_at: expect.any(String),
        }),
      }),
    );
    unsub();
  });

  it('does not enqueue deletes for an account-boundary local wipe', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    const unsub = installPubRatingsSync();

    runWithoutPubRatingsSync(() => {
      usePubRatingsStore.setState({ ratings: {} });
    });

    expect(enqueueRatingOp).not.toHaveBeenCalled();
    unsub();
  });
});
