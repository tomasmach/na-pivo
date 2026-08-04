import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { WearableDrinkChoice, WearablePubRef } from '@/wearables/protocol';

interface WearableTargetState {
  /** Explicit choice shared by the phone map/compass and both watches. */
  manualTarget: WearablePubRef | null;
  /** Latest automatic phone choice. Public POI data only; no user fix. */
  nearestTarget: WearablePubRef | null;
  nearbyPubs: WearablePubRef[];
  lastNearbyRefreshAt: string | null;
  /** Current public tap list for one pub. Never contains an already logged fact. */
  menuPubKey: string | null;
  menuDrinks: WearableDrinkChoice[];
  setManualTarget: (target: WearablePubRef) => void;
  clearManualTarget: () => void;
  setNearbySnapshot: (
    nearestTarget: WearablePubRef | null,
    nearbyPubs: WearablePubRef[],
    refreshedAt?: string,
  ) => void;
  setMenuSnapshot: (pubKey: string, menuDrinks: WearableDrinkChoice[]) => void;
  reset: () => void;
}

function uniquePubs(pubs: WearablePubRef[]): WearablePubRef[] {
  const seen = new Set<string>();
  return pubs
    .filter((pub) => {
      if (seen.has(pub.pubKey)) return false;
      seen.add(pub.pubKey);
      return true;
    })
    .slice(0, 10);
}

export const useWearableTargetStore = create<WearableTargetState>()(
  persist(
    (set) => ({
      manualTarget: null,
      nearestTarget: null,
      nearbyPubs: [],
      lastNearbyRefreshAt: null,
      menuPubKey: null,
      menuDrinks: [],

      setManualTarget: (manualTarget) =>
        set((state) => ({
          manualTarget,
          ...(state.menuPubKey === manualTarget.pubKey
            ? {}
            : { menuPubKey: null, menuDrinks: [] }),
        })),
      clearManualTarget: () => set({ manualTarget: null }),
      setNearbySnapshot: (nearestTarget, nearbyPubs, refreshedAt = new Date().toISOString()) =>
        set({
          nearestTarget,
          nearbyPubs: uniquePubs([
            ...(nearestTarget ? [nearestTarget] : []),
            ...nearbyPubs,
          ]),
          lastNearbyRefreshAt: refreshedAt,
        }),
      setMenuSnapshot: (menuPubKey, menuDrinks) =>
        set({
          menuPubKey,
          menuDrinks: menuDrinks.slice(0, 20),
        }),
      reset: () =>
        set({
          manualTarget: null,
          nearestTarget: null,
          nearbyPubs: [],
          lastNearbyRefreshAt: null,
          menuPubKey: null,
          menuDrinks: [],
        }),
    }),
    {
      name: 'na-pivo-wearable-target-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({
        manualTarget,
        nearestTarget,
        nearbyPubs,
        lastNearbyRefreshAt,
        menuPubKey,
        menuDrinks,
      }) => ({
        manualTarget,
        nearestTarget,
        nearbyPubs,
        lastNearbyRefreshAt,
        menuPubKey,
        menuDrinks,
      }),
    },
  ),
);

export function selectedWearableTarget(): {
  selection: 'manual' | 'nearest';
  pub: WearablePubRef;
} | null {
  const { manualTarget, nearestTarget } = useWearableTargetStore.getState();
  if (manualTarget) return { selection: 'manual', pub: manualTarget };
  if (nearestTarget) return { selection: 'nearest', pub: nearestTarget };
  return null;
}
