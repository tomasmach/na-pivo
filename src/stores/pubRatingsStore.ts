/**
 * Personal, private pub ratings — the "Stálo to za návrat?" memory.
 *
 * This is local-first and never leaves the device: the user marks a pub they
 * have been to with a thumbs up / down, an optional quick tag ("Sem se vrátit" /
 * "Nic moc" / "Dobrý tankový") and an optional free-text note in their own
 * words. It is NOT a public review, not aggregated, and not synced to the
 * backend — it is just the user's own memory of whether a place was worth
 * coming back to.
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
  /** Thumbs up / down. Optional so a user can leave only a tag or a note. */
  verdict?: PubVerdict;
  /** A quick preset tag — one of `cs.myBeers.notePresets`, mutually exclusive. */
  tag?: string;
  /** A free-text note in the user's own words. */
  note?: string;
  /** ISO-8601 timestamp of the last change. */
  updatedAt: string;
}

/** What a single edit can change. */
export interface PubRatingInput {
  verdict?: PubVerdict;
  tag?: string;
  note?: string;
}

interface PubRatingsState {
  /** Ratings keyed by pubKey (geohash-8 cell). */
  ratings: Record<string, PubRating>;
  /**
   * Merge a change into a pub's rating. Passing a field clears it when the value
   * is null/undefined/blank. When the resulting rating is empty (no verdict, tag
   * or note) the entry is removed entirely, so an "undone" rating leaves no
   * trace.
   */
  setRating: (pubKey: string, input: PubRatingInput) => void;
  /** Remove a pub's rating completely. */
  clearRating: (pubKey: string) => void;
}

/** Trim a note to something worth keeping, or `undefined` when it is blank. */
function cleanText(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** True when a rating carries any signal worth persisting. */
function hasSignal(rating: Pick<PubRating, 'verdict' | 'tag' | 'note'>): boolean {
  return rating.verdict != null || !!cleanText(rating.tag) || !!cleanText(rating.note);
}

/**
 * The legacy preset tags. Before tag/note were split, the single `note` field
 * held one of these strings, so on migration a `note` matching one of them
 * becomes a `tag`; anything else is kept as a free-text `note`.
 */
const LEGACY_PRESET_TAGS = ['Sem se vrátit', 'Nic moc', 'Dobrý tankový'];

/**
 * Migrate persisted ratings to the current shape. v0 stored a single `note`
 * field that doubled as the tag; v1 splits it into `tag` + `note`. Exported so
 * the migration is unit-testable in isolation.
 */
export function migratePubRatings(persisted: unknown, version: number): PubRatingsState {
  const base = (persisted ?? {}) as Partial<PubRatingsState>;
  if (version >= 1) return base as PubRatingsState;

  const legacy = (base.ratings ?? {}) as Record<string, Partial<PubRating>>;
  const ratings: Record<string, PubRating> = {};
  for (const [pubKey, raw] of Object.entries(legacy)) {
    if (!raw || typeof raw !== 'object') continue;
    const next: PubRating = {
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    };
    if (raw.verdict === 'like' || raw.verdict === 'dislike') next.verdict = raw.verdict;
    const legacyNote = cleanText(typeof raw.note === 'string' ? raw.note : undefined);
    if (legacyNote) {
      if (LEGACY_PRESET_TAGS.includes(legacyNote)) next.tag = legacyNote;
      else next.note = legacyNote;
    }
    if (hasSignal(next)) ratings[pubKey] = next;
  }
  return { ...(base as PubRatingsState), ratings };
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
            tag: 'tag' in input ? input.tag : prev?.tag,
            note: 'note' in input ? input.note : prev?.note,
            updatedAt: new Date().toISOString(),
          };
          if (merged.verdict == null) delete merged.verdict;
          merged.tag = cleanText(merged.tag);
          merged.note = cleanText(merged.note);
          if (merged.tag == null) delete merged.tag;
          if (merged.note == null) delete merged.note;

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
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ ratings: state.ratings }),
      migrate: migratePubRatings,
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
