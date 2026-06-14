/**
 * Personal, private pub ratings — the "Stálo to za návrat?" memory.
 *
 * This is local-first and never leaves the device: the user marks a pub they
 * have been to with a thumbs up / down and an optional short note ("Sem se
 * vrátit" / "Nic moc" / "Dobrý tankový"). It is NOT a public review, not
 * aggregated, and not synced to the backend — it is just the user's own memory
 * of whether a place was worth coming back to.
 *
 * Ratings are keyed by `pubKey` (the geohash-8 cell), the exact same durable
 * place key the tally store uses for a session, so a rating made here lines up
 * with every evening at that pub.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** The personal verdict on a pub. */
export type PubVerdict = 'like' | 'dislike';

/** A single private rating of one pub. */
export interface PubRating {
  /** Thumbs up / down. Optional so a user can leave only a note. */
  verdict?: PubVerdict;
  /** A short free-standing note, in practice one of the preset tags. */
  note?: string;
  /** ISO-8601 timestamp of the last change. */
  updatedAt: string;
}

/** What a single edit can change. */
export interface PubRatingInput {
  verdict?: PubVerdict;
  note?: string;
}

interface PubRatingsState {
  /** Ratings keyed by pubKey (geohash-8 cell). */
  ratings: Record<string, PubRating>;
  /**
   * Merge a change into a pub's rating. Passing a field clears it when the value
   * is null/undefined. When the resulting rating is empty (no verdict and no
   * note) the entry is removed entirely, so an "undone" rating leaves no trace.
   */
  setRating: (pubKey: string, input: PubRatingInput) => void;
  /** Remove a pub's rating completely. */
  clearRating: (pubKey: string) => void;
}

/** True when a rating carries any signal worth persisting. */
function hasSignal(rating: { verdict?: PubVerdict; note?: string }): boolean {
  return rating.verdict != null || (rating.note != null && rating.note !== '');
}

export const usePubRatingsStore = create<PubRatingsState>()(
  persist(
    (set) => ({
      ratings: {},

      setRating: (pubKey, input) =>
        set((state) => {
          const prev = state.ratings[pubKey];
          // Merge only the fields present in `input`; absent fields are kept.
          const merged: PubRating = {
            verdict: 'verdict' in input ? input.verdict : prev?.verdict,
            note: 'note' in input ? input.note : prev?.note,
            updatedAt: new Date().toISOString(),
          };
          if (merged.verdict == null) delete merged.verdict;
          if (merged.note == null || merged.note === '') delete merged.note;

          if (!hasSignal(merged)) {
            // Nothing left to remember → drop the entry.
            if (!prev) return state;
            const next = { ...state.ratings };
            delete next[pubKey];
            return { ratings: next };
          }

          return { ratings: { ...state.ratings, [pubKey]: merged } };
        }),

      clearRating: (pubKey) =>
        set((state) => {
          if (!state.ratings[pubKey]) return state;
          const next = { ...state.ratings };
          delete next[pubKey];
          return { ratings: next };
        }),
    }),
    {
      name: 'na-pivo-pub-ratings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ ratings: state.ratings }),
    },
  ),
);

/** Read a pub's rating (undefined when unrated). Stable selector for `useStore`. */
export function selectPubRating(pubKey: string) {
  return (state: PubRatingsState): PubRating | undefined => state.ratings[pubKey];
}

/** Read a pub's rating off the current snapshot (non-reactive). */
export function getPubRating(pubKey: string): PubRating | undefined {
  return usePubRatingsStore.getState().ratings[pubKey];
}
