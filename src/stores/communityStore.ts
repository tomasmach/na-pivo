/**
 * Local optimistic overrides for community contributions.
 *
 * When a user submits opening hours and/or beers for a pub, we write the edit
 * here immediately — keyed by the pub's geohash-8 cell (the stable physical
 * place key) — so their contribution shows INSTANTLY in the UI, even offline and
 * before the backend round-trip. The override is merged onto the enriched pub in
 * useCompass; backend community data eventually supersedes it (see the merge
 * precedence there).
 *
 * Persisted to AsyncStorage so the optimistic view survives an app restart while
 * the queued submission is still pending delivery.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CommunityBeer, WeeklyHours } from '@/data/communityClient';

export interface CommunityOverride {
  hours?: WeeklyHours;
  beers?: CommunityBeer[];
  historicalBeers?: CommunityBeer[];
  beerMenuRotates?: boolean;
  /** Epoch ms when the override was written — newest write wins on merge. */
  updatedAt: number;
}

type CommunityOverridePatch = Omit<CommunityOverride, 'updatedAt'>;

/**
 * Keep a fresh/offline beer edit optimistic, but let a newer server snapshot
 * replace a persisted override after sync or a later mapper correction.
 */
export function isBeerOverrideCurrent(
  override: CommunityOverride | undefined,
  backendUpdatedAt: string | null | undefined,
): boolean {
  if (!override) return false;
  if (!backendUpdatedAt) return true;
  const backendUpdatedAtMs = Date.parse(backendUpdatedAt);
  return !Number.isFinite(backendUpdatedAtMs) || override.updatedAt > backendUpdatedAtMs;
}

interface CommunityState {
  /** geohash-8 cell → the user's latest local override for that pub. */
  overrides: Record<string, CommunityOverride>;
  /**
   * Merge a new optimistic override for `cell`. Only the provided parts replace
   * the stored ones (hours / beers are edited independently), so submitting just
   * beers does not wipe a previously-submitted hours override.
   */
  setOverride: (cell: string, patch: CommunityOverridePatch) => void;
}

export const useCommunityStore = create<CommunityState>()(
  persist(
    (set) => ({
      overrides: {},

      setOverride: (cell, patch) =>
        set((state) => {
          const prev = state.overrides[cell];
          const next: CommunityOverride = {
            hours: patch.hours ?? prev?.hours,
            beers: patch.beers ?? prev?.beers,
            historicalBeers: patch.historicalBeers ?? prev?.historicalBeers,
            beerMenuRotates: patch.beerMenuRotates ?? prev?.beerMenuRotates,
            updatedAt: Date.now(),
          };
          return { overrides: { ...state.overrides, [cell]: next } };
        }),
    }),
    {
      name: 'na-pivo-community',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ overrides: state.overrides }),
    },
  ),
);
