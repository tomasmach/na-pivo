/**
 * Local beer-counting tally ("Počítadlo").
 *
 * The user counts beers while sitting at a pub: each count records WHICH beer
 * and its PRICE. The running session lives here (persisted) so the count and
 * total survive an app restart mid-session, and finished sessions are archived
 * to a capped history.
 *
 * A "session" is one sitting at one pub on one drinking day. It rolls over —
 * archiving the current one and starting a fresh one — when EITHER:
 *   • the pub changes (different geohash-8 cell), OR
 *   • the drinking day changes. The drinking day uses a 04:00 local cutoff so a
 *     beer at 01:30 still belongs to the previous evening's session, not a new
 *     one. We implement this as "local time minus 4 hours, compared by calendar
 *     date" — purely on the device clock, no timezone library.
 *
 * This store is the source of truth for the LOCAL view. Delivery to the backend
 * + the community menu override are handled by the caller (drinksQueue +
 * communityStore), keyed by the same client_id / geohash-8 cell.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Hours to subtract from local time before taking the calendar date, so the
 *  "drinking day" rolls at 04:00 local rather than at midnight. */
const DAY_CUTOFF_HOURS = 4;
/** Keep at most this many finished sessions in history. */
const MAX_HISTORY = 50;

/** A single counted beer. `id` doubles as the drink's client_id (idempotency
 *  key) so the caller can dequeue / undo the exact same event. */
export interface TallyDrink {
  id: string;
  beerName: string;
  priceCzk: number;
  volumeMl?: number;
  /** ISO-8601 timestamp of when it was counted. */
  at: string;
}

/** One sitting at one pub on one drinking day. */
export interface TallySession {
  /** geohash-8 cell of the pub — the durable physical-place key. */
  pubKey: string;
  pubName: string;
  /** ISO-8601 timestamp of when the session started (first drink). */
  startedAt: string;
  drinks: TallyDrink[];
}

/** The minimal pub identity a count needs. */
export interface TallyPub {
  pubKey: string;
  pubName: string;
}

/** The beer being counted. */
export interface TallyBeerInput {
  id: string;
  beerName: string;
  priceCzk: number;
  volumeMl?: number;
  /** ISO timestamp; defaults to now. */
  at?: string;
}

interface TallyState {
  current: TallySession | null;
  history: TallySession[];
  /**
   * Count one beer at `pub`. Starts a new session when there is none, when the
   * pub changed, or when the drinking day rolled over (04:00 cutoff) — archiving
   * the previous session into history first.
   */
  addDrink: (pub: TallyPub, beer: TallyBeerInput) => void;
  /**
   * Remove the most recently counted drink from the current session and return
   * its id (so the caller can also remove the queued payload). Returns null when
   * there is nothing to undo. Empties the session object if it was the last
   * drink (the pub stays pinned by the UI, not by the store).
   */
  undoLast: () => string | null;
  /** Wipe the current session AND history (e.g. a "start over" affordance). */
  reset: () => void;
}

/** The drinking-day key for an instant: local date shifted back by the cutoff.
 *  Returns `YYYY-MM-DD` in device-local time. Exported for tests. */
export function drinkingDayKey(at: Date): string {
  const shifted = new Date(at.getTime() - DAY_CUTOFF_HOURS * 60 * 60 * 1000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True when a new drink at `at` belongs to a different session than `session`
 *  (different pub or a rolled-over drinking day). Exported for tests. */
export function shouldStartNewSession(
  session: TallySession | null,
  pubKey: string,
  at: Date,
): boolean {
  if (!session) return true;
  if (session.pubKey !== pubKey) return true;
  return drinkingDayKey(new Date(session.startedAt)) !== drinkingDayKey(at);
}

export const useTallyStore = create<TallyState>()(
  persist(
    (set) => ({
      current: null,
      history: [],

      addDrink: (pub, beer) =>
        set((state) => {
          const at = beer.at ?? new Date().toISOString();
          const atDate = new Date(at);
          const drink: TallyDrink = {
            id: beer.id,
            beerName: beer.beerName,
            priceCzk: beer.priceCzk,
            at,
          };
          if (typeof beer.volumeMl === 'number') drink.volumeMl = beer.volumeMl;

          const rollover = shouldStartNewSession(state.current, pub.pubKey, atDate);

          if (rollover) {
            // Archive a non-empty current session before opening a fresh one.
            const history =
              state.current && state.current.drinks.length > 0
                ? [state.current, ...state.history].slice(0, MAX_HISTORY)
                : state.history;
            return {
              current: {
                pubKey: pub.pubKey,
                pubName: pub.pubName,
                startedAt: at,
                drinks: [drink],
              },
              history,
            };
          }

          // Same session → append. Refresh the pub name in case it was edited.
          return {
            current: {
              ...(state.current as TallySession),
              pubName: pub.pubName,
              drinks: [...(state.current as TallySession).drinks, drink],
            },
          };
        }),

      undoLast: () => {
        let removedId: string | null = null;
        set((state) => {
          if (!state.current || state.current.drinks.length === 0) return state;
          const drinks = state.current.drinks.slice();
          const removed = drinks.pop();
          removedId = removed?.id ?? null;
          return { current: { ...state.current, drinks } };
        });
        return removedId;
      },

      reset: () => set({ current: null, history: [] }),
    }),
    {
      name: 'na-pivo-tally',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ current: state.current, history: state.history }),
    },
  ),
);

/** Number of beers counted in the current session. */
export function sessionCount(session: TallySession | null): number {
  return session?.drinks.length ?? 0;
}

/** Total spent (CZK) in the current session. */
export function sessionTotalCzk(session: TallySession | null): number {
  return session?.drinks.reduce((sum, d) => sum + d.priceCzk, 0) ?? 0;
}

/** Per-beer counts in the current session, keyed by normalized name + volume —
 *  used to show a "×3" badge on each menu card. Key shape: `name|volume`. */
export function sessionBeerCounts(session: TallySession | null): Map<string, number> {
  const counts = new Map<string, number>();
  if (!session) return counts;
  for (const drink of session.drinks) {
    const key = `${drink.beerName.trim().toLowerCase()}|${drink.volumeMl ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
