import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockCurrentAccountId = 'account-a';
const ensureAccount: jest.Mock = jest.fn(async (signal?: AbortSignal) =>
  signal?.aborted
    ? null
    : { deviceId: 'device', accountId: mockCurrentAccountId, token: 'token' },
);
jest.mock('../account', () => ({
  ensureAccount: (...args: unknown[]) => ensureAccount(...(args as [])),
}));

const startPartyGame: jest.Mock = jest.fn();
const sendPartyGameEvents: jest.Mock = jest.fn();
jest.mock('../partyGamesClient', () => ({
  startPartyGame: (...args: unknown[]) => startPartyGame(...(args as [])),
  sendPartyGameEvents: (...args: unknown[]) => sendPartyGameEvents(...(args as [])),
  isRetriablePartyGamesError: jest.requireActual('../partyGamesClient')
    .isRetriablePartyGamesError,
}));

import {
  clearPartyGameStartsQueue,
  enqueuePartyGameStart,
  flushPartyGameStartsQueue,
} from '../partyGameStartsQueue';
import type { PartyGame, PartyGameStartInput } from '../partyGamesClient';

const STORAGE_KEY = 'na-pivo-party-game-starts-queue';
const QUARANTINE_KEY = 'na-pivo-party-game-starts-queue-quarantine-v1';
const INPUT: PartyGameStartInput = {
  clientId: '8ea4574a-b9bc-4f3f-9b23-df09fe4891a3',
  catalogKey: 'quiz',
  name: 'Pub kvíz',
  scoring: 'points',
  rosterIds: ['me', 'guest'],
};
const GAME: PartyGame = {
  seed: 1,
  id: 'game-1',
  catalogKey: 'quiz',
  name: 'Pub kvíz',
  scoring: 'points',
  startedBy: { id: 'me', nickname: 'ja', displayName: 'Já', avatarUrl: null },
  roster: [
    { id: 'me', nickname: 'ja', displayName: 'Já', avatarUrl: null },
    { id: 'guest', nickname: 'guest', displayName: 'Host', avatarUrl: null },
  ],
  startedAt: '2026-08-06T19:00:00.000Z',
  endedAt: null,
};

async function queue(): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw).items : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockCurrentAccountId = 'account-a';
  await AsyncStorage.clear();
  await clearPartyGameStartsQueue();
  startPartyGame.mockResolvedValue({ ok: true, game: GAME });
  sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 1, accepted: [] });
});

it('persists a table game before a failed first delivery and retries it', async () => {
  startPartyGame.mockResolvedValueOnce({ ok: false, code: 'network', detail: '' });

  const ticket = await enqueuePartyGameStart('PIVOXY', INPUT);
  expect(ticket?.localGameId).toBe(`local:${INPUT.clientId}`);
  expect(await ticket?.delivery).toMatchObject({ ok: false, permanent: false });
  expect(await queue()).toHaveLength(1);

  await flushPartyGameStartsQueue();

  expect(startPartyGame).toHaveBeenLastCalledWith(
    'PIVOXY',
    INPUT,
    expect.any(AbortSignal),
    'account-a',
  );
  expect(await queue()).toHaveLength(0);
});

it('deduplicates the same catalogue game while it is offline', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const first = await enqueuePartyGameStart('PIVOXY', INPUT);
  const second = await enqueuePartyGameStart('PIVOXY', { ...INPUT, clientId: 'another-id' });
  await Promise.all([first?.delivery, second?.delivery]);

  const stored = await queue();
  expect(stored).toHaveLength(1);
  expect(second?.localGameId).toBe(`local:${INPUT.clientId}`);
  expect(startPartyGame).toHaveBeenLastCalledWith(
    'PIVOXY',
    INPUT,
    expect.any(AbortSignal),
    'account-a',
  );
});

it('keeps offline placement and later roster binding as ordered durable phases', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const placement = await enqueuePartyGameStart('PIVOXY', {
    ...INPUT,
    clientId: 'placement-id',
    rosterIds: [],
  });
  await placement?.delivery;
  const binding = await enqueuePartyGameStart('PIVOXY', {
    ...INPUT,
    clientId: 'binding-id',
    rosterIds: ['me', 'guest'],
  });
  await binding?.delivery;

  expect(await queue()).toEqual([
    expect.objectContaining({
      input: expect.objectContaining({ clientId: 'placement-id', rosterIds: [] }),
    }),
    expect.objectContaining({
      input: expect.objectContaining({
        clientId: 'binding-id',
        rosterIds: ['me', 'guest'],
      }),
    }),
  ]);

  startPartyGame
    .mockResolvedValueOnce({ ok: true, game: { ...GAME, roster: [] } })
    .mockResolvedValueOnce({ ok: true, game: GAME });
  await flushPartyGameStartsQueue();

  expect(startPartyGame.mock.calls.slice(-2).map((call) => call[1].rosterIds)).toEqual([
    [],
    ['me', 'guest'],
  ]);
  expect(await queue()).toHaveLength(0);
});

it('drops a request the server will never accept', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'http_400', detail: '' });

  const ticket = await enqueuePartyGameStart('PIVOXY', INPUT);
  await expect(ticket?.delivery).resolves.toMatchObject({
    ok: false,
    permanent: true,
    code: 'http_400',
  });

  expect(await queue()).toHaveLength(0);
});

it('does not start on the network until its local correlation is durable', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

  const ticket = await enqueuePartyGameStart('PIVOXY', INPUT);

  expect(ticket).toBeNull();
  expect(startPartyGame).not.toHaveBeenCalled();
});

it('preserves an unreadable start in quarantine and recovers a fresh owner queue', async () => {
  await AsyncStorage.setItem(STORAGE_KEY, '{broken');
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });

  const ticket = await enqueuePartyGameStart('PIVOXY', INPUT);
  await ticket?.delivery;

  expect(ticket).not.toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY))!).entries).toEqual([
    expect.objectContaining({ raw: '{broken', reason: 'corrupt' }),
  ]);
  expect(await queue()).toEqual([
    expect.objectContaining({ input: expect.objectContaining({ clientId: INPUT.clientId }) }),
  ]);
});

it.each([
  ['oversized code', 'ABCDEFGHIJKLMNOPQ', INPUT],
  [
    'oversized roster',
    'PIVOXY',
    { ...INPUT, rosterIds: Array.from({ length: 65 }, (_, index) => `account-${index}`) },
  ],
])('rejects an %s before persistence', async (_label, code, input) => {
  const ticket = await enqueuePartyGameStart(code, input);

  expect(ticket).toBeNull();
  expect(startPartyGame).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
});

it('rejects overflow without evicting the oldest accepted start', async () => {
  const items = Array.from({ length: 64 }, (_, index) => ({
    code: 'PIVOXY',
    input: {
      ...INPUT,
      clientId: `pending-${index}`,
      catalogKey: `catalog-${index}`,
    },
    queuedAt: Date.now(),
  }));
  const before = JSON.stringify({
    version: 1,
    ownerAccountId: 'account-a',
    items,
  });
  await AsyncStorage.setItem(STORAGE_KEY, before);

  const ticket = await enqueuePartyGameStart('PIVOXY', {
    ...INPUT,
    clientId: 'overflow',
    catalogKey: 'overflow',
  });

  expect(ticket).toBeNull();
  expect(startPartyGame).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(before);
  expect((await queue())[0]).toMatchObject({ input: { clientId: 'pending-0' } });
});

it('never flushes an account A start with account B after a cold restart', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const ticket = await enqueuePartyGameStart('PIVOXY', INPUT);
  await ticket?.delivery;
  const persisted = await AsyncStorage.getItem(STORAGE_KEY);
  expect(JSON.parse(persisted!).ownerAccountId).toBe('account-a');

  mockCurrentAccountId = 'account-b';
  startPartyGame.mockClear();
  startPartyGame.mockResolvedValue({ ok: true, game: GAME });
  await flushPartyGameStartsQueue();

  expect(startPartyGame).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(persisted);
});

it('aborts before bearer acquisition can cross an account boundary', async () => {
  let resolveAccount!: (session: {
    deviceId: string;
    accountId: string;
    token: string;
  }) => void;
  ensureAccount.mockImplementationOnce(
    () => new Promise((resolve) => {
      resolveAccount = resolve;
    }),
  );

  const pending = enqueuePartyGameStart('PIVOXY', INPUT);
  await Promise.resolve();
  await clearPartyGameStartsQueue();
  resolveAccount({ deviceId: 'device', accountId: 'account-a', token: 'token-a' });

  await expect(pending).resolves.toBeNull();
  expect(startPartyGame).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
});
