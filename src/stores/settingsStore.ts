import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PRICE_CURRENCY, type PriceCurrency } from '@/utils/currency';

export type Mode = 'nearest' | 'surprise';

interface SettingsState {
  mode: Mode;
  maxDistanceKm: number | null;
  priceCurrency: PriceCurrency;
  hapticEnabled: boolean;
  soundEnabled: boolean;
  hideClosedPubs: boolean;
  hidePubNames: boolean;
  marketingEmailsEnabled: boolean;
  surpriseSeed: number;
  setMode: (m: Mode) => void;
  setMaxDistanceKm: (km: number | null) => void;
  setPriceCurrency: (currency: PriceCurrency) => void;
  setHapticEnabled: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setHideClosedPubs: (v: boolean) => void;
  setHidePubNames: (v: boolean) => void;
  setMarketingEmailsEnabled: (v: boolean) => void;
  bumpSurpriseSeed: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      mode: 'nearest',
      maxDistanceKm: null,
      priceCurrency: DEFAULT_PRICE_CURRENCY,
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      hidePubNames: false,
      marketingEmailsEnabled: false,
      surpriseSeed: 1,

      setMode: (m) => set({ mode: m }),
      setMaxDistanceKm: (km) => set({ maxDistanceKm: km }),
      setPriceCurrency: (currency) => set({ priceCurrency: currency }),
      setHapticEnabled: (v) => set({ hapticEnabled: v }),
      setSoundEnabled: (v) => set({ soundEnabled: v }),
      setHideClosedPubs: (v) => set({ hideClosedPubs: v }),
      setHidePubNames: (v) => set({ hidePubNames: v }),
      setMarketingEmailsEnabled: (v) => set({ marketingEmailsEnabled: v }),
      bumpSurpriseSeed: () =>
        set((state) => ({ surpriseSeed: state.surpriseSeed + 1 })),
    }),
    {
      name: 'na-pivo-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        mode: state.mode,
        maxDistanceKm: state.maxDistanceKm,
        priceCurrency: state.priceCurrency,
        hapticEnabled: state.hapticEnabled,
        soundEnabled: state.soundEnabled,
        hideClosedPubs: state.hideClosedPubs,
        hidePubNames: state.hidePubNames,
        marketingEmailsEnabled: state.marketingEmailsEnabled,
        surpriseSeed: state.surpriseSeed,
      }),
    }
  )
);
