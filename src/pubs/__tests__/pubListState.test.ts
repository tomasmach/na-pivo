import { resolvePubListEmptyState } from '../pubListState';

const base = {
  pubCount: 0,
  snapshotReady: true,
  fallbackSnapshotReady: false,
  hasPosition: true,
  isLoading: false,
  searchFailed: false,
  permissionState: 'granted' as const,
};

describe('resolvePubListEmptyState', () => {
  it('does not leave a fresh install spinning forever when GPS has no fix', () => {
    expect(
      resolvePubListEmptyState({
        ...base,
        fallbackSnapshotReady: true,
        hasPosition: false,
        isLoading: true,
      }),
    ).toBe('location-unavailable');
  });

  it('keeps the loader while a position-backed request is in flight', () => {
    expect(resolvePubListEmptyState({ ...base, isLoading: true })).toBe('loading');
  });

  it('keeps permission denial distinct from GPS unavailability', () => {
    expect(
      resolvePubListEmptyState({
        ...base,
        fallbackSnapshotReady: true,
        hasPosition: false,
        isLoading: true,
        permissionState: 'denied',
      }),
    ).toBe('permission-denied');
  });

  it('never replaces loaded pubs with an empty-state message', () => {
    expect(
      resolvePubListEmptyState({
        ...base,
        pubCount: 1,
        snapshotReady: false,
        isLoading: true,
      }),
    ).toBe('ready');
  });
});
