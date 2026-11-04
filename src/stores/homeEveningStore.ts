import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type HomeEvening = { activityId: string; hostName: string; startedAt: string };

/**
 * The friend's home I said I am at ("Jsem u Kláry"). Kept on the phone so the
 * counter still knows after a restart without signal. The štamgast counter
 * reads it to log drinks there with `placeContext: 'private'`.
 */
export const useHomeEveningStore = create<{
  evening: HomeEvening | null;
  setEvening: (evening: HomeEvening | null) => void;
}>()(
  persist(
    (set) => ({
      evening: null,
      setEvening: (evening) => set({ evening }),
    }),
    { name: 'na-pivo-nv-home-evening', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
