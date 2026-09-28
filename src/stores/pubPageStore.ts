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
  remember: (key: string, pub: Pub) => void;
}

export const usePubPageStore = create<PubPageState>((set) => ({
  pubs: {},
  remember: (key, pub) =>
    set((state) => {
      const rest = Object.entries(state.pubs).filter(([k]) => k !== key);
      const kept = rest.slice(Math.max(0, rest.length - (MAX_REMEMBERED - 1)));
      return { pubs: { ...Object.fromEntries(kept), [key]: pub } };
    }),
}));
