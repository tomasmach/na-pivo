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
  preferRatedPubs: boolean;
  preferGardenPubs: boolean;
  hidePubNames: boolean;
  marketingEmailsEnabled: boolean;
  pubReminderEnabled: boolean;
  surpriseSeed: number;
  setMode: (m: Mode) => void;
  setMaxDistanceKm: (km: number | null) => void;
  setPriceCurrency: (currency: PriceCurrency) => void;
  setHapticEnabled: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setHideClosedPubs: (v: boolean) => void;
  setPreferRatedPubs: (v: boolean) => void;
  setPreferGardenPubs: (v: boolean) => void;
  setHidePubNames: (v: boolean) => void;
  setMarketingEmailsEnabled: (v: boolean) => void;
  setPubReminderEnabled: (v: boolean) => void;
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
      preferRatedPubs: false,
      preferGardenPubs: false,
      hidePubNames: false,
      marketingEmailsEnabled: false,
      pubReminderEnabled: false,
      surpriseSeed: 1,

      setMode: (m) => set({ mode: m }),
      setMaxDistanceKm: (km) => set({ maxDistanceKm: km }),
      setPriceCurrency: (currency) => set({ priceCurrency: currency }),
      setHapticEnabled: (v) => set({ hapticEnabled: v }),
      setSoundEnabled: (v) => set({ soundEnabled: v }),
      setHideClosedPubs: (v) => set({ hideClosedPubs: v }),
      setPreferRatedPubs: (v) => set({ preferRatedPubs: v }),
      setPreferGardenPubs: (v) => set({ preferGardenPubs: v }),
      setHidePubNames: (v) => set({ hidePubNames: v }),
      setMarketingEmailsEnabled: (v) => set({ marketingEmailsEnabled: v }),
      setPubReminderEnabled: (v) => set({ pubReminderEnabled: v }),
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
        preferRatedPubs: state.preferRatedPubs,
        preferGardenPubs: state.preferGardenPubs,
        hidePubNames: state.hidePubNames,
        marketingEmailsEnabled: state.marketingEmailsEnabled,
        pubReminderEnabled: state.pubReminderEnabled,
        surpriseSeed: state.surpriseSeed,
      }),
    }
  )
);
