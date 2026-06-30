import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  usePubAmenitiesStore,
  selectPubVotes,
  migratePubAmenities,
} from '../pubAmenitiesStore';
import type { AmenityKey } from '@/data/amenities';

/** Local non-reactive read for assertions (mirrors the store snapshot). */
const getPubVotes = (pubKey: string) => usePubAmenitiesStore.getState().votes[pubKey];

const PUB = 'aaaaaaaa';
const OTHER = 'bbbbbbbb';

beforeEach(() => {
  (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, unknown> }).__INTERNAL_MOCK_STORAGE__ = {};
  usePubAmenitiesStore.setState({ votes: {} });
});

describe('setVote', () => {
  it('stores a yes vote with a timestamp', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    const entry = getPubVotes(PUB)?.game_darts;
    expect(entry?.vote).toBe('yes');
    expect(entry?.updatedAt).toBeTruthy();
  });

  it('flips a vote in place', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'no');
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('no');
  });

  it('retracts a vote with null and prunes the pub when empty', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', null);
    expect(getPubVotes(PUB)).toBeUndefined();
  });

  it('retracting one amenity keeps the sibling votes at the same pub', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    usePubAmenitiesStore.getState().setVote(PUB, 'practical_wifi', 'yes');
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', null);
    expect(getPubVotes(PUB)?.game_darts).toBeUndefined();
    expect(getPubVotes(PUB)?.practical_wifi?.vote).toBe('yes');
  });

  it('does not touch other pubs', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    usePubAmenitiesStore.getState().setVote(OTHER, 'game_darts', 'no');
    usePubAmenitiesStore.getState().clearPub(PUB);
    expect(getPubVotes(PUB)).toBeUndefined();
    expect(getPubVotes(OTHER)?.game_darts?.vote).toBe('no');
  });

  it('retracting a missing vote is a no-op', () => {
    const before = usePubAmenitiesStore.getState().votes;
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', null);
    expect(usePubAmenitiesStore.getState().votes).toBe(before);
  });
});

describe('hydrateVotes — per-(pubKey, amenityKey) LWW', () => {
  it('adds a server vote the local store does not have', () => {
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { vote: 'yes', updatedAt: '2026-06-14T10:00:00.000Z' } },
    ]);
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('yes');
  });

  it('overwrites a local vote only when the server copy is strictly newer', () => {
    usePubAmenitiesStore.setState({
      votes: { [PUB]: { game_darts: { vote: 'yes', updatedAt: '2026-06-14T10:00:00.000Z' } } },
    });
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { vote: 'no', updatedAt: '2026-06-14T12:00:00.000Z' } },
    ]);
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('no');
  });

  it('keeps the local vote when it is newer than the server copy (stale ignored)', () => {
    usePubAmenitiesStore.setState({
      votes: { [PUB]: { game_darts: { vote: 'yes', updatedAt: '2026-06-14T12:00:00.000Z' } } },
    });
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { vote: 'no', updatedAt: '2026-06-14T10:00:00.000Z' } },
    ]);
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('yes');
  });

  it('keeps the local vote when timestamps are equal (no strict-newer win)', () => {
    const stamp = '2026-06-14T12:00:00.000Z';
    usePubAmenitiesStore.setState({ votes: { [PUB]: { game_darts: { vote: 'yes', updatedAt: stamp } } } });
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { vote: 'no', updatedAt: stamp } },
    ]);
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('yes');
  });

  it('a stale hydrate of one amenity never clobbers a sibling at the same pub', () => {
    usePubAmenitiesStore.setState({
      votes: {
        [PUB]: {
          game_darts: { vote: 'yes', updatedAt: '2026-06-14T12:00:00.000Z' },
          practical_wifi: { vote: 'yes', updatedAt: '2026-06-14T12:00:00.000Z' },
        },
      },
    });
    // A stale push that only carries darts must not drop wifi.
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { vote: 'no', updatedAt: '2026-06-14T09:00:00.000Z' } },
    ]);
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('yes');
    expect(getPubVotes(PUB)?.practical_wifi?.vote).toBe('yes');
  });

  it('applies a retraction tombstone (entry=null) and prunes the empty pub', () => {
    usePubAmenitiesStore.setState({
      votes: { [PUB]: { game_darts: { vote: 'yes', updatedAt: '2026-06-14T10:00:00.000Z' } } },
    });
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: null },
    ]);
    expect(getPubVotes(PUB)).toBeUndefined();
  });

  it('applies a timestamped tombstone that wins LWW (strictly newer than local)', () => {
    usePubAmenitiesStore.setState({
      votes: { [PUB]: { game_darts: { vote: 'yes', updatedAt: '2026-06-14T10:00:00.000Z' } } },
    });
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { tombstone: true, updatedAt: '2026-06-14T12:00:00.000Z' } },
    ]);
    expect(getPubVotes(PUB)).toBeUndefined();
  });

  it('keeps a newer local edit against a stale timestamped tombstone (LWW)', () => {
    usePubAmenitiesStore.setState({
      votes: { [PUB]: { game_darts: { vote: 'yes', updatedAt: '2026-06-14T18:00:00.000Z' } } },
    });
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { tombstone: true, updatedAt: '2026-06-14T09:00:00.000Z' } },
    ]);
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('yes');
  });

  it('drops unknown amenity keys in a hydrate batch', () => {
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'totally_made_up' as AmenityKey, entry: { vote: 'yes', updatedAt: '2026-06-14T10:00:00.000Z' } },
    ]);
    expect(getPubVotes(PUB)).toBeUndefined();
  });

  it('leaves local-only votes untouched', () => {
    usePubAmenitiesStore.getState().setVote(OTHER, 'practical_wifi', 'no');
    usePubAmenitiesStore.getState().hydrateVotes([
      { pubKey: PUB, amenityKey: 'game_darts', entry: { vote: 'yes', updatedAt: '2026-06-14T10:00:00.000Z' } },
    ]);
    expect(getPubVotes(OTHER)?.practical_wifi?.vote).toBe('no');
    expect(getPubVotes(PUB)?.game_darts?.vote).toBe('yes');
  });
});

describe('migratePubAmenities', () => {
  it('keeps known keys with valid entries', () => {
    const migrated = migratePubAmenities(
      { votes: { [PUB]: { game_darts: { vote: 'yes', updatedAt: 't' } } } },
      1,
    );
    expect(migrated.votes[PUB].game_darts).toEqual({ vote: 'yes', updatedAt: 't' });
  });

  it('drops unknown persisted keys and prunes the now-empty pub', () => {
    const migrated = migratePubAmenities(
      { votes: { [PUB]: { totally_made_up: { vote: 'yes', updatedAt: 't' } } } },
      1,
    );
    expect(migrated.votes[PUB]).toBeUndefined();
  });

  it('drops malformed entries but keeps valid siblings', () => {
    const migrated = migratePubAmenities(
      {
        votes: {
          [PUB]: {
            game_darts: { vote: 'maybe', updatedAt: 't' },
            practical_wifi: { vote: 'no', updatedAt: 't' },
          },
        },
      },
      1,
    );
    expect(migrated.votes[PUB].game_darts).toBeUndefined();
    expect(migrated.votes[PUB].practical_wifi).toEqual({ vote: 'no', updatedAt: 't' });
  });

  it('tolerates missing or malformed input', () => {
    expect(migratePubAmenities(undefined, 1).votes).toEqual({});
    expect(migratePubAmenities({ votes: { [PUB]: null } }, 1).votes).toEqual({});
  });
});

describe('selectPubVotes', () => {
  it('reads a pub vote map from a state snapshot', () => {
    usePubAmenitiesStore.getState().setVote(PUB, 'game_darts', 'yes');
    const value = selectPubVotes(PUB)(usePubAmenitiesStore.getState());
    expect(value?.game_darts?.vote).toBe('yes');
    expect(selectPubVotes(OTHER)(usePubAmenitiesStore.getState())).toBeUndefined();
  });
});
