/**
 * Counter handoff bus: another screen (a Tour de pub stop) asks the counter to
 * open on a specific pub. In-memory only — a one-shot handoff the counter
 * consumes and clears, like the compass's focusedPubStore.
 */

import { create } from 'zustand';
import type { Pub } from '@/data/pubs';

interface CounterHandoffState {
  pub: Pub | null;
  handOff: (pub: Pub) => void;
  clear: () => void;
}

export const useCounterHandoffStore = create<CounterHandoffState>((set) => ({
  pub: null,
  handOff: (pub) => set({ pub }),
  clear: () => set({ pub: null }),
}));
