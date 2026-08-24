import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ensureAccount,
  updateAccountPreferences,
  type AccountPreferences,
  type AccountSession,
} from '../account';
import {
  ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY,
  clearAccountPreferencesQueue,
  enqueueAccountPreferences,
  flushAccountPreferencesQueue,
  hasQueuedAccountPreferences,
  rekeyAccountPreferencesQueueOwner,
} from '../accountPreferencesQueue';
import {
  PRIVATE_ACCOUNT_MERGE_STORAGE_KEY,
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';
import { recoverPartyGameQueuesForAccount } from '../partyGameQueueBoundary';
import { suppressPrivatePersistenceDuringMemoryReset } from '../privateAccountStorage';
import { useSettingsStore } from '@/stores/settingsStore';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  updateAccountPreferences: jest.fn(),
}));

const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const mockUpdateAccountPreferences = updateAccountPreferences as jest.MockedFunction<
  typeof updateAccountPreferences
>;

const SESSION_A: AccountSession = {
  deviceId: 'device-a',
  accountId: 'account-a',
  token: 'token-a',
  authenticated: true,
};
const SESSION_B: AccountSession = {
  deviceId: 'device-b',
  accountId: 'account-b',
  token: 'token-b',
  authenticated: true,
};

function successfulPreferences(
  patch: Partial<AccountPreferences>,
): AccountPreferences {
  return { hidePubNames: false, ...patch };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  resetPrivateAccountBoundaryForTests();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  suppressPrivatePersistenceDuringMemoryReset(() => {
    useSettingsStore.setState({
      marketingEmailsEnabled: true,
      hideClosedPubs: true,
      pendingAccountPreferences: {},
      pendingAccountPreferencesOwnerId: null,
      accountPreferencesRevision: 0,
    });
  });
  mockEnsureAccount.mockResolvedValue(SESSION_A);
  mockUpdateAccountPreferences.mockResolvedValue(null);
});

afterEach(async () => {
  await clearAccountPreferencesQueue();
  resetPrivateAccountBoundaryForTests();
});

it('survives an offline restart and delivers the opt-out when connectivity returns', async () => {
  await expect(
    enqueueAccountPreferences(
      { marketingEmailsEnabled: false },
      SESSION_A.accountId,
    ),
  ).resolves.toBe(true);

  expect(useSettingsStore.getState()).toMatchObject({
    marketingEmailsEnabled: false,
    pendingAccountPreferences: { marketingEmailsEnabled: false },
    pendingAccountPreferencesOwnerId: SESSION_A.accountId,
  });
  expect(await hasQueuedAccountPreferences()).toBe(true);
  expect(await AsyncStorage.getItem(ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY)).not.toBeNull();

  // Simulate process memory loss, then let Zustand restore the independently
  // persisted optimistic overlay before the foreground retry.
  await nextTurn();
  suppressPrivatePersistenceDuringMemoryReset(() => {
    useSettingsStore.setState({
      marketingEmailsEnabled: true,
      pendingAccountPreferences: {},
      pendingAccountPreferencesOwnerId: null,
    });
  });
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState()).toMatchObject({
    marketingEmailsEnabled: false,
    pendingAccountPreferences: { marketingEmailsEnabled: false },
    pendingAccountPreferencesOwnerId: SESSION_A.accountId,
  });

  mockUpdateAccountPreferences.mockResolvedValue(
    successfulPreferences({ marketingEmailsEnabled: false }),
  );
  await flushAccountPreferencesQueue();

  expect(mockUpdateAccountPreferences).toHaveBeenLastCalledWith(
    { marketingEmailsEnabled: false },
    expect.any(AbortSignal),
    SESSION_A.accountId,
  );
  expect(await hasQueuedAccountPreferences()).toBe(false);
  expect(useSettingsStore.getState()).toMatchObject({
    marketingEmailsEnabled: false,
    pendingAccountPreferences: {},
    pendingAccountPreferencesOwnerId: null,
  });
});

it('rekeys pending preferences inside cold merge recovery before clearing its marker', async () => {
  await expect(
    enqueueAccountPreferences(
      { marketingEmailsEnabled: false },
      SESSION_A.accountId,
    ),
  ).resolves.toBe(true);
  await nextTurn();
  expect(JSON.parse((await AsyncStorage.getItem('na-pivo-settings'))!))
    .toMatchObject({
      state: {
        pendingAccountPreferences: { marketingEmailsEnabled: false },
        pendingAccountPreferencesOwnerId: SESSION_A.accountId,
      },
    });
  await AsyncStorage.setItem(
    PRIVATE_ACCOUNT_MERGE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      operationId: 'merge-1',
      fromAccountId: SESSION_A.accountId,
      toAccountId: SESSION_B.accountId,
      preparedAt: 1,
    }),
  );
  resetPrivateAccountBoundaryForTests();

  await expect(
    rekeyAccountPreferencesQueueOwner(SESSION_A.accountId, SESSION_B.accountId),
  ).resolves.toBe(false);
  const setItem = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  let failSettingsRekey = true;
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    (key: string, value: string) => {
      if (key === 'na-pivo-settings' && failSettingsRekey) {
        failSettingsRekey = false;
        return Promise.reject(new Error('disk full'));
      }
      return setItem(key, value);
    },
  );
  await expect(
    recoverPartyGameQueuesForAccount(
      SESSION_B.accountId,
      (intent) => rekeyAccountPreferencesQueueOwner(
        intent.fromAccountId,
        SESSION_B.accountId,
        { allowDuringPrivateTransition: true },
      ),
    ),
  ).resolves.toBe(false);
  expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).not.toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem('na-pivo-settings'))!))
    .toMatchObject({
      state: { pendingAccountPreferencesOwnerId: SESSION_A.accountId },
    });

  resetPrivateAccountBoundaryForTests();
  await expect(
    recoverPartyGameQueuesForAccount(
      SESSION_B.accountId,
      (intent) => rekeyAccountPreferencesQueueOwner(
        intent.fromAccountId,
        SESSION_B.accountId,
        { allowDuringPrivateTransition: true },
      ),
    ),
  ).resolves.toBe(true);

  expect(JSON.parse(
    (await AsyncStorage.getItem(ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY))!,
  )).toEqual([
    expect.objectContaining({ ownerAccountId: SESSION_B.accountId }),
  ]);
  expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem('na-pivo-settings'))!))
    .toMatchObject({
      state: {
        pendingAccountPreferences: { marketingEmailsEnabled: false },
        pendingAccountPreferencesOwnerId: SESSION_B.accountId,
      },
    });

  suppressPrivatePersistenceDuringMemoryReset(() => {
    useSettingsStore.setState({
      pendingAccountPreferences: {},
      pendingAccountPreferencesOwnerId: null,
    });
  });
  await useSettingsStore.persist.rehydrate();
  await nextTurn();
  expect(useSettingsStore.getState()).toMatchObject({
    pendingAccountPreferences: { marketingEmailsEnabled: false },
    pendingAccountPreferencesOwnerId: SESSION_B.accountId,
  });
});

it('recovers a durable settings overlay when the separate queue write never existed', async () => {
  expect(useSettingsStore.getState().stageAccountPreferences(
    { marketingEmailsEnabled: false },
    SESSION_A.accountId,
  )).toBe(true);
  await nextTurn();
  expect(await AsyncStorage.getItem(ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY)).toBeNull();
  await AsyncStorage.setItem(
    PRIVATE_ACCOUNT_MERGE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      operationId: 'merge-overlay-only',
      fromAccountId: SESSION_A.accountId,
      toAccountId: SESSION_B.accountId,
      preparedAt: 1,
    }),
  );
  suppressPrivatePersistenceDuringMemoryReset(() => {
    useSettingsStore.setState({
      pendingAccountPreferences: {},
      pendingAccountPreferencesOwnerId: null,
    });
  });
  resetPrivateAccountBoundaryForTests();

  await expect(
    recoverPartyGameQueuesForAccount(
      SESSION_B.accountId,
      (intent) => rekeyAccountPreferencesQueueOwner(
        intent.fromAccountId,
        SESSION_B.accountId,
        { allowDuringPrivateTransition: true },
      ),
    ),
  ).resolves.toBe(true);

  expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem('na-pivo-settings'))!))
    .toMatchObject({
      state: {
        pendingAccountPreferences: { marketingEmailsEnabled: false },
        pendingAccountPreferencesOwnerId: SESSION_B.accountId,
      },
    });
  expect(await AsyncStorage.getItem(ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY)).toBeNull();
});

it('keeps a pending optimistic value over a stale account refresh', () => {
  const store = useSettingsStore.getState();
  expect(
    store.stageAccountPreferences(
      { marketingEmailsEnabled: false },
      SESSION_A.accountId,
    ),
  ).toBe(true);

  useSettingsStore.getState().applyAccountPreferencesFromServer(
    { marketingEmailsEnabled: true, hideClosedPubs: false },
    SESSION_A.accountId,
  );
  expect(useSettingsStore.getState()).toMatchObject({
    marketingEmailsEnabled: false,
    hideClosedPubs: false,
  });

  useSettingsStore.getState().settlePendingAccountPreferences(
    { marketingEmailsEnabled: false },
    SESSION_A.accountId,
  );
  useSettingsStore.getState().applyAccountPreferencesFromServer(
    { marketingEmailsEnabled: true },
    SESSION_A.accountId,
  );
  expect(useSettingsStore.getState().marketingEmailsEnabled).toBe(true);
});

it('rejects a GET response started before a staged and acknowledged PATCH', () => {
  const revisionBeforeGet = useSettingsStore.getState().accountPreferencesRevision;
  const store = useSettingsStore.getState();
  expect(
    store.stageAccountPreferences(
      { marketingEmailsEnabled: false },
      SESSION_A.accountId,
    ),
  ).toBe(true);
  useSettingsStore.getState().settlePendingAccountPreferences(
    { marketingEmailsEnabled: false },
    SESSION_A.accountId,
  );

  useSettingsStore.getState().applyAccountPreferencesFromServer(
    { marketingEmailsEnabled: true },
    SESSION_A.accountId,
    revisionBeforeGet,
  );

  expect(useSettingsStore.getState().marketingEmailsEnabled).toBe(false);
});

it('aborts account A and clears its patch before account B can flush', async () => {
  let deliveryStarted: (() => void) | null = null;
  const started = new Promise<void>((resolve) => {
    deliveryStarted = resolve;
  });
  mockUpdateAccountPreferences.mockImplementation(
    async (_preferences, signal) =>
      new Promise<null>((resolve) => {
        deliveryStarted?.();
        if (signal?.aborted) {
          resolve(null);
          return;
        }
        signal?.addEventListener('abort', () => resolve(null), { once: true });
      }),
  );

  const enqueue = enqueueAccountPreferences(
    { marketingEmailsEnabled: false },
    SESSION_A.accountId,
  );
  await started;

  const transition = beginPrivateAccountTransition(
    'account-preferences-test-switch',
    SESSION_A.accountId,
  );
  expect(transition).not.toBeNull();
  await transition!.drain();
  await expect(clearAccountPreferencesQueue()).resolves.toBe(true);
  transition!.release();
  await enqueue;

  mockEnsureAccount.mockResolvedValue(SESSION_B);
  mockUpdateAccountPreferences.mockResolvedValue(
    successfulPreferences({ marketingEmailsEnabled: true }),
  );
  await flushAccountPreferencesQueue();

  expect(mockUpdateAccountPreferences).toHaveBeenCalledTimes(1);
  expect(mockUpdateAccountPreferences.mock.calls[0]?.[2]).toBe(SESSION_A.accountId);
  expect(await hasQueuedAccountPreferences()).toBe(false);
  expect(useSettingsStore.getState()).toMatchObject({
    pendingAccountPreferences: {},
    pendingAccountPreferencesOwnerId: null,
  });
});
