import {
  beerPhotoSessionGeneration,
  beginBeerPhotoSessionTransition,
  isBeerPhotoSessionFrozen,
  resetBeerPhotoSessionBoundaryForTests,
  subscribeBeerPhotoSessionBoundary,
} from '../beerPhotoSessionBoundary';

beforeEach(() => {
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
