import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PartyGame } from '../partyGamesClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockCurrentAccountId = 'account-a';
const ensureAccount = jest.fn(async (signal?: AbortSignal) =>
  signal?.aborted
    ? null
    : { deviceId: 'device', accountId: mockCurrentAccountId, token: 'token' },
);
jest.mock('../account', () => ({
  ensureAccount: (...args: unknown[]) => ensureAccount(...(args as [])),
  generateUuidV4: () => '1420e4ef-104a-4ede-905b-3ec8bd98b0c7',
}));

const startPartyGame: jest.Mock = jest.fn();
const sendPartyGameEvents: jest.Mock = jest.fn();
jest.mock('../partyGamesClient', () => ({
  startPartyGame: (...args: unknown[]) => startPartyGame(...(args as [])),
  sendPartyGameEvents: (...args: unknown[]) => sendPartyGameEvents(...(args as [])),
  isRetriablePartyGamesError: jest.requireActual('../partyGamesClient')
    .isRetriablePartyGamesError,
}));

const {
  cancelUncommittedPartyGameAccountMerge,
  clearPartyGameStartsQueue,
  enqueuePartyGameStart,
  finalizePartyGameQueuesForAccountMerge,
  flushPartyGameStartsQueue,
  loadPendingPartyGameRuntime,
  preflightPartyGameQueuesForAccountMerge,
  promotePartyGameQueuesAccountMerge,
} = jest.requireActual('../partyGameStartsQueue') as typeof import('../partyGameStartsQueue');
const {
  clearPartyGamesQueue,
  enqueuePartyGameEvent,
  flushPartyGamesQueue,
  loadQueuedPartyGameEvents,
} = jest.requireActual('../partyGamesQueue') as typeof import('../partyGamesQueue');

const STARTS_KEY = 'na-pivo-party-game-starts-queue';
const EVENTS_KEY = 'na-pivo-party-games-queue';
const MERGE_KEY = 'na-pivo-party-games-account-merge';
const EVENTS_QUARANTINE_KEY = 'na-pivo-party-games-queue-quarantine-v1';
const OPERATION_ID = '1420e4ef-104a-4ede-905b-3ec8bd98b0c7';
const CLIENT_ID = '8ea4574a-b9bc-4f3f-9b23-df09fe4891a3';
const GAME: PartyGame = {
  seed: 1,
  id: 'server-game-1',
  catalogKey: 'quiz',
  name: 'Pub kvíz',
  scoring: 'points',
  startedBy: { id: 'me', nickname: 'ja', displayName: 'Já', avatarUrl: null },
  roster: [
    { id: 'me', nickname: 'ja', displayName: 'Já', avatarUrl: null },
    { id: 'guest', nickname: 'host', displayName: 'Host', avatarUrl: null },
  ],
  startedAt: '2026-08-07T00:00:00.000Z',
  endedAt: null,
};

async function eventState(): Promise<{
  items: { gameId: string; event: { clientId: string } }[];
  aliases: { localGameId: string; serverGameId: string }[];
}> {
  const raw = await AsyncStorage.getItem(EVENTS_KEY);
  if (!raw) return { items: [], aliases: [] };
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? { items: parsed, aliases: [] } : parsed;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockCurrentAccountId = 'account-a';
  await AsyncStorage.clear();
  await clearPartyGamesQueue();
  await clearPartyGameStartsQueue();
  sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 2, accepted: [] });
});

it('rehydrates an offline lobby and its queued gameplay after process death', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: 'Bez signálu.' });
  sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: 'Bez signálu.' });
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['me', 'guest'],
  });
  await ticket!.delivery;
  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'offline-answer',
    kind: 'answer',
    payload: { questionId: 'q1', option: 2 },
    createdAt: '2026-08-07T20:00:00.000Z',
  });

  await expect(loadPendingPartyGameRuntime('pivoxy', 'quiz')).resolves.toEqual({
    localGameId: ticket!.localGameId,
    rosterIds: ['me', 'guest'],
  });
  await expect(
    loadQueuedPartyGameEvents('PIVOXY', [ticket!.localGameId]),
  ).resolves.toEqual([
    expect.objectContaining({
      gameId: ticket!.localGameId,
      event: expect.objectContaining({ clientId: 'offline-answer' }),
    }),
  ]);
});

it('remaps an in-flight start and preserves its queued answer and finish', async () => {
  let resolveStart!: (result: { ok: true; game: PartyGame }) => void;
  startPartyGame.mockImplementationOnce(
    () => new Promise((resolve) => {
      resolveStart = resolve;
    }),
  );

  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    scoring: 'points',
    rosterIds: ['me', 'guest'],
  });
  expect(ticket?.localGameId).toBe(`local:${CLIENT_ID}`);
  expect(JSON.parse((await AsyncStorage.getItem(STARTS_KEY)) ?? '{}').items[0].input.rosterIds)
    .toEqual(['me', 'guest']);

  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'answer-1',
    kind: 'answer',
    payload: { questionId: 'q-plzen', option: 2 },
  });
  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'finish-1',
    kind: 'finish',
    payload: { winner: 'Host', scores: [{ name: 'Host', score: 4 }] },
  });

  expect(sendPartyGameEvents).not.toHaveBeenCalled();
  expect((await eventState()).items).toHaveLength(2);

  resolveStart({ ok: true, game: GAME });
  await ticket!.delivery;

  expect(sendPartyGameEvents).toHaveBeenCalledWith(
    'PIVOXY',
    'server-game-1',
    [
      {
        clientId: 'answer-1',
        kind: 'answer',
        payload: { questionId: 'q-plzen', option: 2 },
      },
      {
        clientId: 'finish-1',
        kind: 'finish',
        payload: { winner: 'Host', scores: [{ name: 'Host', score: 4 }] },
      },
    ],
    expect.any(AbortSignal),
    'account-a',
  );
  expect((await eventState()).items).toEqual([]);
  expect((await eventState()).aliases).toEqual([
    expect.objectContaining({
      localGameId: `local:${CLIENT_ID}`,
      serverGameId: 'server-game-1',
    }),
  ]);
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBeNull();

  // The screen can still render one frame with its local id after the remap.
  // The persisted alias must translate that late tap even after a cold module
  // restart, when no in-memory callback exists.
  sendPartyGameEvents.mockResolvedValueOnce({ ok: false, code: 'network', detail: '' });
  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'late-answer',
    kind: 'answer',
    payload: { questionId: 'q-chmel', option: 0 },
  });
  expect((await eventState()).items).toEqual([
    expect.objectContaining({
      gameId: 'server-game-1',
      event: expect.objectContaining({ clientId: 'late-answer' }),
    }),
  ]);

  sendPartyGameEvents.mockResolvedValue({ ok: true, cursor: 3, accepted: [] });
  await flushPartyGamesQueue();
  expect((await eventState()).items).toEqual([]);
});

it('cannot remap or send an old account start after the account boundary', async () => {
  let resolveStart!: (result: { ok: true; game: PartyGame }) => void;
  startPartyGame.mockImplementationOnce(
    () => new Promise((resolve) => {
      resolveStart = resolve;
    }),
  );
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['me', 'guest'],
  });
  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'answer-old-account',
    kind: 'answer',
    payload: { questionId: 'q-plzen', option: 1 },
  });

  await Promise.all([clearPartyGamesQueue(), clearPartyGameStartsQueue()]);
  resolveStart({ ok: true, game: GAME });
  await ticket!.delivery;

  expect(sendPartyGameEvents).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(EVENTS_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBeNull();
});

it('accounts for local gameplay when the server permanently rejects its start', async () => {
  let resolveStart!: (result: { ok: false; code: string; detail: string }) => void;
  startPartyGame.mockImplementationOnce(
    () => new Promise((resolve) => {
      resolveStart = resolve;
    }),
  );
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['account-a', 'guest'],
  });
  sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'answer-that-cannot-land',
    kind: 'answer',
    payload: { questionId: 'q1', option: 0 },
  });

  resolveStart({ ok: false, code: 'roster_member_not_active', detail: 'Host odešel.' });
  await expect(ticket!.delivery).resolves.toEqual({
    ok: false,
    permanent: true,
    code: 'roster_member_not_active',
    detail: 'Host odešel.',
    discardedEvents: 1,
  });
  const rejected = JSON.parse((await AsyncStorage.getItem(EVENTS_KEY))!);
  expect(rejected.items).toEqual([]);
  expect(rejected.rejectedStarts).toEqual([
    expect.objectContaining({
      localGameId: ticket!.localGameId,
      errorCode: 'roster_member_not_active',
    }),
  ]);
  await expect(
    enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
      clientId: 'late-answer-after-rejection',
      kind: 'answer',
    }),
  ).resolves.toBe(false);
  expect(JSON.parse((await AsyncStorage.getItem(EVENTS_KEY))!).items).toEqual([]);
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBeNull();
});

it('keeps A bytes frozen until setSession succeeds, then atomically rekeys for B', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['account-a', 'account-b', 'guest'],
  });
  await ticket!.delivery;
  sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'score-a',
    kind: 'score',
    subjectId: 'account-a',
    delta: 1,
  });
  const eventsBefore = JSON.parse((await AsyncStorage.getItem(EVENTS_KEY))!);
  eventsBefore.aliases.push({
    code: 'PIVOXY',
    localGameId: ticket!.localGameId,
    serverGameId: 'server-game-1',
    resolvedAt: Date.now(),
  });
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(eventsBefore));
  const startsBefore = await AsyncStorage.getItem(STARTS_KEY);
  const eventsRawBefore = await AsyncStorage.getItem(EVENTS_KEY);

  await expect(
    preflightPartyGameQueuesForAccountMerge('account-a'),
  ).resolves.toEqual({ operationId: OPERATION_ID, cancelSafe: true });
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBe(startsBefore);
  expect(await AsyncStorage.getItem(EVENTS_KEY)).toBe(eventsRawBefore);
  expect(JSON.parse((await AsyncStorage.getItem(MERGE_KEY))!)).toMatchObject({
    operationId: OPERATION_ID,
    fromAccountId: 'account-a',
    toAccountId: null,
  });

  await expect(
    promotePartyGameQueuesAccountMerge('account-a', 'account-b', OPERATION_ID),
  ).resolves.toBe(true);

  mockCurrentAccountId = 'account-b';
  await expect(
    finalizePartyGameQueuesForAccountMerge('account-a', 'account-b', OPERATION_ID),
  ).resolves.toBe(true);

  const starts = JSON.parse((await AsyncStorage.getItem(STARTS_KEY))!);
  const events = JSON.parse((await AsyncStorage.getItem(EVENTS_KEY))!);
  expect(starts.ownerAccountId).toBe('account-b');
  expect(starts.items[0].input.rosterIds).toEqual(['account-b', 'guest']);
  expect(events.ownerAccountId).toBe('account-b');
  expect(events.items[0].event.subjectId).toBe('account-b');
  expect(events.aliases).toEqual(eventsBefore.aliases);
  expect(await AsyncStorage.getItem(MERGE_KEY)).toBeNull();
});

it('leaves both queue snapshots frozen when phase-two persistence fails', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['account-a', 'guest'],
  });
  await ticket!.delivery;
  sendPartyGameEvents.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  await enqueuePartyGameEvent('PIVOXY', ticket!.localGameId, {
    clientId: 'answer-a',
    kind: 'answer',
  });
  const startsBefore = await AsyncStorage.getItem(STARTS_KEY);
  const eventsBefore = await AsyncStorage.getItem(EVENTS_KEY);
  await expect(
    preflightPartyGameQueuesForAccountMerge('account-a'),
  ).resolves.toEqual({ operationId: OPERATION_ID, cancelSafe: true });
  await expect(
    promotePartyGameQueuesAccountMerge('account-a', 'account-b', OPERATION_ID),
  ).resolves.toBe(true);
  mockCurrentAccountId = 'account-b';
  (AsyncStorage.multiSet as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

  await expect(
    finalizePartyGameQueuesForAccountMerge('account-a', 'account-b', OPERATION_ID),
  ).resolves.toBe(false);
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBe(startsBefore);
  expect(await AsyncStorage.getItem(EVENTS_KEY)).toBe(eventsBefore);
  expect(await AsyncStorage.getItem(MERGE_KEY)).not.toBeNull();
});

it('keeps A frozen after setSession failure and lets the same login resume', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['account-a', 'guest'],
  });
  await ticket!.delivery;
  const startsBefore = await AsyncStorage.getItem(STARTS_KEY);
  await preflightPartyGameQueuesForAccountMerge('account-a');
  await promotePartyGameQueuesAccountMerge('account-a', 'account-b', OPERATION_ID);

  startPartyGame.mockClear();
  await flushPartyGameStartsQueue();

  expect(startPartyGame).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBe(startsBefore);
  await expect(
    preflightPartyGameQueuesForAccountMerge('account-a'),
  ).resolves.toEqual({ operationId: OPERATION_ID, cancelSafe: false });
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBe(startsBefore);
  expect(await AsyncStorage.getItem(MERGE_KEY)).not.toBeNull();
});

it('cold boot as B finalizes the intent before flushing A work', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['account-a', 'guest'],
  });
  await ticket!.delivery;
  await preflightPartyGameQueuesForAccountMerge('account-a');
  await promotePartyGameQueuesAccountMerge('account-a', 'account-b', OPERATION_ID);

  mockCurrentAccountId = 'account-b';
  startPartyGame.mockClear();
  startPartyGame.mockResolvedValue({ ok: true, game: GAME });
  await flushPartyGameStartsQueue();

  expect(startPartyGame).toHaveBeenCalledWith(
    'PIVOXY',
    expect.objectContaining({ rosterIds: ['account-b', 'guest'] }),
    expect.any(AbortSignal),
    'account-b',
  );
  expect(await AsyncStorage.getItem(MERGE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBeNull();
});

it('persists phase zero before auth and keeps source-only response loss frozen', async () => {
  startPartyGame.mockResolvedValue({ ok: false, code: 'network', detail: '' });
  const ticket = await enqueuePartyGameStart('PIVOXY', {
    clientId: CLIENT_ID,
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    rosterIds: ['account-a', 'guest'],
  });
  await ticket!.delivery;
  const startsBefore = await AsyncStorage.getItem(STARTS_KEY);
  const authFetch = jest.fn();
  if (await preflightPartyGameQueuesForAccountMerge('account-a')) authFetch();
  expect(authFetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem(MERGE_KEY))!)).toMatchObject({
    fromAccountId: 'account-a',
    toAccountId: null,
  });

  // A network/response-loss outcome cannot prove whether the server committed.
  // A cold retry keeps the exact A queue frozen and reuses the durable intent.
  startPartyGame.mockClear();
  await flushPartyGameStartsQueue();
  expect(startPartyGame).not.toHaveBeenCalled();
  await expect(
    preflightPartyGameQueuesForAccountMerge('account-a'),
  ).resolves.toEqual({ operationId: OPERATION_ID, cancelSafe: false });
  expect(await AsyncStorage.getItem(STARTS_KEY)).toBe(startsBefore);
});

it('blocks auth before fetch when the phase-zero intent cannot be persisted', async () => {
  const authFetch = jest.fn();
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

  if (await preflightPartyGameQueuesForAccountMerge('account-a')) authFetch();

  expect(authFetch).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(MERGE_KEY)).toBeNull();
});

it('cancels only an uncommitted phase-zero intent after a definitive 4xx', async () => {
  const first = await preflightPartyGameQueuesForAccountMerge('account-a');
  expect(first).toEqual({ operationId: OPERATION_ID, cancelSafe: true });

  await expect(
    cancelUncommittedPartyGameAccountMerge('account-a', OPERATION_ID),
  ).resolves.toBe(true);
  expect(await AsyncStorage.getItem(MERGE_KEY)).toBeNull();

  await preflightPartyGameQueuesForAccountMerge('account-a');
  await promotePartyGameQueuesAccountMerge('account-a', 'account-b', OPERATION_ID);
  await expect(
    cancelUncommittedPartyGameAccountMerge('account-a', OPERATION_ID),
  ).resolves.toBe(false);
  expect(await AsyncStorage.getItem(MERGE_KEY)).not.toBeNull();
});

it('quarantines a released ownerless queue instead of adopting it for the current account', async () => {
  const legacyRaw = JSON.stringify([
    {
      code: 'PIVOXY',
      gameId: 'server-old-account-game',
      event: { clientId: 'old-account-score', kind: 'score', delta: 1 },
      queuedAt: Date.now(),
    },
  ]);
  await AsyncStorage.setItem(EVENTS_KEY, legacyRaw);
  sendPartyGameEvents.mockResolvedValueOnce({ ok: false, code: 'network', detail: '' });

  await expect(
    enqueuePartyGameEvent('PIVOXY', 'server-current-account-game', {
      clientId: 'current-account-score',
      kind: 'score',
      delta: 1,
    }),
  ).resolves.toBe(true);

  expect(JSON.parse((await AsyncStorage.getItem(EVENTS_QUARANTINE_KEY))!).entries)
    .toEqual([expect.objectContaining({ raw: legacyRaw, reason: 'ownerless' })]);
  const active = JSON.parse((await AsyncStorage.getItem(EVENTS_KEY))!);
  expect(active.ownerAccountId).toBe('account-a');
  expect(active.items).toEqual([
    expect.objectContaining({
      gameId: 'server-current-account-game',
      event: expect.objectContaining({ clientId: 'current-account-score' }),
    }),
  ]);
  expect(sendPartyGameEvents).not.toHaveBeenCalledWith(
    'PIVOXY',
    'server-old-account-game',
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
});

it('quarantines ownerless bytes before phase zero and never rekeys them to the auth target', async () => {
  const legacyRaw = JSON.stringify([
    {
      code: 'PIVOXY',
      gameId: 'server-unknown-owner-game',
      event: { clientId: 'unknown-owner-answer', kind: 'answer' },
      queuedAt: Date.now(),
    },
  ]);
  await AsyncStorage.setItem(EVENTS_KEY, legacyRaw);

  const preflight = await preflightPartyGameQueuesForAccountMerge('account-a');

  expect(preflight).toEqual({ operationId: OPERATION_ID, cancelSafe: true });
  expect(JSON.parse((await AsyncStorage.getItem(EVENTS_QUARANTINE_KEY))!).entries)
    .toEqual([expect.objectContaining({ raw: legacyRaw, reason: 'ownerless' })]);
  expect(await AsyncStorage.getItem(EVENTS_KEY)).toBeNull();
  await expect(
    promotePartyGameQueuesAccountMerge('account-a', 'account-b', OPERATION_ID),
  ).resolves.toBe(true);
  mockCurrentAccountId = 'account-b';
  await expect(
    finalizePartyGameQueuesForAccountMerge('account-a', 'account-b', OPERATION_ID),
  ).resolves.toBe(true);
  expect(await AsyncStorage.getItem(EVENTS_KEY)).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(EVENTS_QUARANTINE_KEY))!).entries)
    .toEqual([expect.objectContaining({ raw: legacyRaw, reason: 'ownerless' })]);
});
