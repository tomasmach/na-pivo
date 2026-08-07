/**
 * Ephemeral UI state for the running night.
 *
 * The beers and the people are GONE from here. They live where they belong: the
 * counter's own session and the shared evening, read back through
 * `src/party/nightRecord.ts`. What stays is the bookkeeping around them —
 * whether a night is open, which pub it is at, what "+1" pours, and the local
 * copy of an opened game. Members, drinks, visits, photos and shared game
 * results all come from their real stores or the private party record.
 *
 * The clock is REAL, and the night is a stopwatch.
 *
 * It used to be a counter of minutes that only moved when you did something —
 * deterministic, and dead. An evening that does not tick is not running, and the
 * whole point of the hub is that something is happening while you sit there.
 *
 * Each beer is a LAP. `startedAt` is the stopwatch; every beer stamps the moment
 * it was poured, so the gap between two of them is that lap's time and the gap
 * since the last one is the lap in progress. Everything else — the tempo chart,
 * "na jedno", the pulse — is a reading of those stamps.
 *
 * Beers are a LIST, not a tally. A number cannot say what you drank or when,
 * and the timeline, the per-type counters and the tempo chart are all just
 * different readings of the same list.
 *
 * Deliberately small. This local chrome is persisted for at most one day so an
 * offline table survives a process kill; the authenticated evening API remains
 * the canonical source and resumes it when a connection is available.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { generateUuidV4 } from '@/data/account';
import AsyncStorage from '@/data/privateAccountStorage';
import { guardPrivateAccountStateCreator } from '@/data/privateAccountBoundary';

export interface GameResult {
  game: string;
  /**
   * Null for a game scored in sips.
   *
   * A drinking game has no winner, and inventing one would mean crowning
   * whoever drank most — the one scoreboard this product must not keep. What it
   * leaves behind is the round, not a ranking.
   */
  winner: string | null;
  scores: { name: string; score: number }[];
  /**
   * Who ended up buying, when the game was about that.
   *
   * Separate from `winner` because it is a different fact: the winner is who
   * played best, the payer is who is at the bar. In Kostky they are never the
   * same person, and the payer is the line worth leading with.
   */
  paying?: string | null;
}

/** A game someone put on the table. It exists in the hub BEFORE it has a
 *  result — that is the point of inserting a game: the table agrees to play it,
 *  then plays it. */
export interface GameEntry {
  key: string;
  name: string;
  /** Minute of the evening it was put on the table. */
  at: number;
  result?: GameResult;
}

export interface PartyTap {
  name: string;
  priceCzk: number | null;
}

/** One explicit stop in the running crawl. Its id is also PubVisit.client_id
 * and, once the first drink arrives, TallySession.clientId. One identity keeps
 * the immediate move event and the later diary session from becoming two
 * visits on the backend. */
export interface PartyPubVisit {
  clientId: string;
  pubKey: string;
  pubName: string;
  pubCity?: string;
  pubExternalId?: string;
  startedAt: string;
  endedAt?: string;
}

export interface PartyPubTransition {
  previous?: PartyPubVisit;
  current: PartyPubVisit;
}

export function partyTapOptions(...groups: PartyTap[][]): PartyTap[] {
  const taps = new Map<string, PartyTap>();
  for (const tap of groups.flat()) {
    const name = tap.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('cs-CZ');
    const previous = taps.get(key);
    taps.set(key, {
      name: previous?.name ?? name,
      priceCzk: previous?.priceCzk ?? tap.priceCzk,
    });
  }
  return [...taps.values()];
}

interface LivePartyState {
  live: boolean;
  pubName: string;
  /**
   * The hub sent you to Hospody to choose a place.
   *
   * A flag rather than a route param because the trip is a round trip through a
   * tab: hub → Hospody → a pub detail → back to the hub. The detail only knows
   * to offer "Vybrat" because this is set.
   */
  pickingPub: boolean;
  /** What "+1 pivo" pours without asking — the pub's own tap. */
  houseBeer: string;
  /** The selected pub's current server/community tap menu. */
  pubTaps: PartyTap[];
  /**
   * The pub's IDENTITY, not just its name — geohash-8, the same key the counter
   * and the diary use. Null until a pub has been picked, and a beer logged
   * without one is filed as an evening outside a pub rather than at a guess.
   */
  pubKey: string | null;
  /** Explicit pub stops, including a selected pub where no beer was ordered. */
  pubVisits: PartyPubVisit[];
  /** Epoch ms of the first beer — the stopwatch's zero. Null until it starts. */
  startedAt: number | null;
  games: GameEntry[];

  start: (
    pubName: string,
    beer: string,
    pubKey?: string | null,
    pubTaps?: PartyTap[],
    pubCity?: string,
    pubExternalId?: string,
  ) => PartyPubTransition | null;
  /** Rebuild ephemeral chrome from the server after a process restart. */
  resume: (pubName: string, startedAt: string) => void;
  /** Set where you are — before a night, or when you move mid-evening. */
  setPub: (
    pubName: string,
    beer: string,
    pubKey?: string | null,
    pubTaps?: PartyTap[],
    pubCity?: string,
    pubExternalId?: string,
  ) => PartyPubTransition | null;
  /** Follow a stop another phone published without creating a visit for me. */
  adoptSharedPub: (pubName: string, pubKey?: string | null) => void;
  beginPickingPub: () => void;
  endPickingPub: () => void;
  addGame: (key: string, name: string) => void;
  finishGame: (key: string, result: GameResult) => void;
  end: () => void;
}

const EMPTY = {
  live: false,
  pubName: '',
  houseBeer: 'Pivo',
  pubTaps: [] as PartyTap[],
  pubKey: null as string | null,
  pickingPub: false,
  startedAt: null as number | null,
  pubVisits: [] as PartyPubVisit[],
  games: [] as GameEntry[],
};

const LIVE_PARTY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function mergePersistedState(
  persisted: unknown,
  current: LivePartyState,
  now = Date.now(),
): LivePartyState {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return current;
  const saved = persisted as Partial<LivePartyState>;
  const startedAt = typeof saved.startedAt === 'number' && Number.isFinite(saved.startedAt)
    ? saved.startedAt
    : null;
  if (startedAt === null || now - startedAt > LIVE_PARTY_MAX_AGE_MS || now < startedAt) {
    return current;
  }

  const games = Array.isArray(saved.games)
    ? saved.games.filter((game): game is GameEntry =>
        !!game &&
        typeof game === 'object' &&
        typeof game.key === 'string' &&
        typeof game.name === 'string' &&
        typeof game.at === 'number' &&
        Number.isFinite(game.at),
      )
    : [];
  const pubTaps = Array.isArray(saved.pubTaps)
    ? saved.pubTaps.filter((tap): tap is PartyTap =>
        !!tap &&
        typeof tap === 'object' &&
        typeof tap.name === 'string' &&
        (tap.priceCzk === null ||
          (typeof tap.priceCzk === 'number' && Number.isFinite(tap.priceCzk))),
      )
    : [];
  const pubVisits = Array.isArray(saved.pubVisits)
    ? saved.pubVisits
        .filter((visit): visit is PartyPubVisit =>
          !!visit &&
          typeof visit === 'object' &&
          typeof visit.clientId === 'string' &&
          typeof visit.pubKey === 'string' &&
          typeof visit.pubName === 'string' &&
          typeof visit.startedAt === 'string' &&
          Number.isFinite(Date.parse(visit.startedAt)) &&
          (visit.endedAt === undefined ||
            (typeof visit.endedAt === 'string' && Number.isFinite(Date.parse(visit.endedAt)))),
        )
        .slice(-25)
    : [];

  return {
    ...current,
    live: saved.live === true,
    pubName: typeof saved.pubName === 'string' ? saved.pubName : '',
    pickingPub: false,
    houseBeer: typeof saved.houseBeer === 'string' ? saved.houseBeer : 'Pivo',
    pubTaps,
    pubKey: typeof saved.pubKey === 'string' ? saved.pubKey : null,
    startedAt,
    pubVisits,
    games,
  };
}

/** Exported only as a pure persistence-boundary regression seam. */
export const restoreLivePartyState = mergePersistedState;

export const useLivePartyStore = create<LivePartyState>()(
  persist(
    guardPrivateAccountStateCreator((set, get) => ({
      ...EMPTY,

      /**
       * Open the night.
       *
       * No beers here any more: the first one is logged through the counter's own
       * path like every other beer (`src/party/logBeer.ts`), and read back out of
       * the night record. This only opens the evening and says where it is.
       */
      start: (pubName, beer, pubKey, pubTaps, pubCity, pubExternalId) => {
        const startedAtIso = new Date().toISOString();
        const current = pubKey
          ? {
              clientId: generateUuidV4(),
              pubKey,
              pubName,
              ...(pubCity ? { pubCity } : {}),
              ...(pubExternalId ? { pubExternalId } : {}),
              startedAt: startedAtIso,
            }
          : null;
        set({
          live: true,
          pubName,
          houseBeer: beer,
          pubTaps: pubTaps ?? [{ name: beer, priceCzk: null }],
          ...(pubKey !== undefined ? { pubKey } : {}),
          startedAt: Date.parse(startedAtIso),
          pubVisits: current ? [current] : [],
          games: [],
        });
        return current ? { current } : null;
      },

      resume: (pubName, startedAt) =>
        set((state) => ({
          live: true,
          pubName: pubName || state.pubName || 'Mimo hospodu',
          startedAt: Number.isFinite(Date.parse(startedAt)) ? Date.parse(startedAt) : Date.now(),
        })),

      setPub: (pubName, beer, pubKey, pubTaps, pubCity, pubExternalId) => {
        const state = get();
        const previous = state.pubVisits.at(-1);
        const changedStop =
          state.live && !!pubKey && (!previous || previous.pubKey !== pubKey);
        const movedAt = new Date().toISOString();
        const closedPrevious = changedStop && previous && !previous.endedAt
          ? { ...previous, endedAt: movedAt }
          : undefined;
        const current = changedStop
          ? {
              clientId: generateUuidV4(),
              pubKey,
              pubName,
              ...(pubCity ? { pubCity } : {}),
              ...(pubExternalId ? { pubExternalId } : {}),
              startedAt: movedAt,
            }
          : null;
        const pubVisits = changedStop && current
          ? [
              ...state.pubVisits.slice(0, -1),
              ...(closedPrevious ? [closedPrevious] : previous ? [previous] : []),
              current,
            ].slice(-25)
          : state.pubVisits;
        set({
          pubName,
          houseBeer: beer,
          pubTaps: pubTaps ?? [{ name: beer, priceCzk: null }],
          ...(pubKey !== undefined ? { pubKey } : {}),
          pubVisits,
        });
        return current ? { ...(closedPrevious ? { previous: closedPrevious } : {}), current } : null;
      },

      adoptSharedPub: (pubName, pubKey) =>
        set({ pubName, ...(pubKey !== undefined ? { pubKey } : {}) }),

      beginPickingPub: () => set({ pickingPub: true }),
      endPickingPub: () => set({ pickingPub: false }),

      addGame: (key, name) =>
        set((state) =>
          state.games.some((game) => game.key === key)
            ? state
            : { games: [...state.games, { key, name, at: Date.now() }] },
        ),

      // No second log entry when it ends: the game's own row grows a scoreboard.
      // Two rows for one game read as two games.
      finishGame: (key, result) =>
        set((state) => ({
          games: state.games.map((game) => (game.key === key ? { ...game, result } : game)),
        })),

      end: () => set({ ...EMPTY }),
    })),
    {
      name: 'na-pivo-live-party',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        live: state.live,
        pubName: state.pubName,
        pickingPub: false,
        houseBeer: state.houseBeer,
        pubTaps: state.pubTaps,
        pubKey: state.pubKey,
        startedAt: state.startedAt,
        pubVisits: state.pubVisits,
        games: state.games,
      }),
      // An undelivered table can survive a process kill, not become a zombie
      // days later. Real online tables are independently restored by the API.
      merge: mergePersistedState,
    },
  ),
);

/** "1h 12m" / "48m". Shared, so the bar, the hub and the recap agree. */
export function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * "12:04" / "1:12:04" — a stopwatch face, with seconds.
 *
 * Seconds are the whole point: a number that only changes once a minute looks
 * frozen, and the hub is meant to feel like something is running. Everything
 * else stays in whole minutes; this is the one reading that ticks.
 */
export function formatStopwatch(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * The stopwatch face, ticking every second.
 *
 * Deliberately separate from `useNightClock`: this one re-renders 60× a minute,
 * so it is used ONLY by the small component that draws the clock. Putting it on
 * the hub would re-render the SwiftUI chart every second for a digit.
 */
export function useNightSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return undefined;
    // No synchronous setState here — the first tick lands a second later, which
    // is invisible, and calling it in the effect body is the cascading-render
    // trap (`react-hooks/set-state-in-effect`).
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** Whole minutes between two stamps — the unit every reading works in. */
export function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 60_000));
}

/** "20:15" — a wall clock time from an epoch stamp. */
export function clockAt(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The stopwatch, ticking.
 *
 * Re-renders once a minute, not once a second: everything on screen is written
 * in whole minutes, so a per-second tick would be sixty renders for one visible
 * change. Aligned to the next minute boundary so the number flips when the
 * clock does.
 */
export function useNightClock(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return undefined;
    const tick = () => setNow(Date.now());
    tick();
    const toBoundary = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, toBoundary);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [startedAt]);

  return startedAt === null ? 0 : minutesBetween(startedAt, now);
}
