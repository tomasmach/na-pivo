jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const fetchMyAmenityVotes = jest.fn();
jest.mock('../pubAmenitiesClient', () => ({
  fetchMyAmenityVotes: (...args: unknown[]) => fetchMyAmenityVotes(...(args as [])),
}));

const enqueueAmenityOp: jest.Mock = jest.fn((_item?: unknown) => Promise.resolve(undefined));
const flushPubAmenitiesQueue: jest.Mock = jest.fn(() => Promise.resolve(undefined));
const getQueuedAmenityDeletes: jest.Mock = jest.fn(async () => new Set<string>());
jest.mock('../pubAmenitiesQueue', () => ({
  enqueueAmenityOp: (...args: unknown[]) => enqueueAmenityOp(...(args as [])),
  flushPubAmenitiesQueue: () => flushPubAmenitiesQueue(),
  getQueuedAmenityDeletes: () => getQueuedAmenityDeletes(),
}));

import {
  restorePubAmenities,
  installPubAmenitiesSync,
  runWithoutPubAmenitiesSync,
} from '../pubAmenitiesSync';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { useTallyStore } from '@/stores/tallyStore';

const PUB = 'aaaaaaaa';
const OTHER = 'bbbbbbbb';

function wire(over: Record<string, unknown> = {}) {
  return {
    cache_key: PUB,
    amenity_key: 'game_darts',
    value: 'yes',
    client_updated_at: '2026-06-14T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getQueuedAmenityDeletes.mockResolvedValue(new Set<string>());
  usePubAmenitiesStore.setState({ votes: {} });
  useTallyStore.setState({ current: null, history: [] });
});

describe('restorePubAmenities — pull + merge (LWW)', () => {
  it('merges a server vote into an empty local store', async () => {
    fetchMyAmenityVotes.mockResolvedValue([wire()]);
    await restorePubAmenities();
    expect(usePubAmenitiesStore.getState().votes[PUB]?.game_darts?.vote).toBe('yes');
    expect(flushPubAmenitiesQueue).toHaveBeenCalled();
  });

  it('does NOT echo a pulled vote back out as an upsert (suppress flag)', async () => {
    fetchMyAmenityVotes.mockResolvedValue([wire()]);
    const unsub = installPubAmenitiesSync();
    await restorePubAmenities();
    expect(enqueueAmenityOp).not.toHaveBeenCalled();
    unsub();
  });

  it('pushes a local vote the server is missing', async () => {
    usePubAmenitiesStore.setState({
      votes: { [OTHER]: { practical_wifi: { vote: 'no', updatedAt: '2026-06-14T11:00:00.000Z' } } },
    });
    fetchMyAmenityVotes.mockResolvedValue([wire()]);
    await restorePubAmenities();
    const calls = enqueueAmenityOp.mock.calls.map((c) => c[0] as { op: string; pubKey: string; amenityKey: string });
    expect(calls).toContainEqual(
      expect.objectContaining({ op: 'upsert', pubKey: OTHER, amenityKey: 'practical_wifi' }),
    );
  });

  it('pushes the local copy when it is newer than the server copy', async () => {
    usePubAmenitiesStore.setState({
      votes: { [PUB]: { game_darts: { vote: 'no', updatedAt: '2026-06-14T18:00:00.000Z' } } },
    });
    fetchMyAmenityVotes.mockResolvedValue([wire({ client_updated_at: '2026-06-14T12:00:00.000Z' })]);
    await restorePubAmenities();
    expect(usePubAmenitiesStore.getState().votes[PUB]?.game_darts?.vote).toBe('no');
    const calls = enqueueAmenityOp.mock.calls.map((c) => c[0] as { op: string; pubKey: string; amenityKey: string });
    expect(calls).toContainEqual(
      expect.objectContaining({ op: 'upsert', pubKey: PUB, amenityKey: 'game_darts' }),
    );
  });

  it('lets a strictly-newer server copy overwrite local', async () => {
    usePubAmenitiesStore.setState({
      votes: { [PUB]: { game_darts: { vote: 'no', updatedAt: '2026-06-14T08:00:00.000Z' } } },
    });
    fetchMyAmenityVotes.mockResolvedValue([wire({ value: 'yes', client_updated_at: '2026-06-14T12:00:00.000Z' })]);
    await restorePubAmenities();
    expect(usePubAmenitiesStore.getState().votes[PUB]?.game_darts?.vote).toBe('yes');
  });

  it('flushes the queue even when the fetch fails (returns null)', async () => {
    fetchMyAmenityVotes.mockResolvedValue(null);
    await restorePubAmenities();
    expect(flushPubAmenitiesQueue).toHaveBeenCalled();
    expect(enqueueAmenityOp).not.toHaveBeenCalled();
  });

  it('skips a server vote with a pending local delete tombstone (keyed by pair)', async () => {
    getQueuedAmenityDeletes.mockResolvedValue(new Set([`${PUB} game_darts`]));
    fetchMyAmenityVotes.mockResolvedValue([wire()]);
    await restorePubAmenities();
    expect(usePubAmenitiesStore.getState().votes[PUB]).toBeUndefined();
    expect(enqueueAmenityOp).not.toHaveBeenCalled();
  });

  it('drops unknown amenity keys from the server pull', async () => {
    fetchMyAmenityVotes.mockResolvedValue([wire({ amenity_key: 'totally_made_up' })]);
    await restorePubAmenities();
    expect(usePubAmenitiesStore.getState().votes[PUB]).toBeUndefined();
  });
});

describe('installPubAmenitiesSync — push subscribe-diff (per amenity)', () => {
  it('enqueues an upsert when a vote is added locally', () => {
    const unsub = installPubAmenitiesSync();
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    expect(enqueueAmenityOp).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'upsert', pubKey: PUB, amenityKey: 'game_darts' }),
    );
    unsub();
  });

  it('enqueues a delete (value:null tombstone) when a vote is retracted locally', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    const unsub = installPubAmenitiesSync();
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', null);
    expect(enqueueAmenityOp).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'delete',
        pubKey: PUB,
        amenityKey: 'game_darts',
        payload: expect.objectContaining({ value: null, client_updated_at: expect.any(String) }),
      }),
    );
    unsub();
  });

  it('carries a non-blank name even when the tally store has no name for the pub', () => {
    // Empty tally store (set in beforeEach) → no known pub name. The wire payload
    // MUST still carry a non-blank name (falls back to the pubKey) or the backend
    // 400s and the queue drops the vote forever.
    const unsub = installPubAmenitiesSync();
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    const item = enqueueAmenityOp.mock.calls[0]?.[0] as { payload: { name?: string } };
    expect(item.payload.name).toBeTruthy();
    expect(item.payload.name).toBe(PUB);
    unsub();
  });

  it('only enqueues the changed amenity, not its untouched sibling', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    const unsub = installPubAmenitiesSync();
    enqueueAmenityOp.mockClear();
    usePubAmenitiesStore.getState().setVote(PUB, 'practical_wifi', 'no');
    const calls = enqueueAmenityOp.mock.calls.map((c) => c[0] as { amenityKey: string });
    expect(calls).toEqual([expect.objectContaining({ amenityKey: 'practical_wifi' })]);
    unsub();
  });

  it('does not enqueue deletes for an account-boundary local wipe', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    const unsub = installPubAmenitiesSync();

    runWithoutPubAmenitiesSync(() => {
      usePubAmenitiesStore.setState({ votes: {} });
    });

    expect(enqueueAmenityOp).not.toHaveBeenCalled();
    unsub();
  });
});
