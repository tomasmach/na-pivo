/**
 * Process-local freeze spanning a complete account credential transition.
 *
 * A generation bump alone only invalidates work that started before the bump;
 * it does not stop a new photo save/delete from starting while auth is waiting
 * on the network. This barrier keeps that whole interval closed. The queue
 * subscribes synchronously so in-flight uploads are aborted before begin()
 * returns, and every public mutation also checks `isFrozen()`.
 */

export interface BeerPhotoSessionTransition {
  release(): void;
}

type BoundaryListener = (snapshot: { frozen: boolean; generation: number }) => void;

const activeTransitions = new Set<symbol>();
const listeners = new Set<BoundaryListener>();
let generation = 0;

function publish(): void {
  const snapshot = { frozen: activeTransitions.size > 0, generation };
  for (const listener of listeners) listener(snapshot);
}

export function beerPhotoSessionGeneration(): number {
  return generation;
}

export function isBeerPhotoSessionFrozen(): boolean {
  return activeTransitions.size > 0;
}

export function subscribeBeerPhotoSessionBoundary(listener: BoundaryListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Invalidate pre-clear queue work without opening or closing the auth freeze. */
export function invalidateBeerPhotoSessionGeneration(): void {
  generation += 1;
}

export function beginBeerPhotoSessionTransition(): BeerPhotoSessionTransition {
  const token = Symbol('beer-photo-session-transition');
  activeTransitions.add(token);
  generation += 1;
  publish();

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      activeTransitions.delete(token);
      generation += 1;
      publish();
    },
  };
}

/** Tests only; production transitions must always release their own handle. */
export function resetBeerPhotoSessionBoundaryForTests(): void {
  activeTransitions.clear();
  generation += 1;
  publish();
}
