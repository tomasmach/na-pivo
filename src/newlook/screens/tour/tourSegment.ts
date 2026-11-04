import { create } from 'zustand';

/**
 * The running-tour bar above the tabs asks Štamgast to show its Tour segment.
 * Štamgast switches when `requested` changes and may ignore it without an active run.
 */
export const useTourSegment = create<{ requested: number; open: () => void }>((set) => ({
  requested: 0,
  open: () => set((state) => ({ requested: state.requested + 1 })),
}));
