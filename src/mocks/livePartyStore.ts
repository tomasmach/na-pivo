/**
 * DESIGN MOCK — the running night, shared between the fullscreen hub, the glass
 * bar that survives minimising it, the games, and whatever the night produces.
 *
 * The point of the outputs living here is the loop: the feed card can only lead
 * with a pub-quiz scoreboard or a photo strip if the party mode actually MAKES
 * one. Until now the card could render five kinds of highlight and the party
 * produced none of them.
 *
 * The clock is a counter of minutes, not a real one. `Date.now()` in a mock
 * means the timeline drifts while you look at it and no two screenshots agree;
 * here each action advances the evening by a plausible gap, which is enough to
 * judge the shape of a timeline and keeps every render deterministic.
 *
 * Beers are a LIST, not a tally. A number cannot say what you drank or when,
 * and the timeline, the per-type counters and the tempo chart are all just
 * different readings of the same list.
 *
 * Deliberately not persisted and deliberately small: the real thing hangs off
 * the party evening client.
 */

import { create } from 'zustand';

export interface GameResult {
  game: string;
  winner: string;
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

/** One beer, logged. It runs until the next one, which is what gives the
 *  timeline its segments rather than a row of identical ticks. */
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

export type LogKind = 'beer' | 'photo' | 'game' | 'join' | 'pub';

export interface LogEvent {
  id: string;
  at: number;
  kind: LogKind;
  text: string;
}

interface LivePartyState {
  live: boolean;
  pubName: string;
  /** What "+1 pivo" pours without asking — the pub's own tap. */
  houseBeer: string;
  /** Minutes since the first beer. Advanced by actions, never by a real clock. */
  minutes: number;
  beers: BeerEntry[];
  people: PartyPersonLive[];
  photos: number;
  games: GameEntry[];
  log: LogEvent[];

  start: (pubName: string, beer: string) => void;
  addBeer: (beer: string) => void;
  /** Takes the LAST beer of that type back off. Mis-taps happen in pubs. */
  removeBeer: (beer: string) => void;
  addPhoto: () => void;
  addGame: (key: string, name: string) => void;
  finishGame: (key: string, result: GameResult) => void;
  invite: (name: string) => void;
  end: () => void;
}

/** Plausible gaps so the timeline has rhythm instead of even ticks. */
const GAPS = [14, 9, 21, 12, 26, 8, 17, 11];

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

const EMPTY = {
  live: false,
  pubName: '',
  houseBeer: '',
  minutes: 0,
  beers: [] as BeerEntry[],
  people: [] as PartyPersonLive[],
  photos: 0,
  games: [] as GameEntry[],
  log: [] as LogEvent[],
};

function logged(state: { log: LogEvent[] }, at: number, kind: LogKind, text: string): LogEvent[] {
  return [...state.log, { id: nextId('ev'), at, kind, text }];
}

export const useLivePartyStore = create<LivePartyState>((set) => ({
  ...EMPTY,

  start: (pubName, beer) =>
    set(() => ({
      live: true,
      pubName,
      houseBeer: beer,
      minutes: 0,
      beers: [{ id: nextId('beer'), beer, at: 0 }],
      people: TABLE.map((person) => ({ ...person })),
      photos: 0,
      games: [],
      log: [
        { id: nextId('ev'), at: 0, kind: 'pub', text: `Večer začal v ${pubName}` },
        { id: nextId('ev'), at: 0, kind: 'beer', text: beer },
      ],
    })),

  addBeer: (beer) =>
    set((s) => {
      const at = s.minutes + GAPS[s.beers.length % GAPS.length];
      return {
        minutes: at,
        beers: [...s.beers, { id: nextId('beer'), beer, at }],
        log: logged(s, at, 'beer', beer),
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

  addPhoto: () =>
    set((s) => ({
      photos: s.photos + 1,
      log: logged(s, s.minutes, 'photo', 'Fotka'),
    })),

  addGame: (key, name) =>
    set((s) =>
      s.games.some((game) => game.key === key)
        ? s
        : {
            games: [...s.games, { key, name, at: s.minutes }],
            log: logged(s, s.minutes, 'game', `${name} na stole`),
          },
    ),

  finishGame: (key, result) =>
    set((s) => ({
      games: s.games.map((game) => (game.key === key ? { ...game, result } : game)),
      log: logged(s, s.minutes, 'game', `${result.game} — vyhrál ${result.winner}`),
    })),

  invite: (name) =>
    set((s) =>
      s.people.some((person) => person.name === name)
        ? s
        : {
            people: [...s.people, { id: nextId('u'), name, tint: '#A8896A', beers: 0 }],
            log: logged(s, s.minutes, 'join', `${name} dorazil`),
          },
    ),

  end: () => set({ ...EMPTY }),
}));

/** "1h 12m" / "48m". Shared, so the bar, the hub and the recap agree. */
export function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "20:15" from a minute offset. The evening is pinned to a 20:00 start so the
 *  timeline reads like a real night instead of "minuta 14". */
export function clockAt(minutes: number): string {
  const total = 20 * 60 + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

/** Beers bucketed by clock hour, for the tempo chart. */
export function hourlyFrom(beers: BeerEntry[]): { hour: string; beers: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const entry of beers) {
    const hour = clockAt(entry.at).slice(0, 2);
    if (!counts.has(hour)) order.push(hour);
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return order.map((hour) => ({ hour, beers: counts.get(hour) ?? 0 }));
}
