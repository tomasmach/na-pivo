/**
 * Tests for the shared-games store (src/stores/partyGamesStore.ts).
 *
 * This is the seam between a game and the rest of the table, so what matters is
 * that it never mixes two tables together, never puts the same game down twice,
 * and hands every event to the queue rather than the network — a pub is where
 * the signal is worst and a game is played in seconds.
 */

import {
  eventsOfGame,
  placePartyGameOnTable,
  refreshPartyGamesAfterAccountMerge,
  usePartyGamesStore,
} from '@/stores/partyGamesStore';
import type { PartyGame, PartyGameEvent } from '@/data/partyGamesClient';
import type { PartyGameStartDelivery } from '@/data/partyGameStartsQueue';
import {
  beginPrivateAccountTransition,
  setPrivateAccountDeletionRecoveryBlocked,
} from '@/data/privateAccountBoundary';

const enqueuePartyGameStart: jest.Mock = jest.fn();
const flushPartyGameStartsQueue: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/data/partyGameStartsQueue', () => ({
  enqueuePartyGameStart: (...args: unknown[]) => enqueuePartyGameStart(...(args as [])),
  flushPartyGameStartsQueue: () => flushPartyGameStartsQueue(),
}));

const enqueuePartyGameEvent: jest.Mock = jest.fn(async () => true);
const flushPartyGamesQueue: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/data/partyGamesQueue', () => ({
  enqueuePartyGameEvent: (...args: unknown[]) => enqueuePartyGameEvent(...(args as [])),
  flushPartyGamesQueue: () => flushPartyGamesQueue(),
}));

const close: jest.Mock = jest.fn();
const subscribeToPartyGames: jest.Mock = jest.fn(() => ({ close }));
jest.mock('@/data/partyGamesStream', () => ({
  subscribeToPartyGames: (...args: unknown[]) => subscribeToPartyGames(...(args as [])),
}));

jest.mock('@/data/account', () => ({ generateUuidV4: () => 'uuid-1' }));

const GAME: PartyGame = {
  seed: 1,
  id: 'game-1',
  catalogKey: 'quiz',
  name: 'Pub kvíz',
  scoring: 'points',
  startedBy: { id: 'me', nickname: 'ja', displayName: 'Já', avatarUrl: null },
  roster: [
    { id: 'me', nickname: 'ja', displayName: 'Já', avatarUrl: null },
    { id: 'h', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
  ],
  startedAt: '2026-07-30T20:00:00.000Z',
  endedAt: null,
};

const event = (over: Partial<PartyGameEvent> = {}): PartyGameEvent => ({
  cursor: 1,
  clientId: 'event-1',
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

const startTicket = (
  delivery: Promise<PartyGameStartDelivery> = Promise.resolve({ ok: true, game: GAME }),
) => ({
  localGameId: 'local:uuid-1',
  ownerAccountId: 'me',
  input: {
    clientId: 'uuid-1',
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    scoring: 'points' as const,
    rosterIds: ['me', 'h'],
  },
  delivery,
});

beforeEach(() => {
  jest.clearAllMocks();
  setPrivateAccountDeletionRecoveryBlocked(false);
  enqueuePartyGameStart.mockResolvedValue(startTicket());
  usePartyGamesStore.setState({
    code: null,
    games: [],
    events: [],
    sharingFailures: {},
    live: false,
  });
});

afterEach(() => {
  setPrivateAccountDeletionRecoveryBlocked(false);
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

  it('puts a game on the table once, however the stream echoes it back', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    const handle = await usePartyGamesStore
      .getState()
      .start({ catalogKey: 'quiz', name: 'Pub kvíz', rosterIds: ['me', 'h'] });
    handlers().onGames([GAME]);

    expect(handle).toEqual({ gameId: 'local:uuid-1', rosterIds: ['me', 'h'] });
    expect(usePartyGamesStore.getState().games).toEqual([GAME]);
  });

  it('rekeys a retired server game and its buffered events by catalogue identity', () => {
    const canonical = { ...GAME, id: 'game-canonical', seed: 731 };
    usePartyGamesStore.getState().connect('STUL24');
    handlers().onGames([GAME]);
    handlers().onEvents([event()]);

    handlers().onGames([canonical]);
    handlers().onEvents([event({ cursor: 2, clientId: 'event-2', gameId: canonical.id })]);

    const state = usePartyGamesStore.getState();
    expect(state.games).toEqual([canonical]);
    expect(state.events.map((item) => item.gameId)).toEqual([
      canonical.id,
      canonical.id,
    ]);
    expect(eventsOfGame(state.events, canonical.id)).toHaveLength(2);
  });

  it('durably places a picked game with an explicit pending roster', async () => {
    const handle = await placePartyGameOnTable('STUL24', {
      catalogKey: 'quiz',
      name: 'Pub kvíz',
      scoring: 'points',
    });

    expect(handle?.gameId).toBe('local:uuid-1');
    expect(enqueuePartyGameStart).toHaveBeenCalledWith('STUL24', {
      clientId: 'uuid-1',
      catalogKey: 'quiz',
      name: 'Pub kvíz',
      scoring: 'points',
      rosterIds: [],
    });
  });

  it('hands the durable local id back before the server start finishes', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    let resolveDelivery!: (result: PartyGameStartDelivery) => void;
    const delivery = new Promise<PartyGameStartDelivery>((resolve) => {
      resolveDelivery = resolve;
    });
    enqueuePartyGameStart.mockResolvedValueOnce(startTicket(delivery));

    const handle = await usePartyGamesStore
      .getState()
      .start({ catalogKey: 'quiz', name: 'Pub kvíz', rosterIds: ['me', 'h'] });

    expect(handle?.gameId).toBe('local:uuid-1');
    expect(usePartyGamesStore.getState().games).toEqual([]);

    resolveDelivery({ ok: true, game: GAME });
    await delivery;
    await Promise.resolve();
    expect(usePartyGamesStore.getState().games).toEqual([GAME]);
  });

  it('joins the existing catalogue game instead of creating another row', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    handlers().onGames([GAME]);

    const handle = await usePartyGamesStore
      .getState()
      .start({ catalogKey: 'quiz', name: 'Pub kvíz', rosterIds: ['me', 'h'] });

    expect(handle).toEqual({ gameId: 'game-1', rosterIds: ['me', 'h'] });
    expect(enqueuePartyGameStart).not.toHaveBeenCalled();
  });

  it('binds a lobby roster onto an existing pending placement', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    handlers().onGames([{ ...GAME, roster: [] }]);

    const handle = await usePartyGamesStore
      .getState()
      .start({ catalogKey: 'quiz', name: 'Pub kvíz', rosterIds: ['me', 'h'] });

    expect(handle).toEqual({ gameId: 'local:uuid-1', rosterIds: ['me', 'h'] });
    expect(enqueuePartyGameStart).toHaveBeenCalledWith('STUL24', {
      clientId: 'uuid-1',
      catalogKey: 'quiz',
      name: 'Pub kvíz',
      scoring: 'points',
      rosterIds: ['me', 'h'],
    });
  });

  it('starts nothing when there is no evening to share with', async () => {
    const id = await usePartyGamesStore.getState().start({ catalogKey: 'quiz', name: 'Pub kvíz' });

    expect(id).toBeNull();
    expect(enqueuePartyGameStart).not.toHaveBeenCalled();
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

  it('reports when an event could not be saved durably', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    enqueuePartyGameEvent.mockResolvedValueOnce(false);

    await expect(
      usePartyGamesStore
        .getState()
        .send('game-1', { kind: 'action', payload: { type: 'pick', playerId: 'h' } }),
    ).resolves.toBe(false);
  });

  it('preserves an optimistic action id for exact stream echo dedupe', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    await usePartyGamesStore
      .getState()
      .send(
        'game-1',
        { kind: 'action', payload: { type: 'prompt_next' } },
        'optimistic-action-1',
      );

    expect(enqueuePartyGameEvent).toHaveBeenCalledWith('STUL24', 'game-1', {
      clientId: 'optimistic-action-1',
      kind: 'action',
      payload: { type: 'prompt_next' },
    });
  });

  it('surfaces a terminal start rejection instead of losing local events silently', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    enqueuePartyGameStart.mockResolvedValueOnce(startTicket(Promise.resolve({
      ok: false,
      permanent: true,
      code: 'roster_member_not_active',
      detail: 'Honza už odešel.',
      discardedEvents: 2,
    })));

    await usePartyGamesStore
      .getState()
      .start({ catalogKey: 'quiz', name: 'Pub kvíz', rosterIds: ['me', 'h'] });
    await Promise.resolve();

    expect(usePartyGamesStore.getState().sharingFailures.quiz).toBe('Honza už odešel.');
  });

  it('surfaces a local queue refusal and keeps the game local-only', async () => {
    usePartyGamesStore.getState().connect('STUL24');
    enqueuePartyGameStart.mockResolvedValueOnce(null);

    const handle = await usePartyGamesStore
      .getState()
      .start({ catalogKey: 'quiz', name: 'Pub kvíz', rosterIds: ['me', 'h'] });

    expect(handle).toBeNull();
    expect(usePartyGamesStore.getState().sharingFailures.quiz).toBe(
      'Hru se nepodařilo bezpečně uložit pro sdílení.',
    );
  });

  it('reopens the stream after account merge and ignores the stale roster callback', () => {
    usePartyGamesStore.getState().connect('STUL24');
    const oldHandlers = handlers();

    refreshPartyGamesAfterAccountMerge();
    oldHandlers.onGames([GAME]);

    expect(close).toHaveBeenCalled();
    expect(subscribeToPartyGames).toHaveBeenCalledTimes(2);
    expect(usePartyGamesStore.getState().games).toEqual([]);
    expect(flushPartyGameStartsQueue).toHaveBeenCalled();
    expect(flushPartyGamesQueue).toHaveBeenCalled();
  });

  it('reconnects the exact evening after a rejected auth boundary releases', () => {
    usePartyGamesStore.getState().connect('STUL24');
    const oldHandlers = handlers();
    oldHandlers.onGames([GAME]);
    const closesBeforeBoundary = close.mock.calls.length;

    // This is the lifecycle of a 4xx login: freeze and close all A resources,
    // then abort the credential transition while A remains the durable owner.
    const transition = beginPrivateAccountTransition('credential-auth', 'me');
    expect(transition).not.toBeNull();
    expect(close).toHaveBeenCalledTimes(closesBeforeBoundary + 1);
    transition!.release();

    expect(subscribeToPartyGames).toHaveBeenCalledTimes(2);
    expect(subscribeToPartyGames.mock.calls[1][0]).toBe('STUL24');
    expect(usePartyGamesStore.getState().code).toBe('STUL24');
    expect(usePartyGamesStore.getState().games).toEqual([]);

    oldHandlers.onGames([GAME]);
    expect(usePartyGamesStore.getState().games).toEqual([]);
    subscribeToPartyGames.mock.calls[1][1].onGames([GAME]);
    expect(usePartyGamesStore.getState().games).toEqual([GAME]);
  });

  it('stays disconnected across startup retries while deletion recovery blocks, then reconnects once when it clears', () => {
    usePartyGamesStore.getState().connect('STUL24');
    expect(subscribeToPartyGames).toHaveBeenCalledTimes(1);

    setPrivateAccountDeletionRecoveryBlocked(true);
    const closesBefore = close.mock.calls.length;

    // Two startup retries: the freeze from setPrivateAccountDeletionRecoveryBlocked
    // already closed A resources once; a transition begun while still frozen must
    // not emit another close, and none of this may drive a thaw — the real
    // boundary listener stays installed.
    const firstRetry = beginPrivateAccountTransition('credential-auth', 'me');
    expect(firstRetry).not.toBeNull();
    expect(close).toHaveBeenCalledTimes(closesBefore);
    firstRetry!.release();
    expect(subscribeToPartyGames).toHaveBeenCalledTimes(1);

    const secondRetry = beginPrivateAccountTransition('credential-auth', 'me');
    expect(secondRetry).not.toBeNull();
    secondRetry!.release();
    expect(subscribeToPartyGames).toHaveBeenCalledTimes(1);

    setPrivateAccountDeletionRecoveryBlocked(false);
    expect(subscribeToPartyGames).toHaveBeenCalledTimes(2);
    expect(subscribeToPartyGames.mock.calls[1][0]).toBe('STUL24');
  });
});

describe('eventsOfGame', () => {
  it('keeps two games at the same table apart', () => {
    const events = [event(), event({ gameId: 'game-2', cursor: 2 })];

    expect(eventsOfGame(events, 'game-2')).toHaveLength(1);
    expect(eventsOfGame(events, null)).toEqual([]);
  });
});
