/**
 * Hry, které vidí celý stůl.
 *
 * Everything under this store already existed and was not plugged in: the
 * `PartyGame` / `PartyGameEvent` tables, the SSE stream, the HTTP client and the
 * offline queue. A game was therefore only ever visible on the phone it ran on —
 * including the quiz, whose whole point is that everybody plays on their own.
 *
 * The shape is the same one the backend uses, because the backend was designed
 * for it: a game is a row, everything that happens in it is an APPEND-ONLY
 * event, and every phone folds the same list into the same picture. There is no
 * merge and no last-writer-wins, so two people answering at the same instant
 * both land.
 *
 * What this store does NOT do is understand any game. It carries `payload`
 * without looking inside it (§18.11a) — the rules live with the game, which is
 * what lets a new one ship without a backend deploy.
 */

import React from 'react';
import { create } from 'zustand';

import { generateUuidV4 } from '@/data/account';
import {
  startPartyGame,
  type PartyGame,
  type PartyGameEvent,
  type PartyGameEventInput,
} from '@/data/partyGamesClient';
import { enqueuePartyGameEvent } from '@/data/partyGamesQueue';
import { subscribeToPartyGames, type PartyGamesSubscription } from '@/data/partyGamesStream';

interface PartyGamesState {
  /** The evening we are following, or null. */
  code: string | null;
  games: PartyGame[];
  /** Everything that has happened, in cursor order. Never deduped: the folds
   *  that read it are idempotent, and dropping a "duplicate" that is really a
   *  second identical event is worse than folding one twice. */
  events: PartyGameEvent[];
  /** True while a stream is open. Polling and reconnecting both read false. */
  live: boolean;

  /** Follow an evening's games. Safe to call repeatedly with the same code. */
  connect: (code: string | null) => void;
  disconnect: () => void;
  /** Put a game on the table so the others see it. Returns its id, or null. */
  start: (input: {
    catalogKey: string;
    name: string;
    scoring?: 'points' | 'drinks';
  }) => Promise<string | null>;
  /** Say what happened. Queued, so it survives a pub with no signal. */
  send: (gameId: string, event: Omit<PartyGameEventInput, 'clientId'>) => Promise<void>;
}

/** The live subscription, outside the store: it is a resource, not state. */
let subscription: PartyGamesSubscription | null = null;

export const usePartyGamesStore = create<PartyGamesState>()((set, get) => ({
  code: null,
  games: [],
  events: [],
  live: false,

  connect: (code) => {
    if (get().code === code) return;
    subscription?.close();
    subscription = null;
    // A different evening is a different table: its games are not ours.
    set({ code, games: [], events: [], live: false });
    if (!code) return;

    subscription = subscribeToPartyGames(code, {
      onGames: (games) =>
        set((state) => {
          const known = new Set(state.games.map((game) => game.id));
          const fresh = games.filter((game) => !known.has(game.id));
          return fresh.length > 0 ? { games: [...state.games, ...fresh] } : state;
        }),
      onEvents: (events) => set((state) => ({ events: [...state.events, ...events] })),
      onLive: (live) => set({ live }),
    });
  },

  disconnect: () => {
    subscription?.close();
    subscription = null;
    set({ code: null, games: [], events: [], live: false });
  },

  start: async ({ catalogKey, name, scoring = 'points' }) => {
    const code = get().code;
    if (!code) return null;
    const result = await startPartyGame(code, {
      // Idempotent by client id, so a retry joins the game it already created
      // instead of putting a second one on the table.
      clientId: generateUuidV4(),
      catalogKey,
      name,
      scoring,
    });
    if (!result.ok) return null;
    set((state) =>
      state.games.some((game) => game.id === result.game.id)
        ? state
        : { games: [...state.games, result.game] },
    );
    return result.game.id;
  },

  send: async (gameId, event) => {
    const code = get().code;
    if (!code) return;
    await enqueuePartyGameEvent(code, gameId, { ...event, clientId: generateUuidV4() });
  },
}));

/** Events belonging to one game, in the order they happened. */
export function eventsOfGame(events: PartyGameEvent[], gameId: string | null): PartyGameEvent[] {
  if (!gameId) return [];
  return events.filter((event) => event.gameId === gameId);
}

/**
 * Follow the evening this phone is in.
 *
 * Called by every screen that shows games, because any of them can be the first
 * one opened. `connect` is idempotent for the same code, so repeated calls cost
 * nothing; a different code wipes what belonged to the previous table.
 *
 * Nothing disconnects on unmount: leaving the game screen for the hub must not
 * drop the stream and re-open it a frame later. The subscription ends when the
 * evening does.
 */
export function useFollowPartyGames(code: string | null): void {
  const connect = usePartyGamesStore((s) => s.connect);
  React.useEffect(() => {
    connect(code);
  }, [code, connect]);
}
