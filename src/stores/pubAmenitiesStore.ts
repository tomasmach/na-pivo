/**
 * "Zmapuj hospodu" — the user's own community amenity votes.
 *
 * This holds ONLY the user's own votes (pending + already-synced), keyed
 * pubKey → amenityKey → entry. It does NOT hold the public aggregate (that rides
 * on the Pub type / a dedicated snapshot): the two are kept in physically separate
 * stores so a stale aggregate snapshot can never clobber a fresh local tap.
 *
 * Unlike a PubRating (one scalar) an amenity report is a MAP of up to 16
 * independent facts, so the merge unit is the INDIVIDUAL amenity vote: `updatedAt`
 * is stored per amenity, and both this store and the server upsert do
 * per-(pubKey, amenityKey) last-write-wins. A stale push of one amenity must NEVER
 * clobber a sibling vote. This is the critical divergence from the ratings
 * "replace the whole object" model (spec §4.1).
 *
 * value semantics: a vote is 'yes' or 'no' only — never 'unknown' on the store or
 * the wire. Unknown = the absence of an answer (the key is simply not present). To
 * retract a vote, setVote(..., null) deletes the entry (and the sync layer sends a
 * value:null tombstone). Absent never means "clear".
 *
 * A synced vote STAYS in the store (unlike a drink, which is a done event) — it is
 * durable state the user owns: it survives reinstall, re-renders as "tvoje
 * odpověď: ano", and lets LWW resolve cross-device edits, exactly like PubRating.
 *
 * Like pubRatings, votes are keyed by `pubKey` (the geohash-8 cell). PUSH/PULL sync
 * lives entirely outside this store in pubAmenitiesSync.ts (a module-level suppress
 * flag stops a pull from echoing straight back out as a push).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@/data/privateAccountStorage';
import { guardPrivateAccountStateCreator } from '@/data/privateAccountBoundary';

import { isKnownAmenityKey, type AmenityKey } from '@/data/amenities';

/** A community amenity vote — never 'unknown' on the store/wire. */
export type AmenityVote = 'yes' | 'no';

/** A single vote on one amenity at one pub. */
export interface AmenityVoteEntry {
  vote: AmenityVote;
  /** ISO-8601 timestamp of the last change — the per-key LWW key. */
  updatedAt: string;
}

/** All of one pub's votes, keyed by amenity. */
export type PubAmenityVotes = Partial<Record<AmenityKey, AmenityVoteEntry>>;

/**
 * One row of a hydrate batch.
 *   - `entry: AmenityVoteEntry` → upsert if strictly newer (LWW).
 *   - `entry: { tombstone: true; updatedAt }` → retraction; deletes the local entry
 *     ONLY when its timestamp wins LWW (strictly newer than the local copy).
 *   - `entry: null` → an UNTIMED retraction: removes the local entry if present,
 *     bypassing LWW. Safe only for callers that pre-filter (e.g. restore's
 *     pending-delete skip set); a timestamped tombstone is preferred for any
 *     server-driven PULL so a newer local edit is not silently destroyed.
 */
export interface HydrateAmenityTombstone {
  tombstone: true;
  /** ISO-8601 — the retraction's LWW key. */
  updatedAt: string;
}
export interface HydrateAmenityRow {
  pubKey: string;
  amenityKey: AmenityKey;
  entry: AmenityVoteEntry | HydrateAmenityTombstone | null;
}

interface PubAmenitiesState {
  /** Votes keyed by pubKey (geohash-8 cell) then by amenityKey. */
  votes: Record<string, PubAmenityVotes>;
  /**
   * Set or retract one vote. 'yes'|'no' → upsert with a fresh updatedAt; null →
   * retract (delete the entry, prune the pub when it becomes empty). Other
   * amenities at the same pub are untouched.
   */
  setVote: (pubKey: string, amenityKey: AmenityKey, vote: AmenityVote | null) => void;
  /** Remove all of a pub's votes (undo-all / account wipe). */
  clearPub: (pubKey: string) => void;
  /**
   * Merge a batch of server votes (the PULL side). Per-(pubKey, amenityKey) LWW by
   * updatedAt: a row only overwrites the local entry when strictly newer. A
   * timestamped tombstone (`{ tombstone: true, updatedAt }`) removes the local
   * entry only when it wins LWW; an untimed `entry: null` removes it
   * unconditionally (caller must pre-filter — see HydrateAmenityRow). Local-only
   * votes are left untouched. Pure state merge — it does NOT enqueue anything;
   * pubAmenitiesSync runs it under the suppress flag.
   */
  hydrateVotes: (rows: HydrateAmenityRow[]) => void;
}

/** True when one entry's timestamp is strictly newer than another's. */
function isStrictlyNewer(candidate: string, existing: string | undefined): boolean {
  if (existing == null) return true;
  const candidateMs = Date.parse(candidate);
  const existingMs = Date.parse(existing);
  return Number.isFinite(candidateMs) && candidateMs > existingMs;
}

/**
 * Migrate persisted votes to the current shape. v1 ships a REAL migrate (not an
 * empty slot): it filters persisted votes through isKnownAmenityKey and prunes
 * empty pubs, so a future catalogue change has a defined, testable entry point and
 * unknown persisted keys can't crash rehydrate. Exported for unit testing.
 */
export function migratePubAmenities(persisted: unknown, _version: number): PubAmenitiesState {
  const base =
    persisted !== null && typeof persisted === 'object' && !Array.isArray(persisted)
      ? persisted as Partial<PubAmenitiesState>
      : {};
  const legacy =
    base.votes !== null && typeof base.votes === 'object' && !Array.isArray(base.votes)
      ? base.votes as Record<string, unknown>
      : {};
  const votes: Record<string, PubAmenityVotes> = {};

  for (const [pubKey, rawPub] of Object.entries(legacy)) {
    if (!pubKey || !rawPub || typeof rawPub !== 'object' || Array.isArray(rawPub)) continue;
    const pubVotes: PubAmenityVotes = {};
    for (const [amenityKey, rawEntry] of Object.entries(rawPub)) {
      if (!isKnownAmenityKey(amenityKey)) continue;
      const entry = rawEntry as Partial<AmenityVoteEntry>;
      if (
        entry &&
        (entry.vote === 'yes' || entry.vote === 'no') &&
        typeof entry.updatedAt === 'string' &&
        Number.isFinite(Date.parse(entry.updatedAt))
      ) {
        pubVotes[amenityKey] = { vote: entry.vote, updatedAt: entry.updatedAt };
      }
    }
    if (Object.keys(pubVotes).length > 0) votes[pubKey] = pubVotes;
  }

  return { votes } as PubAmenitiesState;
}

export const usePubAmenitiesStore = create<PubAmenitiesState>()(
  persist(
    guardPrivateAccountStateCreator((set) => ({
      votes: {},

      setVote: (pubKey, amenityKey, vote) =>
        set((state) => {
          const prevPub = state.votes[pubKey];

          if (vote == null) {
            // Retract: drop the entry, prune the pub when it becomes empty.
            if (!prevPub || !prevPub[amenityKey]) return state;
            const nextPub: PubAmenityVotes = { ...prevPub };
            delete nextPub[amenityKey];
            const next = { ...state.votes };
            if (Object.keys(nextPub).length === 0) delete next[pubKey];
            else next[pubKey] = nextPub;
            return { votes: next };
          }

          const entry: AmenityVoteEntry = { vote, updatedAt: new Date().toISOString() };
          return {
            votes: {
              ...state.votes,
              [pubKey]: { ...prevPub, [amenityKey]: entry },
            },
          };
        }),

      clearPub: (pubKey) =>
        set((state) => {
          if (!state.votes[pubKey]) return state;
          const next = { ...state.votes };
          delete next[pubKey];
          return { votes: next };
        }),

      hydrateVotes: (rows) =>
        set((state) => {
          let changed = false;
          const next = { ...state.votes };

          for (const { pubKey, amenityKey, entry } of rows) {
            if (!isKnownAmenityKey(amenityKey)) continue;
            const currentPub = next[pubKey];
            const local = currentPub?.[amenityKey];

            // Retraction. An untimed null removes unconditionally (caller
            // pre-filters); a timestamped tombstone removes only when it wins LWW
            // so a newer local edit is never silently destroyed.
            if (entry == null || 'tombstone' in entry) {
              if (!local) continue;
              const tombstoneAt = entry == null ? undefined : entry.updatedAt;
              if (tombstoneAt != null && !isStrictlyNewer(tombstoneAt, local.updatedAt)) continue;
              const nextPub: PubAmenityVotes = { ...currentPub };
              delete nextPub[amenityKey];
              if (Object.keys(nextPub).length === 0) delete next[pubKey];
              else next[pubKey] = nextPub;
              changed = true;
              continue;
            }

            // LWW: keep local unless the server copy is strictly newer.
            if (!isStrictlyNewer(entry.updatedAt, local?.updatedAt)) continue;
            next[pubKey] = { ...currentPub, [amenityKey]: entry };
            changed = true;
          }

          return changed ? { votes: next } : state;
        }),
    })),
    {
      name: 'na-pivo-pub-amenities',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ votes: state.votes }),
      migrate: migratePubAmenities,
      merge: (persisted, current) => ({
        ...current,
        ...migratePubAmenities(persisted, 1),
      }),
    },
  ),
);

/** Read all of a pub's votes (undefined when unvoted). Stable selector for useStore. */
export function selectPubVotes(pubKey: string) {
  return (state: PubAmenitiesState): PubAmenityVotes | undefined => state.votes[pubKey];
}
