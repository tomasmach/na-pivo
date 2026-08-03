/**
 * DESIGN MOCK — the running night, shared between the fullscreen hub, the glass
 * bar that survives minimising it, the games, and whatever the night produces.
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
 * Deliberately not persisted and deliberately small: the real thing hangs off
 * the party evening client.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';

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

/**
 * One beer, logged — a lap on the stopwatch.
 *
 * `at` is epoch ms. It runs until the next one, so the gap IS the lap time, and
 * the last one is still running.
 */
export interface BeerEntry {
  id: string;
  beer: string;
  at: number;
}

export interface PartyPersonLive {
  id: string;
  name: string;
  tint: string;
  beers: number;
}

export type LogKind =
  | 'beer'
  | 'photo'
  | 'game'
  | 'join'
  | 'pub'
  /** Someone wrote into the thread. The only kind whose text is a voice. */
  | 'note'
  /** Somebody bought a round — the most Czech event there is. */
  | 'round';

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
  /** Epoch ms of the first beer — the stopwatch's zero. Null until it starts. */
  startedAt: number | null;
  beers: BeerEntry[];
  people: PartyPersonLive[];
  photos: number;
  games: GameEntry[];
  log: LogEvent[];

  start: (pubName: string, beer: string) => void;
  /** Set where you are — before a night, or when you move mid-evening. */
  setPub: (pubName: string, beer: string) => void;
  beginPickingPub: () => void;
  endPickingPub: () => void;
  addBeer: (beer: string) => void;
  /** Takes the LAST beer of that type back off. Mis-taps happen in pubs. */
  removeBeer: (beer: string) => void;
  /** Fix one entry you logged wrong — the log is the only place you can see
   *  WHICH one was wrong, so it is where correcting it belongs. */
  editBeer: (beerId: string, beer: string) => void;
  dropBeer: (beerId: string) => void;
  addPhoto: () => void;
  addGame: (key: string, name: string) => void;
  finishGame: (key: string, result: GameResult) => void;
  invite: (name: string) => void;
  end: () => void;
}

let seq = 0;
const nextId = (prefix: string) => {
  seq += 1;
  return `${prefix}-${seq}`;
};

/** The table you walk in with. Mock — the real thing comes from members. */
const TABLE: PartyPersonLive[] = [
  { id: 'u2', name: 'Honza', tint: '#7DD66B', beers: 1 },
  { id: 'u3', name: 'Petr', tint: '#F0BE5C', beers: 0 },
];

/** Where the app assumes you are before you say otherwise. Mock. */
const DEFAULT_PUB = { name: 'U Fleků', beer: 'Flekovský ležák 13°' };

const EMPTY = {
  live: false,
  pubName: DEFAULT_PUB.name,
  houseBeer: DEFAULT_PUB.beer,
  pickingPub: false,
  startedAt: null as number | null,
  beers: [] as BeerEntry[],
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
  extra?: { gameKey?: string; beerId?: string },
): LogEvent[] {
  return [...state.log, { id: nextId('ev'), at, kind, text, by, ...extra }];
}

export const useLivePartyStore = create<LivePartyState>((set) => ({
  ...EMPTY,

  start: (pubName, beer) => {
    const now = Date.now();
    set({
      live: true,
      pubName,
      houseBeer: beer,
      startedAt: now,
      beers: [{ id: nextId('beer'), beer, at: now }],
      people: TABLE.map((person) => ({ ...person })),
      photos: 0,
      games: [],
      log: [
        { id: nextId('ev'), at: now, kind: 'pub', text: `Večer začal v ${pubName}`, by: ME },
        // The table was already there and Honza was already drinking — the
        // thread starts with more than one voice, because it always does.
        ...TABLE.filter((person) => person.beers > 0).map((person) => ({
          id: nextId('ev'),
          at: now,
          kind: 'beer' as LogKind,
          text: beer,
          by: person.name,
        })),
        { id: nextId('ev'), at: now, kind: 'beer' as LogKind, text: beer, by: ME },
        // Two more shapes the thread has to carry: somebody's round, and
        // somebody talking. A thread only reads as a thread once there is a
        // voice in it that is not the app narrating.
        {
          id: nextId('ev'),
          at: now,
          kind: 'round' as LogKind,
          text: 'Runda pro stůl',
          by: TABLE[1]?.name ?? ME,
        },
        {
          id: nextId('ev'),
          at: now,
          kind: 'note' as LogKind,
          text: 'Držte mi místo, jdu si pro kufr a jsem tu.',
          by: TABLE[0]?.name ?? ME,
        },
      ],
    });
  },

  setPub: (pubName, beer) =>
    set((s) =>
      s.live
        ? {
            pubName,
            houseBeer: beer,
            log: logged(s, Date.now(), 'pub', `Přesun do ${pubName}`),
          }
        : { pubName, houseBeer: beer },
    ),

  beginPickingPub: () => set({ pickingPub: true }),
  endPickingPub: () => set({ pickingPub: false }),

  addBeer: (beer) =>
    set((s) => {
      const at = Date.now();
      const id = nextId('beer');
      return {
        beers: [...s.beers, { id, beer, at }],
        log: logged(s, at, 'beer', beer, ME, { beerId: id }),
      };
    }),

  removeBeer: (beer) =>
    set((s) => {
      // The last one OF THAT TYPE, not the newest overall — you are correcting
      // the row you just tapped, not undoing whatever happened most recently.
      const index = s.beers.map((entry) => entry.beer).lastIndexOf(beer);
      if (index < 0) return s;
      return { beers: s.beers.filter((_, i) => i !== index) };
    }),

  editBeer: (beerId, beer) =>
    set((s) => ({
      beers: s.beers.map((entry) => (entry.id === beerId ? { ...entry, beer } : entry)),
      // The log row is rewritten in place rather than a correction being
      // appended: a thread of "Pilsner / no vlastně Kozel" is a worse record of
      // the evening than one that simply says what you drank.
      log: s.log.map((event) => (event.beerId === beerId ? { ...event, text: beer } : event)),
    })),

  dropBeer: (beerId) =>
    set((s) => ({
      beers: s.beers.filter((entry) => entry.id !== beerId),
      log: s.log.filter((event) => event.beerId !== beerId),
    })),

  addPhoto: () =>
    set((s) => ({
      photos: s.photos + 1,
      log: logged(s, Date.now(), 'photo', 'Fotka'),
    })),

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
            people: [...s.people, { id: nextId('u'), name, tint: '#A8896A', beers: 0 }],
            log: logged(s, Date.now(), 'join', 'Dorazil k stolu', name),
          },
    ),

  end: () => set({ ...EMPTY }),
}));

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

/** The shopping list: one row per beer type, in the order first ordered. */
export function beersByType(beers: BeerEntry[]): { beer: string; count: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const entry of beers) {
    if (!counts.has(entry.beer)) order.push(entry.beer);
    counts.set(entry.beer, (counts.get(entry.beer) ?? 0) + 1);
  }
  return order.map((beer) => ({ beer, count: counts.get(beer) ?? 0 }));
}

/**
 * Beers bucketed by clock hour, for the tempo chart.
 *
 * Every hour from the first beer to `now` is present, including the empty ones.
 * Bucketing only the hours that HAD a beer drew a chart with one bar on it and
 * no time axis at all — an hour where nobody drank is a fact about the evening,
 * and skipping it silently squashes the gaps out of the tempo.
 */
export function hourlyFrom(
  beers: BeerEntry[],
  /** Epoch ms of "now" — how far the axis has actually got. */
  now = 0,
  /**
   * Hours the axis always shows, counted from the first beer.
   *
   * Without it the chart is one bar wide at 20:05 and grows a column every
   * hour, so the whole thing rescales under you all evening. An evening is
   * expected to run a few hours — drawing that span from the start means the
   * bars mean the same thing at 20:05 as at 23:00, and the empty columns read
   * as "not yet" rather than as a prediction that you will fill them.
   */
  minSpan = 5,
): { hour: string; beers: number }[] {
  if (beers.length === 0) return [];

  const hourOf = (at: number) => Math.floor(at / 3_600_000);

  const counts = new Map<number, number>();
  for (const entry of beers) {
    counts.set(hourOf(entry.at), (counts.get(hourOf(entry.at)) ?? 0) + 1);
  }

  const first = hourOf(beers[0].at);
  const reached = hourOf(Math.max(now, beers[beers.length - 1].at));
  const last = Math.max(reached, first + minSpan - 1);

  const out: { hour: string; beers: number }[] = [];
  for (let hour = first; hour <= last; hour += 1) {
    out.push({ hour: clockAt(hour * 3_600_000).slice(0, 2), beers: counts.get(hour) ?? 0 });
  }
  return out;
}
