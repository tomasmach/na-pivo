/**
 * Hand-off for the pub page route. A route param can only carry strings, but
 * the page wants the whole Pub the caller already holds (hours, taps, price),
 * so the opener parks it here under its geohash-8 key and the page reads it.
 *
 * In-memory only and bounded: the page can always fall back to the name and
 * coordinates in its params and fetch the rest.
 */

import { create } from 'zustand';

import type { Pub } from '@/data/pubs';

const MAX_REMEMBERED = 12;

interface PubPageState {
  pubs: Record<string, Pub>;
  /** Names fixed on the page this session; openers still hold the old one. */
  renames: Record<string, string>;
  remember: (key: string, pub: Pub) => void;
  rename: (key: string, pub: Pub, name: string) => void;
}

function keepLatest(pubs: Record<string, Pub>, key: string, pub: Pub): Record<string, Pub> {
  const rest = Object.entries(pubs).filter(([k]) => k !== key);
  const kept = rest.slice(Math.max(0, rest.length - (MAX_REMEMBERED - 1)));
  return { ...Object.fromEntries(kept), [key]: pub };
}

export const usePubPageStore = create<PubPageState>((set) => ({
  pubs: {},
  renames: {},
  // An opener's copy may predate a rename made on the page; keep the rename.
  remember: (key, pub) =>
    set((state) => {
      const renamed = state.renames[key];
      return { pubs: keepLatest(state.pubs, key, renamed ? { ...pub, name: renamed } : pub) };
    }),
  rename: (key, pub, name) =>
    set((state) => ({
      renames: { ...state.renames, [key]: name },
      pubs: keepLatest(state.pubs, key, { ...pub, name }),
    })),
}));
