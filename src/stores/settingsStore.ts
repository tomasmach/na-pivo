import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Mode = 'nearest' | 'surprise';

interface SettingsState {
  mode: Mode;
  maxDistanceKm: number | null;
  hapticEnabled: boolean;
  soundEnabled: boolean;
  hideClosedPubs: boolean;
  surpriseSeed: number;
  setMode: (m: Mode) => void;
  setMaxDistanceKm: (km: number | null) => void;
  setHapticEnabled: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setHideClosedPubs: (v: boolean) => void;
  bumpSurpriseSeed: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      mode: 'nearest',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      surpriseSeed: 1,

      setMode: (m) => set({ mode: m }),
      setMaxDistanceKm: (km) => set({ maxDistanceKm: km }),
      setHapticEnabled: (v) => set({ hapticEnabled: v }),
      setSoundEnabled: (v) => set({ soundEnabled: v }),
      setHideClosedPubs: (v) => set({ hideClosedPubs: v }),
      bumpSurpriseSeed: () =>
        set((state) => ({ surpriseSeed: state.surpriseSeed + 1 })),
    }),
    {
      name: 'na-pivo-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        mode: state.mode,
        maxDistanceKm: state.maxDistanceKm,
        hapticEnabled: state.hapticEnabled,
        soundEnabled: state.soundEnabled,
        hideClosedPubs: state.hideClosedPubs,
        surpriseSeed: state.surpriseSeed,
      }),
    }
  )
);
