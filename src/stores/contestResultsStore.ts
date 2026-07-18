/**
 * FotoPivař round-results store.
 *
 * Decides whether the one-time results celebration should pop for the top 3
 * of the last closed round, and lets teaser surfaces know whether the user
 * has already seen those results. The only persisted value is
 * `lastSeenResultsContestId` — everything else is per-session.
 *
 * Flow: every successful contest snapshot fetch (root gate, Parta teaser or
 * the contest screen) calls `ingestSnapshot`. When the snapshot carries a
 * NEW closed round and my rank is 1–3, a `pendingResult` is queued; the
 * celebration modal shows it once and `dismissResult` advances the baseline.
 * Non-podium users never get a modal — for them the contest screen's podium
 * is the reveal, so `markResultsSeen` (called on a successful screen load)
 * advances the baseline instead and the teaser stops nudging.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PhotoContestSnapshot } from '@/data/photoContestClient';

export interface PendingContestResult {
  contestId: string;
  /** 1–3; only podium ranks queue a celebration. */
  rank: number;
  votes: number;
  xpAwarded: number;
  winsCount: number;
  /** My winning photo, when the winners list still carries it. */
  imageUrl: string | null;
}

interface ContestResultsState {
  /** Last closed round the user has already seen results for. Persisted. */
  lastSeenResultsContestId: string | null;
  /** Celebration waiting to be shown, or null. In-memory. */
  pendingResult: PendingContestResult | null;

  ingestSnapshot: (snapshot: PhotoContestSnapshot) => Promise<void>;
  markResultsSeen: (contestId: string) => void;
  dismissResult: () => void;
}

export const useContestResultsStore = create<ContestResultsState>()(
  persist(
    (set, get) => ({
      lastSeenResultsContestId: null,
      pendingResult: null,

      ingestSnapshot: async (snapshot) => {
        const last = snapshot.lastResults;
        const contestId = last?.contest.id;
        if (!last || !contestId) return;
        // The persisted baseline loads async; read it only after rehydration,
        // or a fast first fetch could re-queue an already-seen celebration.
        await useContestResultsStore.persist.rehydrate();
        if (contestId === get().lastSeenResultsContestId) return;
        if (get().pendingResult?.contestId === contestId) return;

        const rank = last.myResult?.rank ?? null;
        if (rank == null || rank > 3) return;

        const mine = last.winners.find((w) => w.rank === rank) ?? null;
        set({
          pendingResult: {
            contestId,
            rank,
            votes: last.myResult?.votes ?? mine?.votes ?? 0,
            xpAwarded: last.myResult?.xpAwarded ?? 0,
            winsCount: last.myResult?.winsCount ?? 0,
            imageUrl: mine?.imageUrl || null,
          },
        });
      },

      markResultsSeen: (contestId) => {
        // A queued celebration owns the baseline — its dismissal advances it.
        if (get().pendingResult?.contestId === contestId) return;
        if (get().lastSeenResultsContestId === contestId) return;
        set({ lastSeenResultsContestId: contestId });
      },

      dismissResult: () => {
        const pending = get().pendingResult;
        set({
          pendingResult: null,
          lastSeenResultsContestId: pending?.contestId ?? get().lastSeenResultsContestId,
        });
      },
    }),
    {
      name: 'na-pivo-contest-results',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ lastSeenResultsContestId: state.lastSeenResultsContestId }),
    },
  ),
);
