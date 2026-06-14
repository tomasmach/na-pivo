import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  usePubRatingsStore,
  getPubRating,
  selectPubRating,
  migratePubRatings,
} from '../pubRatingsStore';

const PUB = 'aaaaaaaa';
const OTHER = 'bbbbbbbb';

beforeEach(() => {
  (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, unknown> }).__INTERNAL_MOCK_STORAGE__ = {};
  usePubRatingsStore.setState({ ratings: {} });
});

describe('setRating — verdict', () => {
  it('stores a like verdict', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    const rating = getPubRating(PUB);
    expect(rating?.verdict).toBe('like');
    expect(rating?.updatedAt).toBeTruthy();
  });

  it('changes the verdict in place', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'dislike' });
    expect(getPubRating(PUB)?.verdict).toBe('dislike');
  });

  it('clears the rating entirely when the verdict is cleared and no note remains', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    usePubRatingsStore.getState().setRating(PUB, { verdict: undefined });
    expect(getPubRating(PUB)).toBeUndefined();
  });
});

describe('setRating — tag', () => {
  it('stores a quick tag without a verdict', () => {
    usePubRatingsStore.getState().setRating(PUB, { tag: 'Sem se vrátit' });
    const rating = getPubRating(PUB);
    expect(rating?.tag).toBe('Sem se vrátit');
    expect(rating?.verdict).toBeUndefined();
  });

  it('keeps the verdict when only the tag changes', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    usePubRatingsStore.getState().setRating(PUB, { tag: 'Dobrý tankový' });
    const rating = getPubRating(PUB);
    expect(rating?.verdict).toBe('like');
    expect(rating?.tag).toBe('Dobrý tankový');
  });

  it('removes only the tag but keeps the rating when a verdict remains', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like', tag: 'Nic moc' });
    usePubRatingsStore.getState().setRating(PUB, { tag: undefined });
    const rating = getPubRating(PUB);
    expect(rating?.verdict).toBe('like');
    expect(rating?.tag).toBeUndefined();
  });

  it('drops the entry when the last tag is removed and there is no verdict', () => {
    usePubRatingsStore.getState().setRating(PUB, { tag: 'Nic moc' });
    usePubRatingsStore.getState().setRating(PUB, { tag: undefined });
    expect(getPubRating(PUB)).toBeUndefined();
  });
});

describe('setRating — free-text note', () => {
  it('stores a free-text note alongside a verdict and tag', () => {
    usePubRatingsStore
      .getState()
      .setRating(PUB, { verdict: 'like', tag: 'Sem se vrátit', note: 'Skvělý výčep' });
    const rating = getPubRating(PUB);
    expect(rating?.verdict).toBe('like');
    expect(rating?.tag).toBe('Sem se vrátit');
    expect(rating?.note).toBe('Skvělý výčep');
  });

  it('trims surrounding whitespace from the note', () => {
    usePubRatingsStore.getState().setRating(PUB, { note: '  draho ale dobrý  ' });
    expect(getPubRating(PUB)?.note).toBe('draho ale dobrý');
  });

  it('clears a blank note and drops the entry when nothing else remains', () => {
    usePubRatingsStore.getState().setRating(PUB, { note: 'něco' });
    usePubRatingsStore.getState().setRating(PUB, { note: '   ' });
    expect(getPubRating(PUB)).toBeUndefined();
  });

  it('keeps the rating when the note is blanked but a verdict remains', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'dislike', note: 'fuj' });
    usePubRatingsStore.getState().setRating(PUB, { note: '' });
    const rating = getPubRating(PUB);
    expect(rating?.verdict).toBe('dislike');
    expect(rating?.note).toBeUndefined();
  });
});

describe('migratePubRatings — v0 → v1', () => {
  it('moves a legacy preset note into the tag field', () => {
    const migrated = migratePubRatings(
      { ratings: { [PUB]: { verdict: 'like', note: 'Sem se vrátit', updatedAt: 't' } } },
      0,
    );
    expect(migrated.ratings[PUB]).toEqual({
      verdict: 'like',
      tag: 'Sem se vrátit',
      updatedAt: 't',
    });
  });

  it('keeps a non-preset legacy note as a free-text note', () => {
    const migrated = migratePubRatings(
      { ratings: { [PUB]: { note: 'vlastní text', updatedAt: 't' } } },
      0,
    );
    expect(migrated.ratings[PUB]).toEqual({ note: 'vlastní text', updatedAt: 't' });
  });

  it('drops legacy entries that carry no signal', () => {
    const migrated = migratePubRatings(
      { ratings: { [PUB]: { updatedAt: 't' }, [OTHER]: { verdict: 'dislike', updatedAt: 't' } } },
      0,
    );
    expect(migrated.ratings[PUB]).toBeUndefined();
    expect(migrated.ratings[OTHER]?.verdict).toBe('dislike');
  });

  it('passes already-current state through untouched', () => {
    const current = { ratings: { [PUB]: { verdict: 'like', tag: 'Nic moc', updatedAt: 't' } } };
    expect(migratePubRatings(current, 1)).toBe(current);
  });

  it('tolerates missing or malformed input', () => {
    expect(migratePubRatings(undefined, 0).ratings).toEqual({});
    expect(migratePubRatings({ ratings: { [PUB]: null } }, 0).ratings).toEqual({});
  });
});

describe('clearRating + isolation', () => {
  it('removes a rating', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    usePubRatingsStore.getState().clearRating(PUB);
    expect(getPubRating(PUB)).toBeUndefined();
  });

  it('does not touch other pubs', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    usePubRatingsStore.getState().setRating(OTHER, { verdict: 'dislike' });
    usePubRatingsStore.getState().clearRating(PUB);
    expect(getPubRating(PUB)).toBeUndefined();
    expect(getPubRating(OTHER)?.verdict).toBe('dislike');
  });
});

describe('hydrateRatings — last-write-wins merge', () => {
  it('adds a server rating the local store does not have', () => {
    usePubRatingsStore.getState().hydrateRatings([
      { pubKey: PUB, rating: { verdict: 'like', updatedAt: '2026-06-14T10:00:00.000Z' } },
    ]);
    expect(getPubRating(PUB)?.verdict).toBe('like');
  });

  it('overwrites a local rating only when the server copy is strictly newer', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    // Force a known-old local timestamp.
    usePubRatingsStore.setState({
      ratings: { [PUB]: { verdict: 'like', updatedAt: '2026-06-14T10:00:00.000Z' } },
    });
    usePubRatingsStore.getState().hydrateRatings([
      { pubKey: PUB, rating: { verdict: 'dislike', updatedAt: '2026-06-14T12:00:00.000Z' } },
    ]);
    expect(getPubRating(PUB)?.verdict).toBe('dislike');
  });

  it('keeps the local rating when it is newer than the server copy', () => {
    usePubRatingsStore.setState({
      ratings: { [PUB]: { verdict: 'like', updatedAt: '2026-06-14T12:00:00.000Z' } },
    });
    usePubRatingsStore.getState().hydrateRatings([
      { pubKey: PUB, rating: { verdict: 'dislike', updatedAt: '2026-06-14T10:00:00.000Z' } },
    ]);
    expect(getPubRating(PUB)?.verdict).toBe('like');
  });

  it('keeps the local rating when timestamps are equal (no strict-newer win)', () => {
    const stamp = '2026-06-14T12:00:00.000Z';
    usePubRatingsStore.setState({ ratings: { [PUB]: { verdict: 'like', updatedAt: stamp } } });
    usePubRatingsStore.getState().hydrateRatings([
      { pubKey: PUB, rating: { verdict: 'dislike', updatedAt: stamp } },
    ]);
    expect(getPubRating(PUB)?.verdict).toBe('like');
  });

  it('leaves local-only ratings untouched', () => {
    usePubRatingsStore.getState().setRating(OTHER, { verdict: 'dislike' });
    usePubRatingsStore.getState().hydrateRatings([
      { pubKey: PUB, rating: { verdict: 'like', updatedAt: '2026-06-14T10:00:00.000Z' } },
    ]);
    expect(getPubRating(OTHER)?.verdict).toBe('dislike');
    expect(getPubRating(PUB)?.verdict).toBe('like');
  });
});

describe('selectPubRating', () => {
  it('reads a rating from a state snapshot', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    const value = selectPubRating(PUB)(usePubRatingsStore.getState());
    expect(value?.verdict).toBe('like');
    expect(selectPubRating(OTHER)(usePubRatingsStore.getState())).toBeUndefined();
  });
});
