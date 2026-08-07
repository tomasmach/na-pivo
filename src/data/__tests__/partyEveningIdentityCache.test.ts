import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  clearPartyEveningIdentityCache,
  clearPartyEveningIdentityForAccount,
  clearPartyEveningIdentityForCode,
  loadPartyEveningIdentity,
  PARTY_EVENING_IDENTITY_STORAGE_KEY,
  PARTY_EVENING_IDENTITY_TTL_MS,
  partyEveningIdentityGeneration,
  savePartyEveningIdentity,
} from '../partyEveningIdentityCache';

const EVENING = { id: 'evening-1', joinCode: 'PIVOXY', isHost: true };

beforeEach(async () => {
  await AsyncStorage.clear();
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
