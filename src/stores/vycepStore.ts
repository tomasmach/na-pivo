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
import AsyncStorage from '@/data/privateAccountStorage';
import { guardPrivateAccountStateCreator } from '@/data/privateAccountBoundary';

import type { NightVisibility } from '@/data/nightsClient';

export interface PublishedNightRecord {
  clientId: string;
  visibility: NightVisibility;
  /** ISO timestamp of the last publish/update from this device. */
  publishedAt: string;
}

interface VycepState {
  /** clientId → publication record for my nights. */
  published: Record<string, PublishedNightRecord>;

  markPublished: (clientId: string, visibility: NightVisibility) => void;
  markUnpublished: (clientId: string) => void;
}

export const useVycepStore = create<VycepState>()(
  persist(
    guardPrivateAccountStateCreator((set) => ({
      published: {},

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
    })),
    {
      name: 'na-pivo-vycep',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
