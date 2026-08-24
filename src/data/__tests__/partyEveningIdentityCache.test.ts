import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearPartyEveningIdentityCache,
  clearPartyEveningIdentityForAccount,
  clearPartyEveningIdentityForCode,
  loadPartyEveningIdentity,
  PARTY_EVENING_IDENTITY_STORAGE_KEY,
  PARTY_EVENING_IDENTITY_TTL_MS,
  partyEveningIdentityGeneration,
  rekeyPartyEveningIdentityOwner,
  savePartyEveningIdentity,
} from '../partyEveningIdentityCache';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const EVENING = { id: 'evening-1', joinCode: 'PIVOXY', isHost: true };

beforeEach(async () => {
  resetPrivateAccountBoundaryForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  resetPrivateAccountBoundaryForTests();
});

it('round-trips only the minimal identity for the matching account', async () => {
  const now = Date.UTC(2026, 7, 6, 20);
  await savePartyEveningIdentity('account-a', EVENING, undefined, now);

  expect(await loadPartyEveningIdentity('account-a', now + 1_000)).toEqual({
    ...EVENING,
    confirmedAt: now,
  });

  const raw = JSON.parse(
    (await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)) as string,
  );
  expect(raw).toEqual({ version: 1, accountId: 'account-a', ...EVENING, confirmedAt: now });
  expect(raw).not.toHaveProperty('members');
  expect(raw).not.toHaveProperty('events');
  expect(raw).not.toHaveProperty('pubName');

  expect(await loadPartyEveningIdentity('account-b', now + 1_000)).toBeNull();
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).toBeNull();
});

it('expires and removes a server confirmation after 24 hours', async () => {
  const now = Date.UTC(2026, 7, 6, 20);
  await savePartyEveningIdentity('account-a', EVENING, undefined, now);

  expect(
    await loadPartyEveningIdentity(
      'account-a',
      now + PARTY_EVENING_IDENTITY_TTL_MS + 1,
    ),
  ).toBeNull();
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).toBeNull();
});

it('clears confirmed none by account and confirmed end or leave by code', async () => {
  await savePartyEveningIdentity('account-a', EVENING);
  await clearPartyEveningIdentityForAccount('account-b');
  expect(await loadPartyEveningIdentity('account-a')).not.toBeNull();

  await clearPartyEveningIdentityForCode('pivoxy');
  expect(await loadPartyEveningIdentity('account-a')).toBeNull();
});

it('reports a failed durable clear and succeeds on the exact retry', async () => {
  await savePartyEveningIdentity('account-a', EVENING);
  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<
    typeof AsyncStorage.removeItem
  >;
  removeItem.mockRejectedValueOnce(new Error('disk full'));

  await expect(clearPartyEveningIdentityForAccount('account-a')).resolves.toBe(false);
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).not.toBeNull();

  await expect(clearPartyEveningIdentityForAccount('account-a')).resolves.toBe(true);
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).toBeNull();
});

it('rekeys an active anonymous table to the claimed account and accepts an exact retry', async () => {
  const now = Date.UTC(2026, 7, 6, 20);
  await savePartyEveningIdentity('account-a', EVENING, undefined, now);

  const transition = beginPrivateAccountTransition('claim', 'account-a');
  expect(transition).not.toBeNull();
  await transition!.drain();
  await expect(
    rekeyPartyEveningIdentityOwner('account-a', 'account-b'),
  ).resolves.toBe(true);
  transition!.release();

  expect(await loadPartyEveningIdentity('account-b', now + 1_000)).toEqual({
    ...EVENING,
    confirmedAt: now,
  });

  const retry = beginPrivateAccountTransition('claim-retry', 'account-b');
  expect(retry).not.toBeNull();
  await retry!.drain();
  await expect(
    rekeyPartyEveningIdentityOwner('account-a', 'account-b'),
  ).resolves.toBe(true);
  retry!.release();
});

it('reports a failed rekey without publishing the table under the claimed account', async () => {
  const now = Date.UTC(2026, 7, 6, 20);
  await savePartyEveningIdentity('account-a', EVENING, undefined, now);
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async () => undefined);

  const transition = beginPrivateAccountTransition('claim', 'account-a');
  expect(transition).not.toBeNull();
  await transition!.drain();
  await expect(
    rekeyPartyEveningIdentityOwner('account-a', 'account-b'),
  ).resolves.toBe(false);
  transition!.release();

  const raw = JSON.parse(
    (await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)) as string,
  );
  expect(raw.accountId).toBe('account-a');
});

it('refuses to rekey a table owned by an unrelated account', async () => {
  await savePartyEveningIdentity('account-c', EVENING);

  const transition = beginPrivateAccountTransition('claim', 'account-a');
  expect(transition).not.toBeNull();
  await transition!.drain();
  await expect(
    rekeyPartyEveningIdentityOwner('account-a', 'account-b'),
  ).resolves.toBe(false);
  transition!.release();

  const raw = JSON.parse(
    (await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)) as string,
  );
  expect(raw.accountId).toBe('account-c');
});

it('suppresses a late pre-reset write after the account boundary moves', async () => {
  const oldGeneration = partyEveningIdentityGeneration();
  await clearPartyEveningIdentityCache();

  await expect(
    savePartyEveningIdentity('account-a', EVENING, oldGeneration),
  ).resolves.toBeNull();
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).toBeNull();
});

it('drops malformed private storage instead of trusting its code', async () => {
  await AsyncStorage.setItem(
    PARTY_EVENING_IDENTITY_STORAGE_KEY,
    JSON.stringify({ version: 1, accountId: 'account-a', id: 'e1', joinCode: '../bad' }),
  );

  expect(await loadPartyEveningIdentity('account-a')).toBeNull();
  expect(await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)).toBeNull();
});
