import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_PRICE_CURRENCY,
  getCurrencyRate,
  setCurrencyRate,
  type PriceCurrency,
} from '@/utils/currency';

export type Mode = 'nearest' | 'surprise';
export type NavigationProvider = 'google' | 'mapy';
export interface HomePoint {
  lat: number;
  lng: number;
}

export const BEER_COUNT_REMINDER_INTERVAL_OPTIONS = [15, 20, 30, 45] as const;
export type BeerCountReminderIntervalMinutes =
  (typeof BEER_COUNT_REMINDER_INTERVAL_OPTIONS)[number];

interface SettingsState {
  mode: Mode;
  homePoint: HomePoint | null;
  navigationProvider: NavigationProvider;
  maxDistanceKm: number | null;
  priceCurrency: PriceCurrency;
  priceCurrencyRate: number;
  hapticEnabled: boolean;
  soundEnabled: boolean;
  hideClosedPubs: boolean;
  preferRatedPubs: boolean;
  preferGardenPubs: boolean;
  hidePubNames: boolean;
  marketingEmailsEnabled: boolean;
  pubReminderEnabled: boolean;
  /** One-shot reminder refreshed by each beer of an active evening. */
  beerCountReminderEnabled: boolean;
  /** Delay used for the first reminder and each user-confirmed follow-up. */
  beerCountReminderIntervalMinutes: BeerCountReminderIntervalMinutes;
  /** Gentle "grab a water" nudge in the counter every few beers in a row. */
  waterNudgeEnabled: boolean;
  /** Parta push opt-in (notification permission only, decoupled from reminders). */
  friendPushEnabled: boolean;
  /** Whether the in-context Parta push prompt strip was already shown/dismissed. */
  friendPushPrompted: boolean;
  /**
   * The user explicitly turned Parta notifications OFF from the settings toggle.
   * Persisted so the launch/focus re-register (ensureFriendPushRegisteredIfGranted)
   * never forces the toggle back on over an opt-out. Cleared on an explicit enable.
   */
  friendPushOptedOut: boolean;
  surpriseSeed: number;
  lastSeenPartyStreak: number;
  setMode: (m: Mode) => void;
  setHomePoint: (point: HomePoint | null) => void;
  setNavigationProvider: (provider: NavigationProvider) => void;
  setMaxDistanceKm: (km: number | null) => void;
  setPriceCurrency: (currency: PriceCurrency, rateCzkPerUnit?: number) => void;
  setHapticEnabled: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setHideClosedPubs: (v: boolean) => void;
  setPreferRatedPubs: (v: boolean) => void;
  setPreferGardenPubs: (v: boolean) => void;
  setHidePubNames: (v: boolean) => void;
  setMarketingEmailsEnabled: (v: boolean) => void;
  setPubReminderEnabled: (v: boolean) => void;
  setBeerCountReminderEnabled: (v: boolean) => void;
  setBeerCountReminderIntervalMinutes: (v: BeerCountReminderIntervalMinutes) => void;
  setWaterNudgeEnabled: (v: boolean) => void;
  setFriendPushEnabled: (v: boolean) => void;
  setFriendPushPrompted: (v: boolean) => void;
  setFriendPushOptedOut: (v: boolean) => void;
  bumpSurpriseSeed: () => void;
  setLastSeenPartyStreak: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      mode: 'nearest',
      homePoint: null,
      navigationProvider: 'google',
      maxDistanceKm: null,
      priceCurrency: DEFAULT_PRICE_CURRENCY,
      priceCurrencyRate: 1,
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      preferRatedPubs: false,
      preferGardenPubs: false,
      hidePubNames: false,
      marketingEmailsEnabled: false,
      pubReminderEnabled: false,
      beerCountReminderEnabled: true,
      beerCountReminderIntervalMinutes: 20,
      // Explicit opt-in: a responsible-drinking nudge must never appear as an
      // unexpected judgment during an evening.
      waterNudgeEnabled: false,
      friendPushEnabled: false,
      friendPushPrompted: false,
      friendPushOptedOut: false,
      surpriseSeed: 1,
      lastSeenPartyStreak: 0,

      setMode: (m) => set({ mode: m }),
      setHomePoint: (point) => set({ homePoint: point }),
      setNavigationProvider: (provider) => set({ navigationProvider: provider }),
      setMaxDistanceKm: (km) => set({ maxDistanceKm: km }),
      setPriceCurrency: (currency, rateCzkPerUnit) => {
        const rate = rateCzkPerUnit ?? getCurrencyRate(currency) ?? 1;
        setCurrencyRate(currency, rate);
        set({ priceCurrency: currency, priceCurrencyRate: rate });
      },
      setHapticEnabled: (v) => set({ hapticEnabled: v }),
      setSoundEnabled: (v) => set({ soundEnabled: v }),
      setHideClosedPubs: (v) => set({ hideClosedPubs: v }),
      setPreferRatedPubs: (v) => set({ preferRatedPubs: v }),
      setPreferGardenPubs: (v) => set({ preferGardenPubs: v }),
      setHidePubNames: (v) => set({ hidePubNames: v }),
      setMarketingEmailsEnabled: (v) => set({ marketingEmailsEnabled: v }),
      setPubReminderEnabled: (v) => set({ pubReminderEnabled: v }),
      setBeerCountReminderEnabled: (v) => set({ beerCountReminderEnabled: v }),
      setBeerCountReminderIntervalMinutes: (v) =>
        set({ beerCountReminderIntervalMinutes: v }),
      setWaterNudgeEnabled: (v) => set({ waterNudgeEnabled: v }),
      setFriendPushEnabled: (v) => set({ friendPushEnabled: v }),
      setFriendPushPrompted: (v) => set({ friendPushPrompted: v }),
      setFriendPushOptedOut: (v) => set({ friendPushOptedOut: v }),
      bumpSurpriseSeed: () =>
        set((state) => ({ surpriseSeed: state.surpriseSeed + 1 })),
      setLastSeenPartyStreak: (v) => set({ lastSeenPartyStreak: v }),
    }),
    {
      name: 'na-pivo-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        mode: state.mode,
        homePoint: state.homePoint,
        navigationProvider: state.navigationProvider,
        maxDistanceKm: state.maxDistanceKm,
        priceCurrency: state.priceCurrency,
        priceCurrencyRate: state.priceCurrencyRate,
        hapticEnabled: state.hapticEnabled,
        soundEnabled: state.soundEnabled,
        hideClosedPubs: state.hideClosedPubs,
        preferRatedPubs: state.preferRatedPubs,
        preferGardenPubs: state.preferGardenPubs,
        hidePubNames: state.hidePubNames,
        marketingEmailsEnabled: state.marketingEmailsEnabled,
        pubReminderEnabled: state.pubReminderEnabled,
        beerCountReminderEnabled: state.beerCountReminderEnabled,
        beerCountReminderIntervalMinutes: state.beerCountReminderIntervalMinutes,
        waterNudgeEnabled: state.waterNudgeEnabled,
        friendPushEnabled: state.friendPushEnabled,
        friendPushPrompted: state.friendPushPrompted,
        friendPushOptedOut: state.friendPushOptedOut,
        surpriseSeed: state.surpriseSeed,
        lastSeenPartyStreak: state.lastSeenPartyStreak,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.priceCurrency && state.priceCurrencyRate > 0) {
          setCurrencyRate(state.priceCurrency, state.priceCurrencyRate);
        }
      },
      version: 1,
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<SettingsState>;
        if (version < 1) {
          return {
            ...state,
            // The old value was an implicit default, not recorded consent.
            waterNudgeEnabled: false,
          } as SettingsState;
        }
        return persistedState as SettingsState;
      },
    }
  )
);

export async function waitForSettingsHydration(): Promise<void> {
  const persist = useSettingsStore.persist;
  if (persist.hasHydrated()) return;

  await new Promise<void>((resolve) => {
    const unsubscribe = persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });

    if (persist.hasHydrated()) {
      unsubscribe();
      resolve();
    } else {
      void persist.rehydrate();
    }
  });
}
