/* eslint-disable @typescript-eslint/no-require-imports, import/first -- Jest must install native-module mocks before loading the queue modules. */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const SESSION_OLD = {
  deviceId: 'device-a',
  accountId: 'account-a',
  token: 'expired-a',
  authenticated: true,
};
const SESSION_FRESH = {
  ...SESSION_OLD,
  token: 'fresh-a',
};

let mockCurrentSession = SESSION_FRESH;
const mockEnsureAccount = jest.fn(async () => mockCurrentSession);
jest.mock('../account', () => ({
  ensureAccount: (...args: unknown[]) => mockEnsureAccount(...(args as [])),
}));

const mockDeleteBeerPhotoByClientId: jest.Mock<Promise<boolean>, unknown[]> = jest.fn(
  async () => true,
);
jest.mock('../beerPhotosClient', () => ({
  deleteBeerPhotoByClientId: (...args: unknown[]) =>
    mockDeleteBeerPhotoByClientId(...args),
}));

import {
  clearBeerPhotoDeletionTombstones,
  completeBeerPhotoDeletionTombstone,
  loadBeerPhotoDeletionTombstones,
  queueBeerPhotoDeletionTombstone,
} from '../beerPhotoDeletionTombstones';
import {
  flushBeerPhotoDeletionsForAccountMerge,
  flushBeerPhotoDeletionsBeforeSessionEnd,
  forgetAllBeerPhotoDeletionSessions,
  getBeerPhotoDeletionSession,
  rekeyBeerPhotoDeletionsForAccountMerge,
  rememberBeerPhotoDeletionSession,
} from '../beerPhotoDeletionSync';

async function loadRows() {
  const loaded = await loadBeerPhotoDeletionTombstones();
  if (!loaded.ok) throw new Error('Expected readable tombstone storage.');
  return loaded.tombstones;
}

async function waitForCalls(count: number): Promise<void> {
  for (
    let attempt = 0;
    attempt < 50 && mockDeleteBeerPhotoByClientId.mock.calls.length < count;
    attempt += 1
  ) {
    await Promise.resolve();
  }
}

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await clearBeerPhotoDeletionTombstones();
  forgetAllBeerPhotoDeletionSessions();
  mockCurrentSession = SESSION_FRESH;
  mockEnsureAccount.mockImplementation(async () => mockCurrentSession);
  mockDeleteBeerPhotoByClientId.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

it('prefers the fresh current bearer over a stale captured bearer for the same account', async () => {
  await queueBeerPhotoDeletionTombstone('photo-1', SESSION_OLD.accountId);
  rememberBeerPhotoDeletionSession('photo-1', SESSION_OLD);

  const result = await flushBeerPhotoDeletionsBeforeSessionEnd({
    session: SESSION_OLD,
    deadlineMs: 500,
  });

  expect(result).toEqual({ attempted: 1, delivered: 1, remaining: 0, timedOut: false });
  expect(mockDeleteBeerPhotoByClientId).toHaveBeenCalledWith(
    'photo-1',
    expect.any(AbortSignal),
    expect.objectContaining({ accountId: 'account-a', token: 'fresh-a' }),
  );
});

it('durably rekeys anonymous markers and drops their revoked captured sessions', async () => {
  await queueBeerPhotoDeletionTombstone('photo-a1', 'anonymous-a');
  await queueBeerPhotoDeletionTombstone('photo-a2', 'anonymous-a');
  await queueBeerPhotoDeletionTombstone('photo-c', 'account-c');
  rememberBeerPhotoDeletionSession('photo-a1', {
    ...SESSION_OLD,
    accountId: 'anonymous-a',
  });

  await expect(
    rekeyBeerPhotoDeletionsForAccountMerge('anonymous-a', 'account-b'),
  ).resolves.toBe(true);

  expect(await loadRows()).toEqual(
    expect.arrayContaining([
      { clientId: 'photo-a1', accountId: 'account-b' },
      { clientId: 'photo-a2', accountId: 'account-b' },
      { clientId: 'photo-c', accountId: 'account-c' },
    ]),
  );
  expect(getBeerPhotoDeletionSession('photo-a1')).toBeUndefined();
});

it('keeps the anonymous marker and bearer recoverable when rekey persistence fails', async () => {
  await queueBeerPhotoDeletionTombstone('photo-a1', 'anonymous-a');
  const anonymousSession = { ...SESSION_OLD, accountId: 'anonymous-a' };
  rememberBeerPhotoDeletionSession('photo-a1', anonymousSession);
  const storageWrite = AsyncStorage.setItem as jest.MockedFunction<
    typeof AsyncStorage.setItem
  >;
  storageWrite.mockRejectedValueOnce(new Error('disk full'));

  await expect(
    rekeyBeerPhotoDeletionsForAccountMerge('anonymous-a', 'account-b'),
  ).resolves.toBe(false);
  expect(await loadRows()).toContainEqual({
    clientId: 'photo-a1',
    accountId: 'anonymous-a',
  });
  expect(getBeerPhotoDeletionSession('photo-a1')).toEqual(anonymousSession);

  await expect(
    rekeyBeerPhotoDeletionsForAccountMerge('anonymous-a', 'account-b'),
  ).resolves.toBe(true);
  expect(await loadRows()).toContainEqual({
    clientId: 'photo-a1',
    accountId: 'account-b',
  });
  expect(getBeerPhotoDeletionSession('photo-a1')).toBeUndefined();
});

it('caps parallel delivery and stops the whole flush at one short deadline', async () => {
  for (let index = 0; index < 7; index += 1) {
    await queueBeerPhotoDeletionTombstone(`photo-${index}`, SESSION_FRESH.accountId);
  }

  let active = 0;
  let maxActive = 0;
  mockDeleteBeerPhotoByClientId.mockImplementation(
    async (...args: unknown[]) =>
      new Promise<boolean>((resolve) => {
        const signal = args[1] as AbortSignal | undefined;
        active += 1;
        maxActive = Math.max(maxActive, active);
        const finish = () => {
          active -= 1;
          resolve(false);
        };
        if (signal?.aborted) finish();
        else signal?.addEventListener('abort', finish, { once: true });
      }),
  );
  jest.useFakeTimers();

  const flushing = flushBeerPhotoDeletionsBeforeSessionEnd({
    session: SESSION_FRESH,
    deadlineMs: 50,
  });
  await waitForCalls(3);

  expect(mockDeleteBeerPhotoByClientId).toHaveBeenCalledTimes(3);
  expect(maxActive).toBe(3);
  jest.advanceTimersByTime(50);

  await expect(flushing).resolves.toEqual({
    attempted: 3,
    delivered: 0,
    remaining: null,
    timedOut: true,
    storageError: true,
  });
  expect(mockDeleteBeerPhotoByClientId).toHaveBeenCalledTimes(3);
});

it('does not overwrite unknown markers when completion cannot read storage', async () => {
  await queueBeerPhotoDeletionTombstone('photo-1', 'account-a');
  await queueBeerPhotoDeletionTombstone('photo-2', 'account-a');
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<
    typeof AsyncStorage.removeItem
  >;
  const writesBefore = setItem.mock.calls.length;
  const removalsBefore = removeItem.mock.calls.length;
  getItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    completeBeerPhotoDeletionTombstone('photo-1', 'account-a'),
  ).resolves.toBe(false);

  expect(setItem).toHaveBeenCalledTimes(writesBefore);
  expect(removeItem).toHaveBeenCalledTimes(removalsBefore);
  expect(await loadRows()).toEqual(
    expect.arrayContaining([
      { clientId: 'photo-1', accountId: 'account-a' },
      { clientId: 'photo-2', accountId: 'account-a' },
    ]),
  );
});

it('fails closed when the initial strict tombstone read fails', async () => {
  await queueBeerPhotoDeletionTombstone('photo-1', SESSION_FRESH.accountId);
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    flushBeerPhotoDeletionsBeforeSessionEnd({
      session: SESSION_FRESH,
      preferProvidedSession: true,
    }),
  ).resolves.toEqual({
    attempted: 0,
    delivered: 0,
    remaining: null,
    timedOut: false,
    storageError: true,
  });
  expect(mockDeleteBeerPhotoByClientId).not.toHaveBeenCalled();
  expect(await loadRows()).toContainEqual({
    clientId: 'photo-1',
    accountId: SESSION_FRESH.accountId,
  });
});

it('keeps the marker and captured bearer when completion cannot read storage', async () => {
  await queueBeerPhotoDeletionTombstone('photo-1', SESSION_FRESH.accountId);
  rememberBeerPhotoDeletionSession('photo-1', SESSION_FRESH);
  const key = 'na-pivo-beer-photo-deletion-tombstones';
  const raw = await AsyncStorage.getItem(key);
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem
    .mockResolvedValueOnce(raw)
    .mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    flushBeerPhotoDeletionsBeforeSessionEnd({
      session: SESSION_FRESH,
      preferProvidedSession: true,
    }),
  ).resolves.toEqual({
    attempted: 1,
    delivered: 1,
    remaining: 1,
    timedOut: false,
  });
  expect(getBeerPhotoDeletionSession('photo-1')).toEqual(SESSION_FRESH);
  expect(await loadRows()).toContainEqual({
    clientId: 'photo-1',
    accountId: SESSION_FRESH.accountId,
  });
});

it('does not rewrite a partially invalid tombstone payload', async () => {
  const key = 'na-pivo-beer-photo-deletion-tombstones';
  const raw = JSON.stringify([
    { clientId: 'photo-1', accountId: 'anonymous-a' },
    { clientId: 'missing-account' },
  ]);
  await AsyncStorage.setItem(key, raw);

  await expect(
    rekeyBeerPhotoDeletionsForAccountMerge('anonymous-a', 'account-b'),
  ).resolves.toBe(false);

  expect(await AsyncStorage.getItem(key)).toBe(raw);
  await expect(loadBeerPhotoDeletionTombstones()).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});

it('uses incoming B directly and preserves the A recovery path when B rejects', async () => {
  const anonymousSession = {
    ...SESSION_OLD,
    accountId: 'anonymous-a',
    authenticated: false,
  };
  const incomingSession = {
    ...SESSION_FRESH,
    accountId: 'account-b',
    token: 'token-b',
  };
  await queueBeerPhotoDeletionTombstone('photo-a1', 'anonymous-a');
  rememberBeerPhotoDeletionSession('photo-a1', anonymousSession);
  mockDeleteBeerPhotoByClientId.mockResolvedValue(false);

  await expect(
    flushBeerPhotoDeletionsForAccountMerge(
      'anonymous-a',
      'account-b',
      incomingSession,
      { strictPreflightClean: true },
    ),
  ).resolves.toEqual({
    attempted: 1,
    delivered: 0,
    remaining: 1,
    timedOut: false,
  });

  expect(mockDeleteBeerPhotoByClientId).toHaveBeenCalledWith(
    'photo-a1',
    expect.any(AbortSignal),
    expect.objectContaining({ accountId: 'account-b', token: 'token-b' }),
  );
  expect(await loadRows()).toContainEqual({
    clientId: 'photo-a1',
    accountId: 'anonymous-a',
  });
  expect(getBeerPhotoDeletionSession('photo-a1')).toEqual(anonymousSession);
  await expect(
    flushBeerPhotoDeletionsBeforeSessionEnd({
      session: anonymousSession,
      preferProvidedSession: true,
    }),
  ).resolves.toEqual(
    expect.objectContaining({ delivered: 0, remaining: 1 }),
  );
});

it('delivers process-known late A markers after a clean preflight read becomes unavailable', async () => {
  await queueBeerPhotoDeletionTombstone('photo-a1', 'anonymous-a');
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    flushBeerPhotoDeletionsForAccountMerge(
      'anonymous-a',
      'account-b',
      { ...SESSION_FRESH, accountId: 'account-b', token: 'token-b' },
      { strictPreflightClean: true },
    ),
  ).resolves.toEqual({
    attempted: 1,
    delivered: 1,
    remaining: 0,
    timedOut: false,
    storageError: true,
  });
  expect(mockDeleteBeerPhotoByClientId).toHaveBeenCalledWith(
    'photo-a1',
    expect.any(AbortSignal),
    expect.objectContaining({ token: 'token-b' }),
  );
});

it('bounds a hanging strict storage read with the global deadline', async () => {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem.mockImplementationOnce(() => new Promise<string | null>(() => undefined));
  jest.useFakeTimers();

  const flushing = flushBeerPhotoDeletionsBeforeSessionEnd({
    session: SESSION_FRESH,
    preferProvidedSession: true,
    deadlineMs: 50,
  });
  jest.advanceTimersByTime(50);

  await expect(flushing).resolves.toEqual({
    attempted: 0,
    delivered: 0,
    remaining: null,
    timedOut: true,
    storageError: true,
  });
});
