/**
 * Tests for the shared-games offline queue (src/data/partyGamesQueue.ts).
 *
 * What matters here is not "does it POST" but what happens when it cannot: a
 * game is played in a pub, in seconds, on a connection that comes and goes. So
 * these cover batching per game, keeping a retriable failure, dropping one the
 * server will never accept, and expiring events that belong to an evening which
 * ended hours ago.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const sendPartyGameEvents: jest.Mock = jest.fn(async () => ({
  ok: true,
  cursor: 1,
  accepted: [],
}));
jest.mock('../partyGamesClient', () => ({
  sendPartyGameEvents: (...args: unknown[]) => sendPartyGameEvents(...(args as [])),
  isRetriablePartyGamesError: jest.requireActual('../partyGamesClient')
    .isRetriablePartyGamesError,
}));

import {
  clearPartyGamesQueue,
  enqueuePartyGameEvent,
  flushPartyGamesQueue,
} from '../partyGamesQueue';
import type { PartyGameEventInput } from '../partyGamesClient';

const STORAGE_KEY = 'na-pivo-party-games-queue';

function score(clientId: string, over: Partial<PartyGameEventInput> = {}): PartyGameEventInput {
  return { clientId, kind: 'score', subjectId: 'acc-1', delta: 1, ...over };
}

async function readQueue(): Promise<{ event: PartyGameEventInput; queuedAt: number }[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 1, accepted: [] });
  await AsyncStorage.clear();
  await clearPartyGamesQueue();
});

describe('party games queue', () => {
  it('comes back from a dead zone with one request per game, not one per point', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await enqueuePartyGameEvent('ABC123', 'game-1', score('a'));
    await enqueuePartyGameEvent('ABC123', 'game-1', score('b'));
    await enqueuePartyGameEvent('ABC123', 'game-2', score('c'));

    sendPartyGameEvents.mockClear();
    sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 9, accepted: [] });
    await flushPartyGamesQueue();

    expect(sendPartyGameEvents.mock.calls.map((call) => call[1])).toEqual(['game-1', 'game-2']);
    expect(sendPartyGameEvents.mock.calls[0][2]).toHaveLength(2);
    expect(await readQueue()).toHaveLength(0);
  });

  it('keeps an event the network could not deliver', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await enqueuePartyGameEvent('ABC123', 'game-1', score('a'));

    expect(await readQueue()).toHaveLength(1);

    sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 2, accepted: [] });
    await flushPartyGamesQueue();

    expect(await readQueue()).toHaveLength(0);
  });

  it('drops an event the server refuses, rather than retrying it forever', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'http_400', detail: '' });
    await enqueuePartyGameEvent('ABC123', 'game-1', score('a'));

    expect(await readQueue()).toHaveLength(0);
  });

  it('does not enqueue the same event twice when a tap repeats', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await enqueuePartyGameEvent('ABC123', 'game-1', score('a'));
    await enqueuePartyGameEvent('ABC123', 'game-1', score('a'));

    expect(await readQueue()).toHaveLength(1);
  });

  it('forgets events from an evening that ended hours ago', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await enqueuePartyGameEvent('ABC123', 'game-1', score('a'));

    const stale = await readQueue();
    stale[0].queuedAt = Date.now() - 7 * 60 * 60 * 1000;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stale));

    sendPartyGameEvents.mockClear();
    await flushPartyGamesQueue();

    expect(sendPartyGameEvents).not.toHaveBeenCalled();
    expect(await readQueue()).toHaveLength(0);
  });

  it('carries a quiz answer through storage unchanged', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 3, accepted: [] });
    const answer: PartyGameEventInput = {
      clientId: 'q1',
      kind: 'answer',
      payload: { questionId: 'q-plzen', option: 2 },
    };
    await enqueuePartyGameEvent('ABC123', 'game-1', answer);

    expect(sendPartyGameEvents.mock.calls[0][2]).toEqual([answer]);
  });
});
