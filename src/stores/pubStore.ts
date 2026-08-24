import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@/data/privateAccountStorage';
import { guardPrivateAccountStateCreator } from '@/data/privateAccountBoundary';
import type { Pub } from '@/data/pubs';
import { persistedArray, persistedObject } from '@/stores/persistedSchemas';

interface PubState {
  revealedPub: Pub | null;
  reportedPubIds: string[];
  /** geohash-8 cells of reported places — survives Mapy.cz handing the same
   *  physical place a fresh id, which the coordinate-derived ids do not. */
  reportedCacheKeys: string[];
  isDataLoaded: boolean;
  catalogRevision: number;
  setRevealedPub: (p: Pub | null) => void;
  addReportedPub: (id: string, cacheKey: string) => void;
  setIsDataLoaded: (v: boolean) => void;
  bumpCatalogRevision: () => void;
}

export const usePubStore = create<PubState>()(
  persist(
    guardPrivateAccountStateCreator((set) => ({
      revealedPub: null,
      reportedPubIds: [],
      reportedCacheKeys: [],
      isDataLoaded: false,
      catalogRevision: 0,

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
      bumpCatalogRevision: () => set((state) => ({ catalogRevision: state.catalogRevision + 1 })),
    })),
    {
      name: 'na-pivo-pub',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        revealedPub: state.revealedPub,
        reportedPubIds: state.reportedPubIds,
        reportedCacheKeys: state.reportedCacheKeys,
      }),
      merge: (persisted, current) => {
        const state = persistedObject(persisted);
        return {
          ...current,
          revealedPub:
            state.revealedPub && typeof state.revealedPub === 'object'
              ? state.revealedPub as Pub
              : null,
          reportedPubIds: persistedArray<string>(state.reportedPubIds),
          reportedCacheKeys: persistedArray<string>(state.reportedCacheKeys),
        };
      },
    }
  )
);
