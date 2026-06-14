import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { usePubRatingsStore, getPubRating, selectPubRating } from '../pubRatingsStore';

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

describe('setRating — note', () => {
  it('stores a note without a verdict', () => {
    usePubRatingsStore.getState().setRating(PUB, { note: 'Sem se vrátit' });
    const rating = getPubRating(PUB);
    expect(rating?.note).toBe('Sem se vrátit');
    expect(rating?.verdict).toBeUndefined();
  });

  it('keeps the verdict when only the note changes', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    usePubRatingsStore.getState().setRating(PUB, { note: 'Dobrý tankový' });
    const rating = getPubRating(PUB);
    expect(rating?.verdict).toBe('like');
    expect(rating?.note).toBe('Dobrý tankový');
  });

  it('removes only the note but keeps the rating when a verdict remains', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like', note: 'Nic moc' });
    usePubRatingsStore.getState().setRating(PUB, { note: undefined });
    const rating = getPubRating(PUB);
    expect(rating?.verdict).toBe('like');
    expect(rating?.note).toBeUndefined();
  });

  it('drops the entry when the last note is removed and there is no verdict', () => {
    usePubRatingsStore.getState().setRating(PUB, { note: 'Nic moc' });
    usePubRatingsStore.getState().setRating(PUB, { note: undefined });
    expect(getPubRating(PUB)).toBeUndefined();
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

describe('selectPubRating', () => {
  it('reads a rating from a state snapshot', () => {
    usePubRatingsStore.getState().setRating(PUB, { verdict: 'like' });
    const value = selectPubRating(PUB)(usePubRatingsStore.getState());
    expect(value?.verdict).toBe('like');
    expect(selectPubRating(OTHER)(usePubRatingsStore.getState())).toBeUndefined();
  });
});
