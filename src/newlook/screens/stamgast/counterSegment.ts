import { create } from 'zustand';

/** A screen above Štamgast asks it to show the counter. Štamgast switches when `requested` changes. */
export const useCounterSegment = create<{ requested: number; open: () => void }>((set) => ({
  requested: 0,
  open: () => set((state) => ({ requested: state.requested + 1 })),
}));
