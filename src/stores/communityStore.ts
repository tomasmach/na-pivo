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
import AsyncStorage from '@/data/privateAccountStorage';
import { guardPrivateAccountStateCreator } from '@/data/privateAccountBoundary';
import { persistedObject, persistedRecord } from '@/stores/persistedSchemas';

import type { CommunityBeer, WeeklyHours } from '@/data/communityClient';

export interface CommunityOverride {
  hours?: WeeklyHours;
  beers?: CommunityBeer[];
  historicalBeers?: CommunityBeer[];
  beerMenuRotates?: boolean;
  /** Epoch ms of the latest local opening-hours edit. */
  hoursOverrideUpdatedAt?: number;
  /** Epoch ms of the latest local beer-list/history edit. */
  beersOverrideUpdatedAt?: number;
  /** Epoch ms of the latest explicit fixed/rotating selection. */
  beerMenuRotatesOverrideUpdatedAt?: number;
  /** Epoch ms when the override was written — newest write wins on merge. */
  updatedAt: number;
}

type CommunityOverridePatch = Omit<
  CommunityOverride,
  | 'updatedAt'
  | 'hoursOverrideUpdatedAt'
  | 'beersOverrideUpdatedAt'
  | 'beerMenuRotatesOverrideUpdatedAt'
>;

function isOverrideNewer(
  overrideUpdatedAt: number,
  backendUpdatedAt: string | null | undefined,
): boolean {
  if (!backendUpdatedAt) return true;
  const backendUpdatedAtMs = Date.parse(backendUpdatedAt);
  return !Number.isFinite(backendUpdatedAtMs) || overrideUpdatedAt > backendUpdatedAtMs;
}

/**
 * Keep a fresh/offline beer edit optimistic, but let a newer server snapshot
 * replace a persisted override after sync or a later mapper correction.
 */
export function isBeerListOverrideCurrent(
  override: CommunityOverride | undefined,
  backendUpdatedAt: string | null | undefined,
): boolean {
  if (!override || (override.beers === undefined && override.historicalBeers === undefined)) {
    return false;
  }
  return isOverrideNewer(
    override.beersOverrideUpdatedAt ?? override.updatedAt,
    backendUpdatedAt,
  );
}

export function isHoursOverrideCurrent(
  override: CommunityOverride | undefined,
  backendUpdatedAt: string | null | undefined,
): boolean {
  if (!override?.hours) return false;
  return isOverrideNewer(
    override.hoursOverrideUpdatedAt ?? override.updatedAt,
    backendUpdatedAt,
  );
}

export function isBeerMenuTypeOverrideCurrent(
  override: CommunityOverride | undefined,
  backendUpdatedAt: string | null | undefined,
): boolean {
  if (!override || override.beerMenuRotates === undefined) return false;
  return isOverrideNewer(
    override.beerMenuRotatesOverrideUpdatedAt ?? override.updatedAt,
    backendUpdatedAt,
  );
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
    guardPrivateAccountStateCreator((set) => ({
      overrides: {},

      setOverride: (cell, patch) =>
        set((state) => {
          const prev = state.overrides[cell];
          const now = Date.now();
          const touchesHours = patch.hours !== undefined;
          const touchesBeerList = patch.beers !== undefined || patch.historicalBeers !== undefined;
          const touchesMenuType = patch.beerMenuRotates !== undefined;
          const previousBeerListUpdatedAt =
            prev?.beersOverrideUpdatedAt ??
            (prev?.beers !== undefined || prev?.historicalBeers !== undefined
              ? prev.updatedAt
              : undefined);
          const previousHoursUpdatedAt =
            prev?.hoursOverrideUpdatedAt ?? (prev?.hours !== undefined ? prev.updatedAt : undefined);
          const previousMenuTypeUpdatedAt =
            prev?.beerMenuRotatesOverrideUpdatedAt ??
            (prev?.beerMenuRotates !== undefined ? prev.updatedAt : undefined);
          const next: CommunityOverride = {
            hours: patch.hours ?? prev?.hours,
            beers: patch.beers ?? prev?.beers,
            historicalBeers: patch.historicalBeers ?? prev?.historicalBeers,
            beerMenuRotates: patch.beerMenuRotates ?? prev?.beerMenuRotates,
            hoursOverrideUpdatedAt: touchesHours ? now : previousHoursUpdatedAt,
            beersOverrideUpdatedAt: touchesBeerList ? now : previousBeerListUpdatedAt,
            beerMenuRotatesOverrideUpdatedAt: touchesMenuType
              ? now
              : previousMenuTypeUpdatedAt,
            updatedAt: now,
          };
          return { overrides: { ...state.overrides, [cell]: next } };
        }),
    })),
    {
      name: 'na-pivo-community',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ overrides: state.overrides }),
      merge: (persisted, current) => {
        const state = persistedObject(persisted);
        return {
          ...current,
          overrides: persistedRecord<CommunityOverride>(state.overrides),
        };
      },
    },
  ),
);
