/**
 * DESIGN MOCK — the running night, shared between the fullscreen party and the
 * mini bar that survives minimising it.
 *
 * Deliberately not persisted and deliberately tiny: the real thing will hang
 * off the party evening client, and this exists only so the two mock surfaces
 * agree on whether a night is live.
 */

import { create } from 'zustand';

interface LivePartyState {
  live: boolean;
  pubName: string;
  /** My tally, the number the mini bar shows. */
  beers: number;
  /** Already formatted; the mock does no clock arithmetic. */
  elapsed: string;
  start: (pubName: string) => void;
  addBeer: () => void;
  end: () => void;
}

export const useLivePartyStore = create<LivePartyState>((set) => ({
  live: false,
  pubName: '',
  beers: 0,
  elapsed: '0m',
  start: (pubName) => set({ live: true, pubName, beers: 1, elapsed: '1m' }),
  addBeer: () => set((s) => ({ beers: s.beers + 1, elapsed: '1h 12m' })),
  end: () => set({ live: false, pubName: '', beers: 0, elapsed: '0m' }),
}));
