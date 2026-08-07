/**
 * Persisted local shell around the running night.
 *
 * Beers live in the counter session and shared members come from the evening,
 * read back through `src/party/nightRecord.ts`. This store keeps the offline
 * shell around them: whether a night is open, its pub and clock, the latest
 * member snapshot, local game results and a small compatibility log. Photos
 * live in the persisted BeerPhoto store and are not duplicated here.
 *
 * The point of the outputs living here is the loop: the feed card can only lead
 * with a pub-quiz scoreboard or a photo strip if the party mode actually MAKES
 * one. Until now the card could render five kinds of highlight and the party
 * produced none of them.
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
 * Persisted because the local half is the offline source of truth while a night
 * is running. The shared evening still refreshes from the server, but losing the
 * stopwatch, selected pub or a locally finished game on restart would make the
 * core pub flow depend on signal.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  /** Epoch ms when it was put on the table. */
  at: number;
  result?: GameResult;
}

export interface PartyPersonLive {
  id: string;
  name: string;
  tint: string;
  beers: number;
  avatarUrl?: string | null;
}

/**
 * Exactly the five things the control row can do, and nothing else.
 *
 * A thread may only carry content the app can actually produce. A mocked "note"
 * and "round" looked good and promised two features that have no way in — the
 * log would have been advertising buttons that do not exist.
 */
export type LogKind = 'beer' | 'photo' | 'game' | 'join' | 'pub';

/**
 * One thing that happened, and WHO did it.
 *
 * The log is a thread, not a system journal: at a table of four, "Fotka" with no
 * name is the app talking to itself. Every entry carries its author, and a game
 * entry carries the key of the game so the row can start it.
 */
export interface LogEvent {
  id: string;
  at: number;
  kind: LogKind;
  text: string;
  /** Display name. "Ty" is you — the mock has no user ids. */
  by: string;
  /** Only on `game` rows: what the row launches. */
  gameKey?: string;
  /** Only on `beer` rows: which entry to correct when you tap it. */
  beerId?: string;
  /** Only on `photo` rows: the shot itself, so the thread shows it rather than
   *  reporting that it exists. */
  photo?: string;
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
  /**
   * The pub's IDENTITY, not just its name — geohash-8, the same key the counter
   * and the diary use. Null until a pub has been picked, and a beer logged
   * without one is filed as an evening outside a pub rather than at a guess.
   */
  pubKey: string | null;
  /** Epoch ms of the first beer — the stopwatch's zero. Null until it starts. */
  startedAt: number | null;
  people: PartyPersonLive[];
  photos: number;
  games: GameEntry[];
  log: LogEvent[];

  start: (pubName: string, beer: string, pubKey?: string | null) => void;
  /** Set where you are — before a night, or when you move mid-evening. */
  setPub: (pubName: string, beer: string, pubKey?: string | null) => void;
  beginPickingPub: () => void;
  endPickingPub: () => void;
  /** Take back anything else you put in the thread — a photo, a game. Only your
   *  own; the row menu is not offered on somebody else's entry. */
  dropEvent: (eventId: string) => void;
  /** Legacy thread hook. Real party photos live in beerPhotosStore. */
  addPhoto: (uri?: string) => void;
  addGame: (key: string, name: string) => void;
  finishGame: (key: string, result: GameResult) => void;
  invite: (name: string) => void;
  setPeople: (people: PartyPersonLive[]) => void;
  end: () => void;
}

/** The picker's own label. Lives here so no consumer stores it as a pub name. */
export const PUB_PICKER_CTA = 'Vyber hospodu';

/** What a night without a chosen pub is called, everywhere it has to be named. */
export const UNNAMED_PLACE = 'Mimo hospodu';

let seq = 0;
const nextId = (prefix: string) => {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
};

const EMPTY = {
  live: false,
  // Empty, not a CTA string: this name travels into drink rows, the recap title
  // and the published post, and "Večer v Vyber hospodu" is not a place.
  pubName: '',
  houseBeer: 'Pivo',
  pubKey: null as string | null,
  pickingPub: false,
  startedAt: null as number | null,
  people: [] as PartyPersonLive[],
  photos: 0,
  games: [] as GameEntry[],
  log: [] as LogEvent[],
};

/** Whoever is holding the phone. */
const ME = 'Ty';

function logged(
  state: { log: LogEvent[] },
  at: number,
  kind: LogKind,
  text: string,
  by: string = ME,
  extra?: { gameKey?: string; beerId?: string; photo?: string },
): LogEvent[] {
  return [...state.log, { id: nextId('ev'), at, kind, text, by, ...extra }];
}

export const useLivePartyStore = create<LivePartyState>()(
  persist(
    (set) => ({
      ...EMPTY,

      /**
       * Open the night.
       *
       * No beers here any more: the first one is logged through the counter's own
       * path like every other beer (`src/party/logBeer.ts`), and read back out of
       * the night record. This only opens the evening and says where it is.
       */
      start: (pubName, beer, pubKey) => {
        const now = Date.now();
        set({
          live: true,
          pubName,
          houseBeer: beer,
          ...(pubKey !== undefined ? { pubKey } : {}),
          startedAt: now,
          people: [],
          photos: 0,
          games: [],
          log: [],
        });
      },

      setPub: (pubName, beer, pubKey) =>
        set((s) =>
          s.live
            ? {
                pubName,
                houseBeer: beer,
                ...(pubKey !== undefined ? { pubKey } : {}),
                log: logged(s, Date.now(), 'pub', `Přesun do ${pubName}`),
              }
            : { pubName, houseBeer: beer, ...(pubKey !== undefined ? { pubKey } : {}) },
        ),

      beginPickingPub: () => set({ pickingPub: true }),
      endPickingPub: () => set({ pickingPub: false }),

      dropEvent: (eventId) =>
        set((s) => {
          const event = s.log.find((entry) => entry.id === eventId);
          if (!event) return s;
          return {
            log: s.log.filter((entry) => entry.id !== eventId),
            // Compatibility for old persisted rows. Real photos are removed
            // through the beer-photo store instead of this thread ledger.
            photos: event.kind === 'photo' ? Math.max(0, s.photos - 1) : s.photos,
            games: event.gameKey
              ? s.games.filter((game) => game.key !== event.gameKey)
              : s.games,
          };
        }),

      addPhoto: (uri) =>
        set((s) =>
          uri
            ? {
                photos: s.photos + 1,
                log: logged(s, Date.now(), 'photo', 'Fotka', ME, { photo: uri }),
              }
            : s,
        ),

      addGame: (key, name) =>
        set((s) =>
          s.games.some((game) => game.key === key)
            ? s
            : {
                games: [...s.games, { key, name, at: Date.now() }],
                // Carries the key: the thread row IS the game, and starting it
                // happens from where it was put on the table.
                log: logged(s, Date.now(), 'game', name, ME, { gameKey: key }),
              },
        ),

      // No second log entry when it ends: the game's own row grows a scoreboard.
      // Two rows for one game read as two games.
      finishGame: (key, result) =>
        set((s) => ({
          games: s.games.map((game) => (game.key === key ? { ...game, result } : game)),
        })),

      invite: (name) =>
        set((s) =>
          s.people.some((person) => person.name === name)
            ? s
            : {
                people: [
                  ...s.people,
                  { id: nextId('u'), name, tint: '#A8896A', beers: 0 },
                ],
                log: logged(s, Date.now(), 'join', 'Dorazil k stolu', name),
              },
        ),

      setPeople: (people) => set({ people }),

      // Keep the just-finished local outputs for its recap. Starting the next
      // night replaces them; the idle hub hides them in the meantime.
      end: () =>
        set((state) => ({
          ...EMPTY,
          startedAt: state.startedAt,
          people: state.people,
          games: state.games,
        })),
    }),
    {
      name: 'na-pivo-live-party',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        live: state.live,
        pubName: state.pubName,
        houseBeer: state.houseBeer,
        pubKey: state.pubKey,
        startedAt: state.startedAt,
        people: state.people,
        photos: state.photos,
        games: state.games,
        log: state.log,
      }),
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
