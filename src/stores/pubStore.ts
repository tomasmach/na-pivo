import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pub } from '@/data/pubs';

interface PubState {
  revealedPub: Pub | null;
  reportedPubIds: string[];
  isDataLoaded: boolean;
  setRevealedPub: (p: Pub | null) => void;
  addReportedPubId: (id: string) => void;
  setIsDataLoaded: (v: boolean) => void;
}

export const usePubStore = create<PubState>()(
  persist(
    (set) => ({
      revealedPub: null,
      reportedPubIds: [],
      isDataLoaded: false,

      setRevealedPub: (p) => set({ revealedPub: p }),
      addReportedPubId: (id) =>
        set((state) => {
          if (state.reportedPubIds.includes(id)) return state;
          return { reportedPubIds: [...state.reportedPubIds, id] };
        }),
      setIsDataLoaded: (v) => set({ isDataLoaded: v }),
    }),
    {
      name: 'na-pivo-pub',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        revealedPub: state.revealedPub,
        reportedPubIds: state.reportedPubIds,
      }),
    }
  )
);
