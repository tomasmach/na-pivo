/**
 * Výčep publish-state store.
 *
 * Remembers which of MY nights are currently hung up on the Výčep feed and
 * with what visibility, keyed by the night's publish client id
 * (`night-YYYY-MM-DD`). This is what the evening detail uses to show the
 * "Visí ve Výčepu" state and what the publish sheet uses to preselect the
 * visibility on a re-publish. The server stays the source of truth for the
 * feed itself; this is only my own publication ledger, so it is persisted
 * whole (it stays tiny — one row per published night).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NightVisibility } from '@/data/nightsClient';

export interface PublishedNightRecord {
  clientId: string;
  visibility: NightVisibility;
  /** ISO timestamp of the last publish/update from this device. */
  publishedAt: string;
}

export type NightAutopublish = 'off' | NightVisibility;

/**
 * Account sharing defaults (GET/PATCH /v1/account/me). Kept on the device so
 * the auto-publish after Dopito works offline; `sharingDirty` marks a local
 * change the server has not confirmed yet. Null `nightAutopublish` means the
 * user has never chosen (the first publish asks).
 */
export interface SharingPrefs {
  shareDefault: NightVisibility;
  nightAutopublish: NightAutopublish | null;
  sharingDirty: boolean;
}

export const DEFAULT_SHARING_PREFS: SharingPrefs = {
  shareDefault: 'friends',
  nightAutopublish: null,
  sharingDirty: false,
};

interface VycepState extends SharingPrefs {
  /** clientId → publication record for my nights. */
  published: Record<string, PublishedNightRecord>;

  markPublished: (clientId: string, visibility: NightVisibility) => void;
  markUnpublished: (clientId: string) => void;
  setSharing: (patch: Partial<SharingPrefs>) => void;
}

export const useVycepStore = create<VycepState>()(
  persist(
    (set) => ({
      published: {},
      ...DEFAULT_SHARING_PREFS,

      markPublished: (clientId, visibility) =>
        set((state) => ({
          published: {
            ...state.published,
            [clientId]: { clientId, visibility, publishedAt: new Date().toISOString() },
          },
        })),

      markUnpublished: (clientId) =>
        set((state) => {
          if (!state.published[clientId]) return state;
          const next = { ...state.published };
          delete next[clientId];
          return { published: next };
        }),

      setSharing: (patch) => set(patch),
    }),
    {
      name: 'na-pivo-vycep',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
