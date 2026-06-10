import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pub } from '@/data/pubs';

interface PubState {
  revealedPub: Pub | null;
  reportedPubIds: string[];
  /** geohash-8 cells of reported places — survives Mapy.cz handing the same
   *  physical place a fresh id, which the coordinate-derived ids do not. */
  reportedCacheKeys: string[];
  isDataLoaded: boolean;
  setRevealedPub: (p: Pub | null) => void;
  addReportedPub: (id: string, cacheKey: string) => void;
  setIsDataLoaded: (v: boolean) => void;
}

export const usePubStore = create<PubState>()(
  persist(
    (set) => ({
      revealedPub: null,
      reportedPubIds: [],
      reportedCacheKeys: [],
      isDataLoaded: false,

      setRevealedPub: (p) => set({ revealedPub: p }),
      addReportedPub: (id, cacheKey) =>
        set((state) => {
          const hasId = state.reportedPubIds.includes(id);
          const hasKey = state.reportedCacheKeys.includes(cacheKey);
          if (hasId && hasKey) return state;
          return {
            reportedPubIds: hasId ? state.reportedPubIds : [...state.reportedPubIds, id],
            reportedCacheKeys: hasKey
              ? state.reportedCacheKeys
              : [...state.reportedCacheKeys, cacheKey],
          };
        }),
      setIsDataLoaded: (v) => set({ isDataLoaded: v }),
    }),
    {
      name: 'na-pivo-pub',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        revealedPub: state.revealedPub,
        reportedPubIds: state.reportedPubIds,
        reportedCacheKeys: state.reportedCacheKeys,
      }),
    }
  )
);
