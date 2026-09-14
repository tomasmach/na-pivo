import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@/data/privateAccountStorage';
import { isPrivateAccountMutationFrozen } from '@/data/privateAccountBoundary';
import type { AccountPreferences } from '@/data/account';

import {
  DEFAULT_PRICE_CURRENCY,
  getCurrencyRate,
  setCurrencyRate,
  type PriceCurrency,
} from '@/utils/currency';

export type Mode = 'nearest' | 'surprise';
export type NavigationProvider = 'google' | 'mapy';
export type PendingAccountPreferences = Partial<AccountPreferences>;
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
  /**
   * Optimistic server preferences that have not been acknowledged yet.
   * Persisting the overlay prevents a stale GET /account/me response from
   * undoing an offline toggle after a restart.
   */
  pendingAccountPreferences: PendingAccountPreferences;
  pendingAccountPreferencesOwnerId: string | null;
  /**
   * Process-local generation for server reads. A GET captures it before the
   * request and may apply its response only while the generation still
   * matches. Staging and acknowledging a PATCH both advance it, covering a
   * stale GET started on either side of the local toggle.
   */
  accountPreferencesRevision: number;
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
  stageAccountPreferences: (
    preferences: Partial<AccountPreferences>,
    ownerAccountId?: string | null,
  ) => boolean;
  bindPendingAccountPreferencesOwner: (accountId: string) => boolean;
  settlePendingAccountPreferences: (
    preferences: Partial<AccountPreferences>,
    ownerAccountId: string,
  ) => void;
  clearPendingAccountPreferences: () => void;
  applyAccountPreferencesFromServer: (
    preferences: Partial<AccountPreferences>,
    accountId: string | null,
    expectedRevision?: number,
  ) => void;
  bumpSurpriseSeed: () => void;
  setLastSeenPartyStreak: (v: number) => void;
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/** Strip undefined/invalid values before they enter the durable queue overlay. */
export function normalizeAccountPreferencesPatch(
  preferences: Partial<AccountPreferences>,
): PendingAccountPreferences {
  const normalized: PendingAccountPreferences = {};
  if (preferences.mode === 'nearest' || preferences.mode === 'surprise') {
    normalized.mode = preferences.mode;
  }
  if (
    preferences.maxDistanceKm === null ||
    (typeof preferences.maxDistanceKm === 'number' &&
      Number.isFinite(preferences.maxDistanceKm))
  ) {
    normalized.maxDistanceKm = preferences.maxDistanceKm;
  }
  if (preferences.priceCurrency === 'CZK' || preferences.priceCurrency === 'EUR') {
    normalized.priceCurrency = preferences.priceCurrency;
  }
  if (typeof preferences.hapticEnabled === 'boolean') {
    normalized.hapticEnabled = preferences.hapticEnabled;
  }
  if (typeof preferences.soundEnabled === 'boolean') {
    normalized.soundEnabled = preferences.soundEnabled;
  }
  if (typeof preferences.hideClosedPubs === 'boolean') {
    normalized.hideClosedPubs = preferences.hideClosedPubs;
  }
  if (typeof preferences.hidePubNames === 'boolean') {
    normalized.hidePubNames = preferences.hidePubNames;
  }
  if (typeof preferences.marketingEmailsEnabled === 'boolean') {
    normalized.marketingEmailsEnabled = preferences.marketingEmailsEnabled;
  }
  return normalized;
}

function preferenceValues(
  preferences: PendingAccountPreferences,
): Partial<SettingsState> {
  const values: Partial<SettingsState> = {};
  if (preferences.mode) values.mode = preferences.mode;
  if (hasOwn(preferences, 'maxDistanceKm')) {
    values.maxDistanceKm = preferences.maxDistanceKm ?? null;
  }
  if (preferences.priceCurrency) {
    const rate = getCurrencyRate(preferences.priceCurrency) ?? 1;
    setCurrencyRate(preferences.priceCurrency, rate);
    values.priceCurrency = preferences.priceCurrency;
    values.priceCurrencyRate = rate;
  }
  if (typeof preferences.hapticEnabled === 'boolean') {
    values.hapticEnabled = preferences.hapticEnabled;
  }
  if (typeof preferences.soundEnabled === 'boolean') {
    values.soundEnabled = preferences.soundEnabled;
  }
  if (typeof preferences.hideClosedPubs === 'boolean') {
    values.hideClosedPubs = preferences.hideClosedPubs;
  }
  if (typeof preferences.hidePubNames === 'boolean') {
    values.hidePubNames = preferences.hidePubNames;
  }
  if (typeof preferences.marketingEmailsEnabled === 'boolean') {
    values.marketingEmailsEnabled = preferences.marketingEmailsEnabled;
  }
  return values;
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
      pendingAccountPreferences: {},
      pendingAccountPreferencesOwnerId: null,
      accountPreferencesRevision: 0,
      surpriseSeed: 1,
      lastSeenPartyStreak: 0,

      setMode: (m) => set({ mode: m }),
      setHomePoint: (point) => {
        if (isPrivateAccountMutationFrozen()) return;
        set({ homePoint: point });
      },
      setNavigationProvider: (provider) => set({ navigationProvider: provider }),
      setMaxDistanceKm: (km) => set({ maxDistanceKm: km }),
      setPriceCurrency: (currency, rateCzkPerUnit) => {
        if (isPrivateAccountMutationFrozen()) return;
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
      setMarketingEmailsEnabled: (v) => {
        if (isPrivateAccountMutationFrozen()) return;
        set({ marketingEmailsEnabled: v });
      },
      setPubReminderEnabled: (v) => set({ pubReminderEnabled: v }),
      setBeerCountReminderEnabled: (v) => set({ beerCountReminderEnabled: v }),
      setBeerCountReminderIntervalMinutes: (v) =>
        set({ beerCountReminderIntervalMinutes: v }),
      setWaterNudgeEnabled: (v) => set({ waterNudgeEnabled: v }),
      setFriendPushEnabled: (v) => set({ friendPushEnabled: v }),
      setFriendPushPrompted: (v) => set({ friendPushPrompted: v }),
      setFriendPushOptedOut: (v) => set({ friendPushOptedOut: v }),
      stageAccountPreferences: (preferences, ownerAccountId = null) => {
        if (isPrivateAccountMutationFrozen()) return false;
        const patch = normalizeAccountPreferencesPatch(preferences);
        if (Object.keys(patch).length === 0) return false;
        let staged = false;
        set((state) => {
          const pendingKeys = Object.keys(state.pendingAccountPreferences);
          if (
            pendingKeys.length > 0 &&
            state.pendingAccountPreferencesOwnerId &&
            ownerAccountId &&
            state.pendingAccountPreferencesOwnerId !== ownerAccountId
          ) {
            return state;
          }
          staged = true;
          return {
            ...preferenceValues(patch),
            pendingAccountPreferences: {
              ...state.pendingAccountPreferences,
              ...patch,
            },
            pendingAccountPreferencesOwnerId:
              state.pendingAccountPreferencesOwnerId ?? ownerAccountId,
            accountPreferencesRevision: state.accountPreferencesRevision + 1,
          };
        });
        return staged;
      },
      bindPendingAccountPreferencesOwner: (accountId) => {
        if (isPrivateAccountMutationFrozen()) return false;
        let bound = false;
        set((state) => {
          if (Object.keys(state.pendingAccountPreferences).length === 0) return state;
          if (
            state.pendingAccountPreferencesOwnerId &&
            state.pendingAccountPreferencesOwnerId !== accountId
          ) {
            return state;
          }
          bound = true;
          return { pendingAccountPreferencesOwnerId: accountId };
        });
        return bound;
      },
      settlePendingAccountPreferences: (preferences, ownerAccountId) => {
        if (isPrivateAccountMutationFrozen()) return;
        const attempted = normalizeAccountPreferencesPatch(preferences);
        set((state) => {
          if (
            state.pendingAccountPreferencesOwnerId &&
            state.pendingAccountPreferencesOwnerId !== ownerAccountId
          ) {
            return state;
          }
          const pending = { ...state.pendingAccountPreferences };
          for (const key of Object.keys(attempted) as (keyof AccountPreferences)[]) {
            if (Object.is(pending[key], attempted[key])) delete pending[key];
          }
          return {
            pendingAccountPreferences: pending,
            pendingAccountPreferencesOwnerId:
              Object.keys(pending).length === 0
                ? null
                : state.pendingAccountPreferencesOwnerId ?? ownerAccountId,
            accountPreferencesRevision: state.accountPreferencesRevision + 1,
          };
        });
      },
      clearPendingAccountPreferences: () => {
        if (isPrivateAccountMutationFrozen()) return;
        set((state) => ({
          pendingAccountPreferences: {},
          pendingAccountPreferencesOwnerId: null,
          accountPreferencesRevision: state.accountPreferencesRevision + 1,
        }));
      },
      applyAccountPreferencesFromServer: (preferences, accountId, expectedRevision) => {
        if (isPrivateAccountMutationFrozen()) return;
        const incoming = normalizeAccountPreferencesPatch(preferences);
        set((state) => {
          if (
            expectedRevision !== undefined &&
            state.accountPreferencesRevision !== expectedRevision
          ) {
            return state;
          }
          const pendingApplies =
            Object.keys(state.pendingAccountPreferences).length > 0 &&
            (state.pendingAccountPreferencesOwnerId === null ||
              state.pendingAccountPreferencesOwnerId === accountId);
          if (!pendingApplies) return preferenceValues(incoming);

          const safe: PendingAccountPreferences = {};
          for (const key of Object.keys(incoming) as (keyof AccountPreferences)[]) {
            if (!hasOwn(state.pendingAccountPreferences, key)) {
              Object.assign(safe, { [key]: incoming[key] });
            }
          }
          return preferenceValues(safe);
        });
      },
      bumpSurpriseSeed: () =>
        set((state) => ({ surpriseSeed: state.surpriseSeed + 1 })),
      setLastSeenPartyStreak: (v) => {
        if (isPrivateAccountMutationFrozen()) return;
        set({ lastSeenPartyStreak: v });
      },
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
        pendingAccountPreferences: state.pendingAccountPreferences,
        pendingAccountPreferencesOwnerId: state.pendingAccountPreferencesOwnerId,
        surpriseSeed: state.surpriseSeed,
        lastSeenPartyStreak: state.lastSeenPartyStreak,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.priceCurrency && state.priceCurrencyRate > 0) {
          setCurrencyRate(state.priceCurrency, state.priceCurrencyRate);
        }
      },
      version: 2,
      migrate: (persistedState, version) => {
        let state = persistedState as Partial<SettingsState>;
        if (version < 1) {
          state = {
            ...state,
            // The old value was an implicit default, not recorded consent.
            waterNudgeEnabled: false,
          };
        }
        if (version < 2) {
          state = {
            ...state,
            pendingAccountPreferences: {},
            pendingAccountPreferencesOwnerId: null,
          };
        }
        return state as SettingsState;
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
