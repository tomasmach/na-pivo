import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pub } from '@/data/pubs';

interface PubState {
  revealedPub: Pub | null;
  isDataLoaded: boolean;
  setRevealedPub: (p: Pub | null) => void;
  setIsDataLoaded: (v: boolean) => void;
}

export const usePubStore = create<PubState>()(
  persist(
    (set) => ({
      revealedPub: null,
      isDataLoaded: false,

      setRevealedPub: (p) => set({ revealedPub: p }),
      setIsDataLoaded: (v) => set({ isDataLoaded: v }),
    }),
    {
      name: 'na-pivo-pub',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        revealedPub: state.revealedPub,
      }),
    }
  )
);
