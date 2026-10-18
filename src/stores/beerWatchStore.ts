/**
 * Watched beers ("Hlídat pivo") of the current account. Not persisted: the
 * server owns the list and the app pulls it on launch and foreground.
 */

import { create } from 'zustand';

import {
  addBeerWatch,
  fetchBeerWatches,
  removeBeerWatch,
  updateBeerWatchSettings,
  type AddBeerWatchResult,
  type BeerHelped,
  type BeerWatch,
  type BeerWatchSnapshot,
} from '@/data/beerWatchClient';
import { normalizeBeerName } from '@/data/communityHours';

const DEFAULT_RADIUS_M = 3000;

interface BeerWatchState {
  watches: BeerWatch[];
  helped: BeerHelped[];
  radiusM: number;
  locationSet: boolean;
  loaded: boolean;
  refresh: () => Promise<boolean>;
  watch: (beerName: string, breweryName?: string | null) => Promise<AddBeerWatchResult>;
  unwatch: (productKey: string) => Promise<boolean>;
  setRadius: (radiusM: number) => Promise<boolean>;
  applySnapshot: (snapshot: BeerWatchSnapshot) => void;
  reset: () => void;
}

const EMPTY = {
  watches: [] as BeerWatch[],
  helped: [] as BeerHelped[],
  radiusM: DEFAULT_RADIUS_M,
  locationSet: false,
  loaded: false,
};

// Bumped on logout, so an answer for the previous account is dropped.
let generation = 0;
// Bumped by every server answer applied, so a pull that started earlier cannot undo it.
let mutations = 0;

export const useBeerWatchStore = create<BeerWatchState>((set, get) => ({
  ...EMPTY,

  refresh: async () => {
    const gen = generation;
    const seen = mutations;
    const snapshot = await fetchBeerWatches();
    if (!snapshot || gen !== generation) return false;
    if (seen !== mutations) return get().refresh();
    get().applySnapshot(snapshot);
    set({ loaded: true });
    return true;
  },

  watch: async (beerName, breweryName) => {
    const gen = generation;
    const result = await addBeerWatch(beerName, breweryName);
    if (result.ok && gen === generation) {
      mutations += 1;
      set((s) => ({
        watches: [
          ...s.watches.filter((w) => w.productKey !== result.watch.productKey),
          result.watch,
        ],
      }));
    }
    return result;
  },

  unwatch: async (productKey) => {
    const gen = generation;
    const ok = await removeBeerWatch(productKey);
    if (ok && gen === generation) {
      mutations += 1;
      set((s) => {
        const watches = s.watches.filter((w) => w.productKey !== productKey);
        // The server forgets the watch location with the last watch.
        return { watches, locationSet: watches.length > 0 && s.locationSet };
      });
    }
    return ok;
  },

  setRadius: async (radiusM) => {
    const gen = generation;
    const previous = get().radiusM;
    set({ radiusM });
    const snapshot = await updateBeerWatchSettings({ radiusM });
    if (gen !== generation) return false;
    if (!snapshot) {
      if (get().radiusM === radiusM) set({ radiusM: previous });
      return false;
    }
    get().applySnapshot(snapshot);
    return true;
  },

  applySnapshot: (snapshot) => {
    mutations += 1;
    set({
      radiusM: snapshot.radiusM,
      locationSet: snapshot.locationSet,
      ...(snapshot.watches ? { watches: snapshot.watches } : null),
      ...(snapshot.helped ? { helped: snapshot.helped } : null),
    });
  },

  reset: () => {
    generation += 1;
    set(EMPTY);
  },
}));

/**
 * The watch whose catalog name or alias is this beer name, if any. Like the
 * server when it adds a watch, falls back to "{brewery} {beer}".
 */
export function findBeerWatch(
  watches: readonly BeerWatch[],
  beerName: string,
  breweryName?: string | null,
): BeerWatch | null {
  const find = (name: string) =>
    watches.find(
      (w) =>
        normalizeBeerName(w.name) === name ||
        w.aliases.some((alias) => normalizeBeerName(alias) === name),
    ) ?? null;
  const beer = normalizeBeerName(beerName);
  if (!beer) return null;
  const brewery = normalizeBeerName(breweryName ?? '');
  return find(beer) ?? (brewery ? find(`${brewery} ${beer}`) : null);
}

/** How many people this account's lístek edit at the pub helped with this beer. */
export function helpedCountFor(
  helped: readonly BeerHelped[],
  cacheKey: string | undefined,
  beerName: string,
): number {
  if (!cacheKey) return 0;
  const name = normalizeBeerName(beerName);
  return helped
    .filter((h) => h.cacheKey === cacheKey && normalizeBeerName(h.productName) === name)
    .reduce((sum, h) => sum + h.helpedCount, 0);
}
