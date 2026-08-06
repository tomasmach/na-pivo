/**
 * Tests for the shared-games store (src/stores/partyGamesStore.ts).
 *
 * This is the seam between a game and the rest of the table, so what matters is
 * that it never mixes two tables together, never puts the same game down twice,
 * and hands every event to the queue rather than the network — a pub is where
 * the signal is worst and a game is played in seconds.
 */

const startPartyGame: jest.Mock = jest.fn();
jest.mock('@/data/partyGamesClient', () => ({
  startPartyGame: (...args: unknown[]) => startPartyGame(...(args as [])),
}));

const enqueuePartyGameEvent: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/data/partyGamesQueue', () => ({
  enqueuePartyGameEvent: (...args: unknown[]) => enqueuePartyGameEvent(...(args as [])),
}));

const close: jest.Mock = jest.fn();
const subscribeToPartyGames: jest.Mock = jest.fn(() => ({ close }));
jest.mock('@/data/partyGamesStream', () => ({
  subscribeToPartyGames: (...args: unknown[]) => subscribeToPartyGames(...(args as [])),
}));

jest.mock('@/data/account', () => ({ generateUuidV4: () => 'uuid-1' }));

import { eventsOfGame, usePartyGamesStore } from '@/stores/partyGamesStore';
import type { PartyGame, PartyGameEvent } from '@/data/partyGamesClient';

const GAME: PartyGame = {
  id: 'game-1',
  catalogKey: 'quiz',
  name: 'Pub kvíz',
  scoring: 'points',
  startedBy: { id: 'me', nickname: 'ja', displayName: 'Já', avatarUrl: null },
  startedAt: '2026-07-30T20:00:00.000Z',
  endedAt: null,
};

const event = (over: Partial<PartyGameEvent> = {}): PartyGameEvent => ({
  cursor: 1,
  gameId: 'game-1',
  kind: 'answer',
  account: { id: 'h', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
  subject: null,
  delta: 0,
  payload: { questionId: 'q-plzen', option: 0 },
  at: '2026-07-30T20:01:00.000Z',
  ...over,
});

/** The handlers the store passed to the stream, so a test can push at it. */
const handlers = () => subscribeToPartyGames.mock.calls[0][1];

beforeEach(() => {
  jest.clearAllMocks();
  startPartyGame.mockResolvedValue({ ok: true, game: GAME });
  usePartyGamesStore.setState({ code: null, games: [], events: [], live: false });
});

describe('partyGamesStore', () => {
  it('follows one evening and hands its events on', () => {
    usePartyGamesStore.getState().connect('STUL24');
    handlers().onGames([GAME]);
    handlers().onEvents([event()]);

    expect(subscribeToPartyGames).toHaveBeenCalledTimes(1);
    expect(usePartyGamesStore.getState().games).toEqual([GAME]);
    expect(usePartyGamesStore.getState().events).toHaveLength(1);
  });

  it('does not re-open the stream for the evening it is already in', () => {
    usePartyGamesStore.getState().connect('STUL24');
    usePartyGamesStore.getState().connect('STUL24');

    expect(subscribeToPartyGames).toHaveBeenCalledTimes(1);
  });

  it('forgets the previous table when the evening changes', () => {
    // Another evening's games are not ours, and folding both lists would
    // score somebody else's quiz into this one.
    usePartyGamesStore.getState().connect('STUL24');
    handlers().onEvents([event()]);
    usePartyGamesStore.getState().connect('JINY1');

    expect(close).toHaveBeenCalled();
    expect(usePartyGamesStore.getState().events).toEqual([]);
    expect(usePartyGamesStore.getState().games).toEqual([]);
  });

  it('puts a game on the table once, however the stream echoes it back', () => {
    usePartyGamesStore.getState().connect('STUL24');
    return usePartyGamesStore
      .getState()
      .start({ catalogKey: 'quiz', name: 'Pub kvíz' })
      .then((id) => {
        handlers().onGames([GAME]);

        expect(id).toBe('game-1');
        expect(usePartyGamesStore.getState().games).toEqual([GAME]);
      });
  });

  it('starts nothing when there is no evening to share with', async () => {
    const id = await usePartyGamesStore.getState().start({ catalogKey: 'quiz', name: 'Pub kvíz' });

    expect(id).toBeNull();
    expect(startPartyGame).not.toHaveBeenCalled();
  });

  it('queues an event rather than posting it, and stamps a client id', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    await usePartyGamesStore
      .getState()
      .send('game-1', { kind: 'answer', payload: { questionId: 'q-plzen', option: 2 } });

    expect(enqueuePartyGameEvent).toHaveBeenCalledWith('STUL24', 'game-1', {
      clientId: 'uuid-1',
      kind: 'answer',
      payload: { questionId: 'q-plzen', option: 2 },
    });
  });
});

describe('eventsOfGame', () => {
  it('keeps two games at the same table apart', () => {
    const events = [event(), event({ gameId: 'game-2', cursor: 2 })];

    expect(eventsOfGame(events, 'game-2')).toHaveLength(1);
    expect(eventsOfGame(events, null)).toEqual([]);
  });
});
