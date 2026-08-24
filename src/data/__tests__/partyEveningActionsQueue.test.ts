import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearPartyEveningActionsQueue,
  enqueuePartyEveningAction,
  flushPartyEveningActionsQueue,
  PARTY_EVENING_ACTIONS_STORAGE_KEY,
} from '../partyEveningActionsQueue';
import { PARTY_EVENING_IDENTITY_STORAGE_KEY } from '../partyEveningIdentityCache';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const endPartyEvening: jest.Mock = jest.fn();
const leavePartyEvening: jest.Mock = jest.fn();
jest.mock('../partyClient', () => ({
  endPartyEvening: (...args: unknown[]) => endPartyEvening(...(args as [])),
  leavePartyEvening: (...args: unknown[]) => leavePartyEvening(...(args as [])),
  isRetriablePartyError: (error: { code: string }) =>
    ['offline', 'network', 'account', 'auth', 'http_500', 'http_429'].includes(error.code),
}));

async function stored(): Promise<unknown[]> {
  const value = await AsyncStorage.getItem(PARTY_EVENING_ACTIONS_STORAGE_KEY);
  return value ? JSON.parse(value) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await clearPartyEveningActionsQueue();
  endPartyEvening.mockResolvedValue({ ok: true, evening: { id: 'ended' } });
  leavePartyEvening.mockResolvedValue({ ok: true });
});

it('persists an offline end before accepting it and retries on foreground', async () => {
  await AsyncStorage.setItem(
    PARTY_EVENING_IDENTITY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      accountId: 'account-a',
      id: 'evening-1',
      joinCode: 'PJVQXY',
      isHost: true,
      confirmedAt: Date.now(),
    }),
  );
  endPartyEvening.mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Síť.' });

  await expect(enqueuePartyEveningAction('end', 'PJVQXY')).resolves.toEqual({
    accepted: true,
    completed: false,
  });
  expect(await stored()).toHaveLength(1);
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).not.toBeNull();

  await flushPartyEveningActionsQueue();

  expect(endPartyEvening).toHaveBeenLastCalledWith('PJVQXY', expect.any(AbortSignal));
  expect(await stored()).toEqual([]);
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).toBeNull();
});

it('keeps an end queued while credentials are temporarily unavailable', async () => {
  endPartyEvening.mockResolvedValueOnce({ ok: false, code: 'auth', detail: 'Přihlas se.' });

  await expect(enqueuePartyEveningAction('end', 'PJVQXY')).resolves.toEqual({
    accepted: true,
    completed: false,
  });
  expect(await stored()).toHaveLength(1);

  await flushPartyEveningActionsQueue();

  expect(await stored()).toEqual([]);
});

it('queues leave separately and treats an already-gone table as completed', async () => {
  leavePartyEvening.mockResolvedValue({
    ok: false,
    code: 'party_not_found',
    detail: 'Pryč.',
  });

  await expect(enqueuePartyEveningAction('leave', 'PJVQXY')).resolves.toEqual({
    accepted: true,
    completed: true,
  });
  expect(await stored()).toEqual([]);
});

it('does not hide a permanent authorization failure behind the queue', async () => {
  endPartyEvening.mockResolvedValue({
    ok: false,
    code: 'not_host',
    detail: 'Jen hostitel.',
  });

  await expect(enqueuePartyEveningAction('end', 'PJVQXY')).resolves.toEqual({
    accepted: false,
    error: { ok: false, code: 'not_host', detail: 'Jen hostitel.' },
  });
  expect(await stored()).toEqual([]);
});
