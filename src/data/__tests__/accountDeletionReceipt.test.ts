import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACCOUNT_DELETION_RECEIPT_KEY,
  archiveAccountDeletionReceipt,
  clearAccountDeletionReceipt,
  completeAccountDeletionReceipt,
  readAccountDeletionReceipt,
  retireAccountDeletionOrphan,
  writeAccountDeletionReceipt,
} from '../accountDeletionReceipt';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const storedIntent = (
  accountId: string,
  operationId: string,
  phase: 'pending' | 'complete',
) => JSON.stringify({ version: 2, accountId, operationId, phase });

const storedState = (
  active: {
    accountId: string;
    operationId: string;
    phase: 'pending' | 'complete';
  } | null,
  orphans: {
    accountId: string;
    operationId: string;
    phase: 'pending' | 'complete';
    archivedAt: number;
  }[] = [],
) => JSON.stringify({ version: 3, active, orphans });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('writes and verifies a pending intent before exposing it to callers', async () => {
  await expect(writeAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: true,
  });

  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: 'operation-a',
      phase: 'pending',
    },
    orphans: [],
  });
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    storedState({
      accountId: 'account-a',
      operationId: 'operation-a',
      phase: 'pending',
    }),
  );
});

it('upgrades only the exact pending intent to complete and then clears it', async () => {
  await expect(writeAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: true,
  });
  await expect(completeAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: true,
  });
  await expect(completeAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: true,
  });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: 'operation-a',
      phase: 'complete',
    },
    orphans: [],
  });

  await expect(clearAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: true,
  });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: null,
    orphans: [],
  });
});

it('never completes or clears an intent for a different account or operation', async () => {
  await writeAccountDeletionReceipt('account-a', 'operation-a');

  await expect(completeAccountDeletionReceipt('account-b', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(completeAccountDeletionReceipt('account-a', 'operation-b')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(clearAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });

  await completeAccountDeletionReceipt('account-a', 'operation-a');
  await expect(clearAccountDeletionReceipt('account-b', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(clearAccountDeletionReceipt('account-a', 'operation-b')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: 'operation-a',
      phase: 'complete',
    },
    orphans: [],
  });
});

it('does not overwrite an existing intent', async () => {
  await writeAccountDeletionReceipt('account-a', 'operation-a');
  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  setItem.mockClear();

  await expect(writeAccountDeletionReceipt('account-b', 'operation-b')).resolves.toEqual({
    ok: false,
    storageError: true,
  });

  expect(setItem).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    storedState({
      accountId: 'account-a',
      operationId: 'operation-a',
      phase: 'pending',
    }),
  );
});

it('archives an exact pending intent and leaves the active slot available for another owner', async () => {
  jest.spyOn(Date, 'now').mockReturnValueOnce(123);
  await writeAccountDeletionReceipt('account-a', 'operation-a');

  await expect(
    archiveAccountDeletionReceipt('account-a', 'operation-a'),
  ).resolves.toEqual({ ok: true });
  await expect(writeAccountDeletionReceipt('account-b', 'operation-b')).resolves.toEqual({
    ok: true,
  });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-b',
      operationId: 'operation-b',
      phase: 'pending',
    },
    orphans: [
      {
        accountId: 'account-a',
        operationId: 'operation-a',
        phase: 'pending',
        archivedAt: 123,
      },
    ],
  });
});

it('never archives a different active operation', async () => {
  await writeAccountDeletionReceipt('account-a', 'operation-a');

  await expect(
    archiveAccountDeletionReceipt('account-b', 'operation-a'),
  ).resolves.toEqual({ ok: false, storageError: true });
  await expect(
    archiveAccountDeletionReceipt('account-a', 'operation-b'),
  ).resolves.toEqual({ ok: false, storageError: true });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: 'operation-a',
      phase: 'pending',
    },
    orphans: [],
  });
});

it('retires only the exact proven orphan while preserving the active intent', async () => {
  jest.spyOn(Date, 'now').mockReturnValueOnce(123);
  await writeAccountDeletionReceipt('account-a', 'operation-a');
  await archiveAccountDeletionReceipt('account-a', 'operation-a');
  await writeAccountDeletionReceipt('account-b', 'operation-b');

  await expect(
    retireAccountDeletionOrphan('account-x', 'operation-x'),
  ).resolves.toEqual({ ok: true });
  await expect(
    retireAccountDeletionOrphan('account-a', 'operation-a'),
  ).resolves.toEqual({ ok: true });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-b',
      operationId: 'operation-b',
      phase: 'pending',
    },
    orphans: [],
  });
});

it('retains more than five unresolved capabilities without blocking a current intent', async () => {
  for (let index = 1; index <= 8; index += 1) {
    await writeAccountDeletionReceipt(`account-${index}`, `operation-${index}`);
    await expect(
      archiveAccountDeletionReceipt(`account-${index}`, `operation-${index}`),
    ).resolves.toEqual({ ok: true });
  }
  await expect(
    writeAccountDeletionReceipt('account-current', 'operation-current'),
  ).resolves.toEqual({ ok: true });

  const read = await readAccountDeletionReceipt();
  expect(read).toEqual(
    expect.objectContaining({
      ok: true,
      intent: expect.objectContaining({ operationId: 'operation-current' }),
    }),
  );
  if (!read.ok) throw new Error('expected readable deletion ledger');
  expect(read.orphans.map((orphan) => orphan.operationId)).toEqual(
    Array.from({ length: 8 }, (_, index) => `operation-${index + 1}`),
  );
});

it('clears a proven complete active operation while preserving many orphans', async () => {
  for (let index = 1; index <= 8; index += 1) {
    await writeAccountDeletionReceipt(`account-${index}`, `operation-${index}`);
    await archiveAccountDeletionReceipt(`account-${index}`, `operation-${index}`);
  }
  await writeAccountDeletionReceipt('account-active', 'operation-active');
  await completeAccountDeletionReceipt('account-active', 'operation-active');

  await expect(
    clearAccountDeletionReceipt('account-active', 'operation-active'),
  ).resolves.toEqual({ ok: true });
  const read = await readAccountDeletionReceipt();
  expect(read).toEqual(expect.objectContaining({ ok: true, intent: null }));
  if (!read.ok) throw new Error('expected readable deletion ledger');
  expect(read.orphans).toHaveLength(8);
});

it.each([
  ['invalid JSON', '{broken'],
  ['an invalid schema', JSON.stringify({ version: 1, accountId: 'account-a' })],
  [
    'a duplicated active/orphan capability',
    storedState(
      { accountId: 'account-a', operationId: 'operation-a', phase: 'pending' },
      [
        {
          accountId: 'account-a',
          operationId: 'operation-a',
          phase: 'pending',
          archivedAt: 1,
        },
      ],
    ),
  ],
])('fails closed on %s', async (_label, value) => {
  await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, value);

  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(value);
});

it('fails closed when reading storage rejects', async () => {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});

it('fails closed when writing a pending intent rejects', async () => {
  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  setItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(writeAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});

it('fails closed when the pending write cannot be read back exactly', async () => {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(storedIntent('account-a', 'different-operation', 'pending'));

  await expect(writeAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});

it('fails closed when the complete transition cannot be verified', async () => {
  await AsyncStorage.setItem(
    ACCOUNT_DELETION_RECEIPT_KEY,
    storedIntent('account-a', 'operation-a', 'pending'),
  );
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem
    .mockResolvedValueOnce(storedIntent('account-a', 'operation-a', 'pending'))
    .mockResolvedValueOnce(storedIntent('account-a', 'operation-a', 'pending'));

  await expect(completeAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});

it('fails closed when removing a complete intent rejects', async () => {
  await AsyncStorage.setItem(
    ACCOUNT_DELETION_RECEIPT_KEY,
    storedIntent('account-a', 'operation-a', 'complete'),
  );
  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;
  removeItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(clearAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    storedIntent('account-a', 'operation-a', 'complete'),
  );
});

it('fails closed when removal readback still exposes the intent', async () => {
  const raw = storedIntent('account-a', 'operation-a', 'complete');
  await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem.mockResolvedValueOnce(raw).mockResolvedValueOnce(raw);

  await expect(clearAccountDeletionReceipt('account-a', 'operation-a')).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});
