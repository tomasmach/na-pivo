import {
  beerPhotoSessionGeneration,
  beginBeerPhotoSessionTransition,
  isBeerPhotoSessionFrozen,
  resetBeerPhotoSessionBoundaryForTests,
  setBeerPhotoDeletionRecoveryBlocked,
  subscribeBeerPhotoSessionBoundary,
} from '../beerPhotoSessionBoundary';

beforeEach(() => {
  setBeerPhotoDeletionRecoveryBlocked(false);
  resetBeerPhotoSessionBoundaryForTests();
});

afterEach(() => {
  setBeerPhotoDeletionRecoveryBlocked(false);
  resetBeerPhotoSessionBoundaryForTests();
});

it('stays frozen until every nested transition releases', () => {
  const firstGeneration = beerPhotoSessionGeneration();
  const first = beginBeerPhotoSessionTransition();
  const second = beginBeerPhotoSessionTransition();

  expect(isBeerPhotoSessionFrozen()).toBe(true);
  expect(beerPhotoSessionGeneration()).toBeGreaterThan(firstGeneration);

  first.release();
  expect(isBeerPhotoSessionFrozen()).toBe(true);

  second.release();
  expect(isBeerPhotoSessionFrozen()).toBe(false);
});

it('makes release idempotent and publishes every real boundary change', () => {
  const snapshots: { frozen: boolean; generation: number }[] = [];
  const unsubscribe = subscribeBeerPhotoSessionBoundary((snapshot) => {
    snapshots.push(snapshot);
  });
  const transition = beginBeerPhotoSessionTransition();
  transition.release();
  const releasedGeneration = beerPhotoSessionGeneration();
  transition.release();
  unsubscribe();

  expect(beerPhotoSessionGeneration()).toBe(releasedGeneration);
  expect(snapshots.map(({ frozen }) => frozen)).toEqual([true, false]);
});

it('stays frozen across a transition while deletion recovery blocks and unfreezes only when it clears', () => {
  const snapshots: { frozen: boolean; generation: number }[] = [];
  const unsubscribe = subscribeBeerPhotoSessionBoundary((snapshot) => {
    snapshots.push(snapshot);
  });

  setBeerPhotoDeletionRecoveryBlocked(true);
  expect(isBeerPhotoSessionFrozen()).toBe(true);

  const transition = beginBeerPhotoSessionTransition();
  expect(isBeerPhotoSessionFrozen()).toBe(true);
  transition.release();
  expect(isBeerPhotoSessionFrozen()).toBe(true);

  const snapshotsBeforeClear = snapshots.length;
  expect(snapshots.some(({ frozen }) => !frozen)).toBe(false);

  setBeerPhotoDeletionRecoveryBlocked(false);
  expect(isBeerPhotoSessionFrozen()).toBe(false);
  const unfreezeSnapshots = snapshots
    .slice(snapshotsBeforeClear)
    .filter(({ frozen }) => !frozen);
  expect(unfreezeSnapshots).toHaveLength(1);
  unsubscribe();
});

it('isolates a throwing listener so the public mutation and other listeners survive', () => {
  const throwingListener = jest.fn(() => {
    throw new Error('listener exploded');
  });
  const healthyListener = jest.fn();
  subscribeBeerPhotoSessionBoundary(throwingListener);
  const unsubscribeHealthy = subscribeBeerPhotoSessionBoundary(healthyListener);

  try {
    expect(() => setBeerPhotoDeletionRecoveryBlocked(true)).not.toThrow();

    expect(healthyListener).toHaveBeenCalledTimes(1);
    expect(healthyListener.mock.calls[0][0]).toMatchObject({ frozen: true });
    expect(isBeerPhotoSessionFrozen()).toBe(true);
  } finally {
    unsubscribeHealthy();
    subscribeBeerPhotoSessionBoundary(throwingListener)();
    setBeerPhotoDeletionRecoveryBlocked(false);
  }
});
