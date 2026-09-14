/**
 * FotoPivař round-results store.
 *
 * Decides whether the one-time results celebration should pop for the top 3
 * of the last closed round, and lets teaser surfaces know whether the user
 * has already seen those results. The persisted baseline is tagged with its
 * account id; everything else is per-session. An account switch therefore
 * cannot suppress or surface another person's result.
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
import AsyncStorage, {
  privateAccountCleanupStorage,
  suppressPrivatePersistenceDuringMemoryReset,
} from '@/data/privateAccountStorage';
import { guardPrivateAccountStateCreator } from '@/data/privateAccountBoundary';

import type { PhotoContestSnapshot } from '@/data/photoContestClient';

export const CONTEST_RESULTS_STORAGE_KEY = 'na-pivo-contest-results';

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
  /** Account that owns both the seen baseline and any pending result. */
  viewerAccountId: string | null;
  /** Last closed round the user has already seen results for. Persisted. */
  lastSeenResultsContestId: string | null;
  /** Celebration waiting to be shown, or null. In-memory. */
  pendingResult: PendingContestResult | null;

  ingestSnapshot: (snapshot: PhotoContestSnapshot) => Promise<void>;
  markResultsSeen: (contestId: string) => void;
  dismissResult: () => void;
}

let ingestGeneration = 0;
let accountClearsInProgress = 0;
const pendingPersistenceWrites = new Set<Promise<void>>();

const contestResultsStorage: typeof AsyncStorage = {
  ...AsyncStorage,
  setItem: (key, value) => {
    const write = AsyncStorage.setItem(key, value);
    pendingPersistenceWrites.add(write);
    void write.then(
      () => pendingPersistenceWrites.delete(write),
      () => pendingPersistenceWrites.delete(write),
    );
    return write;
  },
};

async function waitForPendingPersistenceWrites(): Promise<void> {
  while (pendingPersistenceWrites.size > 0) {
    await Promise.allSettled([...pendingPersistenceWrites]);
  }
}

export const useContestResultsStore = create<ContestResultsState>()(
  persist(
    guardPrivateAccountStateCreator((set, get) => ({
      viewerAccountId: null,
      lastSeenResultsContestId: null,
      pendingResult: null,

      ingestSnapshot: async (snapshot) => {
        if (accountClearsInProgress > 0) return;
        const generation = ++ingestGeneration;
        // The persisted baseline loads async; read it only after rehydration,
        // or a fast first fetch could re-queue an already-seen celebration.
        await useContestResultsStore.persist.rehydrate();
        if (accountClearsInProgress > 0 || generation !== ingestGeneration) return;
        if (get().viewerAccountId !== snapshot.viewerAccountId) {
          set({
            viewerAccountId: snapshot.viewerAccountId,
            lastSeenResultsContestId: null,
            pendingResult: null,
          });
        }
        const last = snapshot.lastResults;
        const contestId = last?.contest.id;
        if (!last || !contestId) return;
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
        if (accountClearsInProgress > 0) return;
        // A queued celebration owns the baseline — its dismissal advances it.
        if (get().pendingResult?.contestId === contestId) return;
        if (get().lastSeenResultsContestId === contestId) return;
        set({ lastSeenResultsContestId: contestId });
      },

      dismissResult: () => {
        if (accountClearsInProgress > 0) return;
        const pending = get().pendingResult;
        set({
          pendingResult: null,
          lastSeenResultsContestId: pending?.contestId ?? get().lastSeenResultsContestId,
        });
      },
    })),
    {
      name: CONTEST_RESULTS_STORAGE_KEY,
      storage: createJSONStorage(() => contestResultsStorage),
      partialize: (state) => ({
        viewerAccountId: state.viewerAccountId,
        lastSeenResultsContestId: state.lastSeenResultsContestId,
      }),
    },
  ),
);

/** Clear both in-memory and persisted personalized results at an account boundary. */
export async function clearContestResultsAccountData(): Promise<void> {
  accountClearsInProgress += 1;
  ingestGeneration += 1;
  try {
    suppressPrivatePersistenceDuringMemoryReset(() => {
      useContestResultsStore.setState({
        viewerAccountId: null,
        lastSeenResultsContestId: null,
        pendingResult: null,
      });
    });
    // Zustand actions intentionally expose a synchronous API, so their
    // persistence promises are fire-and-forget. Let every older write settle
    // before deleting the key or it could recreate the outgoing account's
    // payload after logout.
    await waitForPendingPersistenceWrites();
    try {
      await privateAccountCleanupStorage.removeItem(CONTEST_RESULTS_STORAGE_KEY);
    } catch {
      // Account cleanup continues; the tagged payload still cannot apply to another account.
    }
  } finally {
    accountClearsInProgress = Math.max(0, accountClearsInProgress - 1);
  }
}
