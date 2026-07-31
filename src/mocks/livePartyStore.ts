/**
 * DESIGN MOCK — the running night, shared between the fullscreen party, the
 * mini bar that survives minimising it, and whatever the night produces.
 *
 * The point of the outputs living here is the loop: the feed card can only lead
 * with a pub-quiz scoreboard or a photo strip if the party mode actually MAKES
 * one. Until now the card could render five kinds of highlight and the party
 * produced none of them.
 *
 * Deliberately not persisted and deliberately tiny: the real thing hangs off
 * the party evening client.
 */

import { create } from 'zustand';

export interface GameResult {
  game: string;
  winner: string;
  scores: { name: string; score: number }[];
}

interface LivePartyState {
  live: boolean;
  pubName: string;
  /** My tally, the number the mini bar shows. */
  beers: number;
  /** Already formatted; the mock does no clock arithmetic. */
  elapsed: string;

  // — what the night produces —
  /** Photos taken during the evening. */
  photos: number;
  /** Every game played tonight, newest last. */
  games: GameResult[];
  /** Beers per hour, the shape of how far it went. */
  hourly: { hour: string; beers: number }[];

  start: (pubName: string) => void;
  addBeer: () => void;
  addPhoto: () => void;
  playGame: (result: GameResult) => void;
  end: () => void;
}

/** Stand-in clock: each beer lands in the next hour slot. */
const HOURS = ['20', '21', '22', '23', '00', '01'];

const EMPTY = {
  live: false,
  pubName: '',
  beers: 0,
  elapsed: '0m',
  photos: 0,
  games: [] as GameResult[],
  hourly: [] as { hour: string; beers: number }[],
};

export const useLivePartyStore = create<LivePartyState>((set) => ({
  ...EMPTY,

  start: (pubName) =>
    set({
      live: true,
      pubName,
      beers: 1,
      elapsed: '1m',
      hourly: [{ hour: HOURS[0], beers: 1 }],
    }),

  addBeer: () =>
    set((s) => {
      const beers = s.beers + 1;
      // Spread the tally across the evening so the tempo chart has a shape
      // instead of one tall bar.
      const slot = Math.min(HOURS.length - 1, Math.floor(beers / 2));
      const hourly = [...s.hourly];
      const found = hourly.findIndex((h) => h.hour === HOURS[slot]);
      if (found >= 0) hourly[found] = { ...hourly[found], beers: hourly[found].beers + 1 };
      else hourly.push({ hour: HOURS[slot], beers: 1 });
      return { beers, hourly, elapsed: '1h 12m' };
    }),

  addPhoto: () => set((s) => ({ photos: s.photos + 1 })),

  playGame: (result) => set((s) => ({ games: [...s.games, result] })),

  end: () => set({ ...EMPTY }),
}));
