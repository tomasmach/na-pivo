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

let mockCurrentAccountId = 'account-a';
const ensureAccount = jest.fn(async (signal?: AbortSignal) =>
  signal?.aborted
    ? null
    : { deviceId: 'device', accountId: mockCurrentAccountId, token: 'token' },
);
jest.mock('../account', () => ({
  ensureAccount: (...args: unknown[]) => ensureAccount(...(args as [])),
}));

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
  remapQueuedPartyGameEvents,
} from '../partyGamesQueue';
import type { PartyGameEventInput } from '../partyGamesClient';

const STORAGE_KEY = 'na-pivo-party-games-queue';
const QUARANTINE_KEY = 'na-pivo-party-games-queue-quarantine-v1';

function score(clientId: string, over: Partial<PartyGameEventInput> = {}): PartyGameEventInput {
  return { clientId, kind: 'score', subjectId: 'acc-1', delta: 1, ...over };
}

async function readQueue(): Promise<{ event: PartyGameEventInput; queuedAt: number }[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.items;
}

async function readState() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockCurrentAccountId = 'account-a';
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

    const stale = await readState();
    stale.items[0].queuedAt = Date.now() - 7 * 60 * 60 * 1000;
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

  it('prunes a resolved local alias after the game lifetime even with no events', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    await remapQueuedPartyGameEvents(
      'ABC123',
      'local:start-1',
      'game-1',
      'account-a',
    );
    expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();

    clock.mockReturnValue(now + 7 * 60 * 60 * 1000);
    await flushPartyGamesQueue();

    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    clock.mockRestore();
  });

  it('uses a durable alias for an event arriving after remap and reload', async () => {
    await remapQueuedPartyGameEvents(
      'ABC123',
      'local:start-1',
      'game-1',
      'account-a',
    );

    const persisted = await AsyncStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();
    // Mimic a cold launch: only the serialized state survives. The queue must
    // not depend on an in-memory remap callback from the start request.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(JSON.parse(persisted!)));
    sendPartyGameEvents.mockClear();

    await enqueuePartyGameEvent('ABC123', 'local:start-1', score('late'));

    expect(sendPartyGameEvents).toHaveBeenCalledWith(
      'ABC123',
      'game-1',
      [score('late')],
      expect.any(AbortSignal),
      'account-a',
    );
    expect(await readQueue()).toHaveLength(0);
  });

  it('never flushes account A gameplay with account B after a cold restart', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await enqueuePartyGameEvent('ABC123', 'game-1', score('owned-by-a'));
    const persisted = await AsyncStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(persisted!).ownerAccountId).toBe('account-a');

    mockCurrentAccountId = 'account-b';
    sendPartyGameEvents.mockClear();
    sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 2, accepted: [] });
    await flushPartyGamesQueue();

    expect(sendPartyGameEvents).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(persisted);
  });

  it('preserves unreadable gameplay in quarantine and recovers a fresh owner queue', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{broken');
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });

    const stored = await enqueuePartyGameEvent('ABC123', 'game-1', score('safe'));

    expect(stored).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY))!).entries).toEqual([
      expect.objectContaining({ raw: '{broken', reason: 'corrupt' }),
    ]);
    expect(await readState()).toMatchObject({
      ownerAccountId: 'account-a',
      items: [expect.objectContaining({ event: expect.objectContaining({ clientId: 'safe' }) })],
    });
  });

  it('rejects the server-owned start envelope without corrupting persisted events', async () => {
    sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await enqueuePartyGameEvent('ABC123', 'game-1', score('existing'));
    const before = await AsyncStorage.getItem(STORAGE_KEY);
    sendPartyGameEvents.mockClear();

    const stored = await enqueuePartyGameEvent(
      'ABC123',
      'game-1',
      { clientId: 'invalid-start', kind: 'start' } as unknown as PartyGameEventInput,
    );

    expect(stored).toBe(false);
    expect(sendPartyGameEvents).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('rejects overflow without evicting the oldest accepted event', async () => {
    const queuedAt = Date.now();
    const items = Array.from({ length: 5_000 }, (_, index) => ({
      code: 'ABC123',
      gameId: 'game-1',
      event: score(`pending-${index}`),
      queuedAt,
    }));
    const before = JSON.stringify({
      version: 1,
      ownerAccountId: 'account-a',
      items,
      aliases: [],
      rejectedStarts: [],
    });
    await AsyncStorage.setItem(STORAGE_KEY, before);

    const stored = await enqueuePartyGameEvent('ABC123', 'game-1', score('overflow'));

    expect(stored).toBe(false);
    expect(sendPartyGameEvents).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(before);
    expect((await readQueue())[0].event.clientId).toBe('pending-0');
  });
});
