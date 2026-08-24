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
  isPrivateAccountMutationFrozen,
  registerPrivateAccountFreezeListener,
  registerPrivateAccountThawListener,
} from '@/data/privateAccountBoundary';
import type { PartyGame, PartyGameEvent, PartyGameEventInput } from '@/data/partyGamesClient';
import {
  enqueuePartyGameStart,
  flushPartyGameStartsQueue,
} from '@/data/partyGameStartsQueue';
import {
  enqueuePartyGameEvent,
  flushPartyGamesQueue,
} from '@/data/partyGamesQueue';
import { subscribeToPartyGames, type PartyGamesSubscription } from '@/data/partyGamesStream';

interface PartyGamesState {
  /** The evening we are following, or null. */
  code: string | null;
  games: PartyGame[];
  /** Everything that has happened, in cursor order. Never deduped: the folds
   *  that read it are idempotent, and dropping a "duplicate" that is really a
   *  second identical event is worse than folding one twice. */
  events: PartyGameEvent[];
  /** Terminal share failures keyed by catalogue game; local play still works. */
  sharingFailures: Record<string, string>;
  /** True while a stream is open. Polling and reconnecting both read false. */
  live: boolean;

  /** Follow an evening's games. Safe to call repeatedly with the same code. */
  connect: (code: string | null) => void;
  disconnect: () => void;
  /** Persist a game start and return its durable reference plus frozen roster. */
  start: (input: {
    catalogKey: string;
    name: string;
    scoring?: 'points' | 'drinks';
    rosterIds?: string[];
  }) => Promise<PartyGameStartHandle | null>;
  /** Say what happened. Queued, so it survives a pub with no signal. */
  send: (
    gameId: string,
    event: Omit<PartyGameEventInput, 'clientId'>,
    clientId?: string,
  ) => Promise<boolean>;
}

export interface PartyGameStartHandle {
  /** Server UUID when already known, otherwise the durable local correlation. */
  gameId: string;
  /** The first persisted lobby wins across offline reopen/retry. */
  rosterIds: string[];
}

/** The live subscription, outside the store: it is a resource, not state. */
let subscription: PartyGamesSubscription | null = null;
let resourceGeneration = 0;

/** Re-open the exact current evening after an account boundary releases. */
function reconnectCurrentPartyGames(): void {
  const code = usePartyGamesStore.getState().code;
  if (!code) return;
  usePartyGamesStore.getState().disconnect();
  usePartyGamesStore.getState().connect(code);
}

function mergeGameSnapshots(
  knownGames: PartyGame[],
  knownEvents: PartyGameEvent[],
  snapshots: PartyGame[],
): { games: PartyGame[]; events: PartyGameEvent[] } {
  if (snapshots.length === 0) return { games: knownGames, events: knownEvents };

  const incomingById = new Map(snapshots.map((game) => [game.id, game]));
  const incomingByCatalog = new Map(snapshots.map((game) => [game.catalogKey, game]));
  const rekeyedIds = new Map<string, string>();
  for (const game of knownGames) {
    const canonical = incomingByCatalog.get(game.catalogKey);
    if (canonical && canonical.id !== game.id) rekeyedIds.set(game.id, canonical.id);
  }

  const games: PartyGame[] = [];
  const seen = new Set<string>();
  for (const game of knownGames) {
    const canonical = incomingById.get(game.id) ?? incomingByCatalog.get(game.catalogKey) ?? game;
    if (seen.has(canonical.id)) continue;
    seen.add(canonical.id);
    games.push(canonical);
  }
  for (const game of snapshots) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    games.push(game);
  }

  const events = rekeyedIds.size
    ? knownEvents.map((event) => {
      const gameId = rekeyedIds.get(event.gameId);
      return gameId ? { ...event, gameId } : event;
    })
    : knownEvents;
  return { games, events };
}

export const usePartyGamesStore = create<PartyGamesState>()((set, get) => ({
  code: null,
  games: [],
  events: [],
  sharingFailures: {},
  live: false,

  connect: (code) => {
    if (isPrivateAccountMutationFrozen()) return;
    if (get().code === code) return;
    resourceGeneration += 1;
    subscription?.close();
    subscription = null;
    // A different evening is a different table: its games are not ours.
    set({ code, games: [], events: [], sharingFailures: {}, live: false });
    if (!code) return;

    const generation = resourceGeneration;
    subscription = subscribeToPartyGames(code, {
      onGames: (games) => {
        if (generation !== resourceGeneration || get().code !== code) return;
        set((state) => {
          if (games.length === 0) return state;
          // Catch-up can add roster/ended_at or replace a server UUID retired
          // by account merge. Catalogue identity is unique inside one evening,
          // so it is also the bridge that rekeys already-folded local events.
          return mergeGameSnapshots(state.games, state.events, games);
        });
      },
      onEvents: (events) => {
        if (generation !== resourceGeneration || get().code !== code) return;
        set((state) => ({ events: [...state.events, ...events] }));
      },
      onLive: (live) => {
        if (generation !== resourceGeneration || get().code !== code) return;
        set({ live });
      },
    });
  },

  disconnect: () => {
    resourceGeneration += 1;
    subscription?.close();
    subscription = null;
    set({ code: null, games: [], events: [], sharingFailures: {}, live: false });
  },

  start: async ({ catalogKey, name, scoring = 'points', rosterIds }) => {
    const code = get().code;
    if (!code) return null;
    // A catalogue game is one shared row for the whole evening. The stream may
    // have delivered it before this phone opened the screen; joining that row
    // is what makes quiz answers from different phones meet in one event log.
    const existing = get().games.find((game) => game.catalogKey === catalogKey);
    const isPlacementOnly = Array.isArray(rosterIds) && rosterIds.length === 0;
    if (existing && (existing.roster.length > 0 || isPlacementOnly)) {
      return {
        gameId: existing.id,
        rosterIds: existing.roster.length > 0
          ? existing.roster.map((person) => person.id)
          : (rosterIds ?? []),
      };
    }
    const generation = resourceGeneration;
    set((state) => {
      if (!(catalogKey in state.sharingFailures)) return state;
      const sharingFailures = { ...state.sharingFailures };
      delete sharingFailures[catalogKey];
      return { sharingFailures };
    });
    const ticket = await enqueuePartyGameStart(code, {
      // Idempotent by client id, so a retry joins the game it already created
      // instead of putting a second one on the table.
      clientId: generateUuidV4(),
      catalogKey,
      name,
      scoring,
      ...(rosterIds ? { rosterIds } : {}),
    });
    if (!ticket) {
      if (generation === resourceGeneration && get().code === code) {
        set((state) => ({
          sharingFailures: {
            ...state.sharingFailures,
            [catalogKey]: 'Hru se nepodařilo bezpečně uložit pro sdílení.',
          },
        }));
      }
      return null;
    }
    if (generation !== resourceGeneration || get().code !== code) return null;
    void ticket.delivery.then((delivery) => {
      if (generation !== resourceGeneration || get().code !== code) return;
      if (!delivery.ok) {
        if (delivery.permanent) {
          set((state) => ({
            sharingFailures: {
              ...state.sharingFailures,
              [catalogKey]: delivery.detail || 'Hru se nepodařilo sdílet se stolem.',
            },
          }));
        }
        return;
      }
      const game = delivery.game;
      set((state) => mergeGameSnapshots(state.games, state.events, [game]));
    });
    return {
      gameId: ticket.localGameId,
      rosterIds: ticket.input.rosterIds ?? [],
    };
  },

  send: async (gameId, event, clientId) => {
    const code = get().code;
    if (!code) return false;
    const generation = resourceGeneration;
    if (generation !== resourceGeneration || get().code !== code) return false;
    return enqueuePartyGameEvent(code, gameId, {
      ...event,
      clientId: clientId ?? generateUuidV4(),
    });
  },
}));

/** Durably put a catalogue cover on a known table before its lobby opens. */
export function placePartyGameOnTable(
  code: string,
  input: {
    catalogKey: string;
    name: string;
    scoring?: 'points' | 'drinks';
  },
): Promise<PartyGameStartHandle | null> {
  if (isPrivateAccountMutationFrozen()) return Promise.resolve(null);
  const store = usePartyGamesStore.getState();
  // The join code is already known in the hub even during the first render;
  // connect synchronously so placement never depends on a React effect winning
  // the race with the user's tap.
  store.connect(code);
  return usePartyGamesStore.getState().start({ ...input, rosterIds: [] });
}

/**
 * Call immediately after an anonymous A→B session is durably installed.
 * Closing and reopening the stream prevents a queued A callback from restoring
 * a pre-merge roster, then retries the atomically rekeyed queues under B.
 */
export function refreshPartyGamesAfterAccountMerge(): void {
  const code = usePartyGamesStore.getState().code;
  resourceGeneration += 1;
  subscription?.close();
  subscription = null;
  usePartyGamesStore.setState({
    code,
    games: [],
    events: [],
    sharingFailures: {},
    live: false,
  });
  // Auth success still owns the global freeze here. The thaw hook opens the
  // stream only after B is durable and every private store is safe to mutate.
  if (code && !isPrivateAccountMutationFrozen()) reconnectCurrentPartyGames();
  void flushPartyGameStartsQueue();
  void flushPartyGamesQueue();
}

registerPrivateAccountFreezeListener(() => {
  resourceGeneration += 1;
  subscription?.close();
  subscription = null;
  usePartyGamesStore.setState({ live: false });
});

registerPrivateAccountThawListener(() => {
  // A rejected login must not leave the same-code stream permanently closed:
  // `useFollowPartyGames` will not rerun and `connect(code)` is idempotent.
  reconnectCurrentPartyGames();
});

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
