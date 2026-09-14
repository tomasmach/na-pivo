import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACCOUNT_DELETION_RECEIPT_KEY,
  ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY,
  archiveAccountDeletionReceipt,
  clearAccountDeletionReceipt,
  completeAccountDeletionReceipt,
  readAccountDeletionReceipt,
  retireAccountDeletionOrphan,
  retireQuarantinedAccountDeletionReceipt,
  writeAccountDeletionReceipt,
  type AccountDeletionReceiptReadResult,
} from '../accountDeletionReceipt';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Valid bindings are canonical UUID v4 strings, exactly what the production
// writer accepts and persists.
const BINDING_A = '0f1e2d3c-4b5a-4c8d-9e0f-1a2b3c4d5e6f';
const BINDING_B = '11223344-5566-4777-8899-aabbccddeeff';
const BINDING_ACTIVE = '22334455-6677-4888-99aa-bbccddeeff00';
const BINDING_LEGACY = 'aabbccdd-eeff-4001-8001-000000000001';
const bindingForIndex = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

// Operation ids are canonical lowercase RFC4122 UUID v4 strings, matching what
// the production writer validates and persists.
const OPERATION_A = '3f2b1a09-8c7d-4e6f-9a0b-1c2d3e4f5a6b';
const OPERATION_B = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OPERATION_X = 'deadbeef-1234-4567-89ab-cdef01234567';
const OPERATION_OLD = '01234567-89ab-4cde-8f01-23456789abcd';
const OPERATION_CURRENT = '11111111-2222-4333-8444-555555555555';
const OPERATION_ACTIVE = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const OPERATION_FRESH = 'bbbbbbbb-cccc-4ddd-8eee-ffff00000000';
const OPERATION_DIFFERENT = '12121212-3434-4545-8787-abababababab';
const INVALID_OPERATION_ID = 'not-even-a-uuid';
const operationForIndex = (index: number): string =>
  `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

// ---------------------------------------------------------------------------
// Release-safe read contract under test. Read failures carry a discriminated
// `failureKind`; truly unsalvageable current raw is quarantined verbatim; an
// exported retire hook clears the main slot only against the exact
// quarantined bytes.
// ---------------------------------------------------------------------------

const IO_READ_FAILURE = { ok: false, storageError: true, failureKind: 'io' as const };

async function quarantineLedgerEntries(): Promise<Record<string, unknown>[]> {
  const raw = await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object',
  );
}

/** Asserts the ledger holds exactly one entry carrying `raw`; optionally its id. */
async function expectSingleQuarantineEntry(
  raw: string,
  expectedQuarantineId?: string,
): Promise<void> {
  const matching = (await quarantineLedgerEntries()).filter((entry) =>
    Object.values(entry).includes(raw),
  );
  expect(matching).toHaveLength(1);
  const entry = matching[0];
  if (!entry) throw new Error('expected a quarantine ledger entry');
  if (expectedQuarantineId !== undefined) {
    expect(Object.values(entry)).toContain(expectedQuarantineId);
  }
}

const baseGetItem = (AsyncStorage.getItem as unknown as jest.Mock).getMockImplementation() as (
  key: string,
) => Promise<string | null>;
const baseSetItem = (AsyncStorage.setItem as unknown as jest.Mock).getMockImplementation() as (
  key: string,
  value: string,
) => Promise<null>;

// Realistic canonical UUID v4 active intent used by salvage scenarios.
const SALVAGE_ACCOUNT_ID = 'user-77331';
const SALVAGE_OPERATION_ID = '5c0d1e2f-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
const SALVAGE_INTENT = {
  accountId: SALVAGE_ACCOUNT_ID,
  operationId: SALVAGE_OPERATION_ID,
  phase: 'pending' as const,
  credentialBindingId: BINDING_A,
};

const storedIntent = (
  accountId: string,
  operationId: string,
  phase: 'pending' | 'complete',
) => JSON.stringify({ version: 2, accountId, operationId, phase });

type StoredIntentFixture = {
  accountId: string;
  operationId: string;
  phase: 'pending' | 'complete';
  credentialBindingId?: string;
};

type StoredOrphanFixture = StoredIntentFixture & { archivedAt: number };

// `version` is deliberately typed as a plain number so malformed future-version
// fixtures (e.g. 5) compile intentionally.
const storedState = (
  active: StoredIntentFixture | null,
  orphans: StoredOrphanFixture[] = [],
  version: number = 4,
) =>
  JSON.stringify({
    version,
    active: active && { ...active },
    orphans: orphans.map((orphan) => ({ ...orphan })),
  });

let nowSpy: jest.SpyInstance<number, []> | null = null;

/** Freeze Date.now for the next call(s); restored after every test. */
function freezeNow(ms: number): void {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(ms);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(baseGetItem);
  (AsyncStorage.setItem as unknown as jest.Mock).mockImplementation(baseSetItem);
});

it('writes and verifies a pending intent with its credential binding', async () => {
  await expect(
    writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A),
  ).resolves.toEqual({ ok: true });

  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'pending',
      credentialBindingId: BINDING_A,
    },
    orphans: [],
  });
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    storedState({
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'pending',
      credentialBindingId: BINDING_A,
    }),
  );
});

it.each([
  ['a missing binding', undefined],
  ['an empty binding', ''],
  ['a non-UUID binding', 'binding-not-a-uuid'],
  ['an uppercase UUID binding', '0F1E2D3C-4B5A-4C8D-9E0F-1A2B3C4D5E6F'],
])('refuses to write with %s', async (_label, binding) => {
  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  setItem.mockClear();

  await expect(
    writeAccountDeletionReceipt('account-a', OPERATION_A, binding as string),
  ).resolves.toEqual({ ok: false, storageError: true });

  expect(setItem).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBeNull();
});

// The writer must validate the operation id itself, independently of the
// binding: only canonical lowercase RFC-4122 v4 UUIDs are acceptable.
const NONCANONICAL_OPERATION_IDS: [string, string][] = [
  ['a plain non-UUID operation id', 'operation-not-a-uuid'],
  ['an uppercase UUID operation id', OPERATION_A.toUpperCase()],
  ['a UUID operation id whose version nibble is not 4', '00000000-0000-3000-8000-00000000beef'],
  [
    'a UUID operation id whose variant nibble is outside 8/9/a/b',
    '00000000-0000-4000-c000-00000000deed',
  ],
];

it.each(NONCANONICAL_OPERATION_IDS)(
  'refuses to write an intent carrying %s',
  async (_label, operationId) => {
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockClear();

    await expect(
      writeAccountDeletionReceipt('account-a', operationId, BINDING_A),
    ).resolves.toEqual({ ok: false, storageError: true });

    expect(setItem).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBeNull();
  },
);

it('keeps the credential binding through complete and clear preserves nothing stale', async () => {
  await writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A);
  await expect(completeAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
    ok: true,
  });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'complete',
      credentialBindingId: BINDING_A,
    },
    orphans: [],
  });

  await expect(clearAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
    ok: true,
  });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: null,
    orphans: [],
  });
});

it('never completes or clears an intent for a different account or operation', async () => {
  await writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A);

  await expect(completeAccountDeletionReceipt('account-b', OPERATION_A)).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(completeAccountDeletionReceipt('account-a', OPERATION_B)).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(clearAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
    ok: false,
    storageError: true,
  });

  await completeAccountDeletionReceipt('account-a', OPERATION_A);
  await expect(clearAccountDeletionReceipt('account-b', OPERATION_A)).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(clearAccountDeletionReceipt('account-a', OPERATION_B)).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'complete',
      credentialBindingId: BINDING_A,
    },
    orphans: [],
  });
});

it('does not overwrite an existing intent', async () => {
  await writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A);
  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  setItem.mockClear();

  await expect(
    writeAccountDeletionReceipt('account-b', OPERATION_B, BINDING_B),
  ).resolves.toEqual({ ok: false, storageError: true });

  expect(setItem).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    storedState({
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'pending',
      credentialBindingId: BINDING_A,
    }),
  );
});

it('archives an exact pending intent with its binding and frees the active slot', async () => {
  freezeNow(123);
  await writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A);

  await expect(
    archiveAccountDeletionReceipt('account-a', OPERATION_A),
  ).resolves.toEqual({ ok: true });
  await expect(
    writeAccountDeletionReceipt('account-b', OPERATION_B, BINDING_B),
  ).resolves.toEqual({ ok: true });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-b',
      operationId: OPERATION_B,
      phase: 'pending',
      credentialBindingId: BINDING_B,
    },
    orphans: [
      {
        accountId: 'account-a',
        operationId: OPERATION_A,
        phase: 'pending',
        credentialBindingId: BINDING_A,
        archivedAt: 123,
      },
    ],
  });
});

it('never archives a different active operation', async () => {
  await writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A);

  await expect(
    archiveAccountDeletionReceipt('account-b', OPERATION_A),
  ).resolves.toEqual({ ok: false, storageError: true });
  await expect(
    archiveAccountDeletionReceipt('account-a', OPERATION_B),
  ).resolves.toEqual({ ok: false, storageError: true });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'pending',
      credentialBindingId: BINDING_A,
    },
    orphans: [],
  });
});

it('retires only the exact proven orphan while preserving the active intent', async () => {
  freezeNow(123);
  await writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A);
  await archiveAccountDeletionReceipt('account-a', OPERATION_A);
  await writeAccountDeletionReceipt('account-b', OPERATION_B, BINDING_B);

  await expect(
    retireAccountDeletionOrphan('account-x', OPERATION_X),
  ).resolves.toEqual({ ok: true });
  await expect(
    retireAccountDeletionOrphan('account-a', OPERATION_A),
  ).resolves.toEqual({ ok: true });
  await expect(readAccountDeletionReceipt()).resolves.toEqual({
    ok: true,
    intent: {
      accountId: 'account-b',
      operationId: OPERATION_B,
      phase: 'pending',
      credentialBindingId: BINDING_B,
    },
    orphans: [],
  });
});

// Concurrent retire(X) and archive(A) may both observe the same durable
// snapshot; neither update may be lost. The gate holds each operation's
// first main-key read until both entered (a bounded microtask fallback
// releases a lone entrant, keeping this deadlock-free once a module mutex
// serializes the two operations). Writes are then ordered: archive commits
// first, retire commits last from the same stale snapshot.
it('keeps both updates when retire and archive act on the same snapshot concurrently', async () => {
  freezeNow(100);
  await writeAccountDeletionReceipt('account-x', OPERATION_X, BINDING_B);
  await archiveAccountDeletionReceipt('account-x', OPERATION_X);
  await writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_ACTIVE);
  const seededRaw = await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY);

  const heldReads: ((raw: string | null) => void)[] = [];
  let writeObserved = false;
  const gatedGetItem = jest.fn(async (key: string) => {
    if (key !== ACCOUNT_DELETION_RECEIPT_KEY || writeObserved) return baseGetItem(key);
    return new Promise<string | null>((resolve) => heldReads.push(resolve));
  });
  const gatedSetItem = jest.fn(async (key: string, value: string) => {
    if (key === ACCOUNT_DELETION_RECEIPT_KEY) writeObserved = true;
    await baseSetItem(key, value);
  });
  (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(gatedGetItem);
  (AsyncStorage.setItem as unknown as jest.Mock).mockImplementation(gatedSetItem);

  const retirePromise = retireAccountDeletionOrphan('account-x', OPERATION_X);
  const archivePromise = archiveAccountDeletionReceipt('account-a', OPERATION_A);
  for (let turn = 0; heldReads.length < 2 && turn < 50; turn += 1) {
    await Promise.resolve();
  }

  // Push order mirrors start order: index 0 belongs to retire, 1 to archive.
  const [, releaseArchiveRead] = heldReads;
  if (releaseArchiveRead) {
    releaseArchiveRead(seededRaw);
    await expect(archivePromise).resolves.toEqual({ ok: true });
  }
  for (const resolve of heldReads.splice(0)) {
    // Remaining entrants resume against the same shared snapshot; whatever a
    // later operation wrote meanwhile is exactly what this test must survive.
    resolve(seededRaw);
  }

  await expect(retirePromise).resolves.toEqual({ ok: true });
  await expect(archivePromise).resolves.toEqual({ ok: true });

  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    storedState(null, [
      {
        accountId: 'account-a',
        operationId: OPERATION_A,
        phase: 'pending',
        credentialBindingId: BINDING_ACTIVE,
        archivedAt: 100,
      },
    ]),
  );
});

// Two concurrent reads hitting distinct corrupt payloads must not lose a
// quarantined raw: each call read-append-writes the quarantine ledger, so an
// unlocked implementation lets the second writer erase the first entry from
// the shared empty snapshot. The module serializer makes the rounds
// sequential; the bounded microtask fallback releases a lone entrant so the
// gated second call can never deadlock the test.
it('keeps both distinct corrupt raws when two concurrent reads quarantine', async () => {
  const rawFirst = '{broken-concurrent-first';
  const rawSecond = '{broken-concurrent-second';
  await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, rawFirst);

  const heldMainReads: ((value: string | null) => void)[] = [];
  // Entrant order maps to distinct corrupt payloads across all drain rounds.
  const entrantRaws = [rawFirst, rawSecond];
  const gatedGetItem = jest.fn(async (key: string) => {
    if (key !== ACCOUNT_DELETION_RECEIPT_KEY) return baseGetItem(key);
    return new Promise<string | null>((resolve) => {
      heldMainReads.push(resolve);
    });
  });
  (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(gatedGetItem);

  const firstPromise = readAccountDeletionReceipt();
  const secondPromise = readAccountDeletionReceipt();

  const drainEntrants = async (): Promise<number> => {
    for (let turn = 0; heldMainReads.length < 1 && turn < 50; turn += 1) {
      await Promise.resolve();
    }
    const entrants = heldMainReads.splice(0);
    entrants.forEach((resolve) => resolve(entrantRaws.shift() ?? null));
    return entrants.length;
  };

  try {
    // Two entrants in one round means both calls overlapped on the same
    // ledger snapshot; a lone entrant means the serializer held the second
    // call back, so settle the first call completely before draining the
    // second one's gated read.
    if ((await drainEntrants()) < 2) {
      await firstPromise;
      await drainEntrants();
    }
  } finally {
    for (const resolve of heldMainReads.splice(0)) resolve(null);
  }
  (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(baseGetItem);

  const first = await firstPromise;
  const second = await secondPromise;
  if (
    first.ok ||
    first.failureKind !== 'corrupt' ||
    typeof first.quarantineId !== 'string' ||
    second.ok ||
    second.failureKind !== 'corrupt' ||
    typeof second.quarantineId !== 'string'
  ) {
    throw new Error(
      `expected two corrupt quarantine results, got ${JSON.stringify([first, second])}`,
    );
  }
  expect(first.storageError).toBe(false);
  expect(second.storageError).toBe(false);
  expect(second.quarantineId).not.toBe(first.quarantineId);

  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;
  expect(removeItem).not.toHaveBeenCalledWith(ACCOUNT_DELETION_RECEIPT_KEY);
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(rawFirst);

  const entries = await quarantineLedgerEntries();
  expect(entries).toHaveLength(2);
  expect(entries).toContainEqual({ id: first.quarantineId, raw: rawFirst });
  expect(entries).toContainEqual({ id: second.quarantineId, raw: rawSecond });
});

it('retains more than five unresolved capabilities without blocking a current intent', async () => {
  for (let index = 1; index <= 8; index += 1) {
    await writeAccountDeletionReceipt(
      `account-${index}`,
      operationForIndex(index),
      bindingForIndex(index),
    );
    await expect(
      archiveAccountDeletionReceipt(`account-${index}`, operationForIndex(index)),
    ).resolves.toEqual({ ok: true });
  }
  await expect(
    writeAccountDeletionReceipt('account-current', OPERATION_CURRENT, BINDING_ACTIVE),
  ).resolves.toEqual({ ok: true });

  const read = await readAccountDeletionReceipt();
  expect(read).toEqual(
    expect.objectContaining({
      ok: true,
      intent: expect.objectContaining({ operationId: OPERATION_CURRENT }),
    }),
  );
  if (!read.ok) throw new Error('expected readable deletion ledger');
  expect(read.orphans.map((orphan) => orphan.operationId)).toEqual(
    Array.from({ length: 8 }, (_, index) => operationForIndex(index + 1)),
  );
});

it('clears a proven complete active operation while preserving many orphans', async () => {
  for (let index = 1; index <= 8; index += 1) {
    await writeAccountDeletionReceipt(
      `account-${index}`,
      operationForIndex(index),
      bindingForIndex(index),
    );
    await archiveAccountDeletionReceipt(`account-${index}`, operationForIndex(index));
  }
  await writeAccountDeletionReceipt('account-active', OPERATION_ACTIVE, BINDING_ACTIVE);
  await completeAccountDeletionReceipt('account-active', OPERATION_ACTIVE);

  await expect(
    clearAccountDeletionReceipt('account-active', OPERATION_ACTIVE),
  ).resolves.toEqual({ ok: true });
  const read = await readAccountDeletionReceipt();
  expect(read).toEqual(expect.objectContaining({ ok: true, intent: null }));
  if (!read.ok) throw new Error('expected readable deletion ledger');
  expect(read.orphans).toHaveLength(8);
});

describe('legacy migration', () => {
  it('reads a legacy v2 single intent without a credential binding', async () => {
    await AsyncStorage.setItem(
      ACCOUNT_DELETION_RECEIPT_KEY,
      storedIntent('account-a', OPERATION_A, 'pending'),
    );

    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId: OPERATION_A,
        phase: 'pending',
      },
      orphans: [],
    });
  });

  it('migrates a v3 ledger without bindings and keeps operating on it', async () => {
    freezeNow(123);
    await AsyncStorage.setItem(
      ACCOUNT_DELETION_RECEIPT_KEY,
      storedState(
        { accountId: 'account-a', operationId: OPERATION_A, phase: 'pending' },
        [
          {
            accountId: 'account-old',
            operationId: OPERATION_OLD,
            phase: 'pending',
            archivedAt: 7,
          },
        ],
        3,
      ),
    );

    await expect(completeAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId: OPERATION_A,
        phase: 'complete',
      },
      orphans: [
        {
          accountId: 'account-old',
          operationId: OPERATION_OLD,
          phase: 'pending',
          archivedAt: 7,
        },
      ],
    });
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
      storedState(
        { accountId: 'account-a', operationId: OPERATION_A, phase: 'complete' },
        [
          {
            accountId: 'account-old',
            operationId: OPERATION_OLD,
            phase: 'pending',
            archivedAt: 7,
          },
        ],
        3,
      ),
    );
  });

  it('keeps a v3 ledger with unbound entries at version 3 through complete and archive', async () => {
    freezeNow(789);
    const rawV3 = storedState(
      { accountId: 'account-a', operationId: OPERATION_A, phase: 'pending' },
      [
        {
          accountId: 'account-old',
          operationId: OPERATION_OLD,
          phase: 'pending',
          archivedAt: 7,
        },
      ],
      3,
    );
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, rawV3);

    await expect(completeAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    expect(
      JSON.parse((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) as string).version,
    ).toBe(3);

    await expect(archiveAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    const rawAfterArchive = await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY);
    expect(JSON.parse(rawAfterArchive as string).version).toBe(3);

    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: null,
      orphans: [
        {
          accountId: 'account-old',
          operationId: OPERATION_OLD,
          phase: 'pending',
          archivedAt: 7,
        },
        {
          accountId: 'account-a',
          operationId: OPERATION_A,
          phase: 'complete',
          archivedAt: 789,
        },
      ],
    });
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(rawAfterArchive);
  });

  it('keeps a migrated v2 unbound intent compatible through complete and archive', async () => {
    freezeNow(321);
    await AsyncStorage.setItem(
      ACCOUNT_DELETION_RECEIPT_KEY,
      storedIntent('account-a', OPERATION_A, 'pending'),
    );

    await expect(completeAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    expect(
      JSON.parse((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) as string).version,
    ).toBe(3);

    await expect(archiveAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    expect(
      JSON.parse((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) as string).version,
    ).toBe(3);

    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: null,
      orphans: [
        {
          accountId: 'account-a',
          operationId: OPERATION_A,
          phase: 'complete',
          archivedAt: 321,
        },
      ],
    });
  });

  it('upgrades a fully bound v3 ledger to v4 on the next write', async () => {
    freezeNow(654);
    await AsyncStorage.setItem(
      ACCOUNT_DELETION_RECEIPT_KEY,
      storedState(
        {
          accountId: 'account-a',
          operationId: OPERATION_A,
          phase: 'pending',
          credentialBindingId: BINDING_LEGACY,
        },
        [
          {
            accountId: 'account-old',
            operationId: OPERATION_OLD,
            phase: 'pending',
            credentialBindingId: BINDING_A,
            archivedAt: 7,
          },
        ],
        3,
      ),
    );

    await expect(completeAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    expect(
      JSON.parse((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) as string).version,
    ).toBe(4);

    await expect(archiveAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    expect(
      JSON.parse((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) as string).version,
    ).toBe(4);
  });

  it('preserves a valid UUID v4 binding found in a v3 fixture through complete and archive', async () => {
    freezeNow(456);
    await AsyncStorage.setItem(
      ACCOUNT_DELETION_RECEIPT_KEY,
      storedState(
        {
          accountId: 'account-a',
          operationId: OPERATION_A,
          phase: 'pending',
          credentialBindingId: BINDING_LEGACY,
        },
        [],
        3,
      ),
    );

    await expect(completeAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
      ok: true,
    });
    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId: OPERATION_A,
        phase: 'complete',
        credentialBindingId: BINDING_LEGACY,
      },
      orphans: [],
    });

    await expect(
      archiveAccountDeletionReceipt('account-a', OPERATION_A),
    ).resolves.toEqual({ ok: true });
    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: null,
      orphans: [
        {
          accountId: 'account-a',
          operationId: OPERATION_A,
          phase: 'complete',
          credentialBindingId: BINDING_LEGACY,
          archivedAt: 456,
        },
      ],
    });
  });
});

it.each([
  ['invalid JSON', '{broken'],
  ['an invalid schema', JSON.stringify({ version: 1, accountId: 'account-a' })],
  [
    'a duplicated active/orphan capability',
    storedState(
      {
        accountId: 'account-a',
        operationId: INVALID_OPERATION_ID,
        phase: 'pending',
        credentialBindingId: BINDING_A,
      },
      [
        {
          accountId: 'account-a',
          operationId: INVALID_OPERATION_ID,
          phase: 'pending',
          credentialBindingId: BINDING_A,
          archivedAt: 1,
        },
      ],
    ),
  ],
  [
    'an empty active credential binding',
    storedState({
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'pending',
      credentialBindingId: '',
    }),
  ],
  [
    'a non-string active credential binding',
    storedState({
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'pending',
      credentialBindingId: 42,
    } as unknown as StoredIntentFixture),
  ],
  [
    'a malformed active credential binding',
    storedState({
      accountId: 'account-a',
      operationId: OPERATION_A,
      phase: 'pending',
      credentialBindingId: 'binding-not-a-uuid',
    }),
  ],
  [
    'an invalid orphan credential binding',
    storedState(null, [
      {
        accountId: 'account-a',
        operationId: OPERATION_A,
        phase: 'pending',
        credentialBindingId: '',
        archivedAt: 1,
      },
    ]),
  ],
  [
    'an unbound v4 active intent',
    storedState({ accountId: 'account-a', operationId: OPERATION_A, phase: 'pending' }),
  ],
  [
    'an unbound v4 orphan',
    storedState(null, [
      {
        accountId: 'account-a',
        operationId: OPERATION_A,
        phase: 'pending',
        archivedAt: 1,
      },
    ]),
  ],
])('quarantines %s verbatim and reports a corrupt failureKind', async (_label, value) => {
  await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, value);

  const read = await readAccountDeletionReceipt();
  if (read.ok || read.failureKind !== 'corrupt' || typeof read.quarantineId !== 'string') {
    throw new Error(`expected a corrupt quarantine result, got ${JSON.stringify(read)}`);
  }
  expect(read.storageError).toBe(false);

  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(value);
  await expectSingleQuarantineEntry(value, read.quarantineId);
});

// A stored receipt whose operation id is not a canonical UUID v4 must fail
// closed and quarantine verbatim, whatever the container version — it was
// never written by a validating writer, so trusting it would launder corrupt
// bytes back into the live protocol.
it.each([
  [
    'a legacy v2 active intent',
    storedIntent('account-a', INVALID_OPERATION_ID, 'pending'),
  ],
  [
    'a v3 active intent',
    storedState(
      { accountId: 'account-a', operationId: INVALID_OPERATION_ID, phase: 'pending' },
      [],
      3,
    ),
  ],
  [
    'a v4 active intent',
    storedState({
      accountId: 'account-a',
      operationId: INVALID_OPERATION_ID,
      phase: 'pending',
      credentialBindingId: BINDING_A,
    }),
  ],
])(
  'quarantines %s with a non-UUID operation id verbatim instead of trusting it',
  async (_label, raw) => {
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);

    const read = await readAccountDeletionReceipt();
    if (read.ok || read.failureKind !== 'corrupt' || typeof read.quarantineId !== 'string') {
      throw new Error(`expected a corrupt quarantine result, got ${JSON.stringify(read)}`);
    }
    expect(read.storageError).toBe(false);

    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(raw);
    await expectSingleQuarantineEntry(raw, read.quarantineId);
  },
);

it('reuses one quarantine entry when identical corrupt raw survives a restart', async () => {
  const raw = storedState({
    accountId: 'account-a',
    operationId: OPERATION_A,
    phase: 'pending',
    credentialBindingId: '',
  });
  await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);

  const first = await readAccountDeletionReceipt();
  const second = await readAccountDeletionReceipt();
  if (first.ok || first.failureKind !== 'corrupt' || second.ok || second.failureKind !== 'corrupt')
    throw new Error('expected corrupt failures');
  expect(first.failureKind).toBe('corrupt');
  expect(second.failureKind).toBe('corrupt');
  expect(second.quarantineId).toBe(first.quarantineId);

  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(raw);
  await expectSingleQuarantineEntry(raw, first.quarantineId);
});

describe('unsupported future containers', () => {
  it('reports an unsupported failureKind without touching main or quarantine', async () => {
    const raw = storedState(null, [], 5);
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);

    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: false,
      storageError: true,
      failureKind: 'unsupported',
    });

    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(raw);
    expect(await quarantineLedgerEntries()).toHaveLength(0);
  });

  it('never salvages a future container even when its active intent looks valid', async () => {
    const raw = JSON.stringify({ version: 5, active: { ...SALVAGE_INTENT }, orphans: [] });
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);

    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: false,
      storageError: true,
      failureKind: 'unsupported',
    });

    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(raw);
    expect(await quarantineLedgerEntries()).toHaveLength(0);
  });
});

it('reports io when reading storage rejects', async () => {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);
  expect(await quarantineLedgerEntries()).toHaveLength(0);
});

it('fails closed when writing a pending intent rejects', async () => {
  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  setItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A),
  ).resolves.toEqual({ ok: false, storageError: true });
});

it('fails closed when the pending write cannot be read back exactly', async () => {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(storedIntent('account-a', OPERATION_DIFFERENT, 'pending'));

  await expect(
    writeAccountDeletionReceipt('account-a', OPERATION_A, BINDING_A),
  ).resolves.toEqual({ ok: false, storageError: true });
});

it('fails closed when the complete transition cannot be verified', async () => {
  await AsyncStorage.setItem(
    ACCOUNT_DELETION_RECEIPT_KEY,
    storedIntent('account-a', OPERATION_A, 'pending'),
  );
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem
    .mockResolvedValueOnce(storedIntent('account-a', OPERATION_A, 'pending'))
    .mockResolvedValueOnce(storedIntent('account-a', OPERATION_A, 'pending'));

  await expect(completeAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});

it('fails closed when removing a complete intent rejects', async () => {
  await AsyncStorage.setItem(
    ACCOUNT_DELETION_RECEIPT_KEY,
    storedIntent('account-a', OPERATION_A, 'complete'),
  );
  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;
  removeItem.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(clearAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
    ok: false,
    storageError: true,
  });
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    storedIntent('account-a', OPERATION_A, 'complete'),
  );
});

it('fails closed when removal readback still exposes the intent', async () => {
  const raw = storedIntent('account-a', OPERATION_A, 'complete');
  await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  getItem.mockResolvedValueOnce(raw).mockResolvedValueOnce(raw);

  await expect(clearAccountDeletionReceipt('account-a', OPERATION_A)).resolves.toEqual({
    ok: false,
    storageError: true,
  });
});

describe('quarantine io failures', () => {
  const corruptRaw = '{broken';

  it('reports io and leaves main intact when the quarantine write rejects', async () => {
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, corruptRaw);
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);

    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(corruptRaw);
    expect(await quarantineLedgerEntries()).toHaveLength(0);
  });

  it('reports io and leaves main intact when the quarantine copy fails its readback', async () => {
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, corruptRaw);
    const quarantine = ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY;
    let primaryWriteObserved = false;
    const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    // Key-aware state: primary reads hit real storage until the writer commits
    // its quarantine copy; only the post-write readback sees tampered bytes.
    getItem.mockImplementation(async (key: string) =>
      key === quarantine && primaryWriteObserved ? '{"tampered":true}' : baseGetItem(key),
    );
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === quarantine) primaryWriteObserved = true;
      await baseSetItem(key, value);
    });

    await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);

    expect(setItem).toHaveBeenCalledWith(quarantine, expect.any(String));
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(corruptRaw);
  });
});

describe('retiring quarantined corrupt raw', () => {
  async function quarantineCorruptMain(): Promise<{ raw: string; quarantineId: string }> {
    const raw = '{broken';
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);
    const read = await readAccountDeletionReceipt();
    if (read.ok || read.failureKind !== 'corrupt' || typeof read.quarantineId !== 'string') {
      throw new Error(`expected a corrupt quarantine result, got ${JSON.stringify(read)}`);
    }
    return { raw, quarantineId: read.quarantineId };
  }

  it('removes and verifies only the matching main raw, then keeps the ledger forever', async () => {
    const { raw, quarantineId } = await quarantineCorruptMain();

    await expect(retireQuarantinedAccountDeletionReceipt(quarantineId)).resolves.toEqual({
      ok: true,
    });

    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBeNull();
    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: null,
      orphans: [],
    });
    await expectSingleQuarantineEntry(raw, quarantineId);

    await expect(retireQuarantinedAccountDeletionReceipt(quarantineId)).resolves.toEqual({
      ok: true,
    });
    await expectSingleQuarantineEntry(raw, quarantineId);
  });

  it('fails without deleting anything when the main raw no longer matches', async () => {
    const { raw, quarantineId } = await quarantineCorruptMain();
    // The local account boundary replaced the slot after the corruption.
    await AsyncStorage.setItem(
      ACCOUNT_DELETION_RECEIPT_KEY,
      storedState({
        accountId: 'account-fresh',
        operationId: OPERATION_FRESH,
        phase: 'pending',
        credentialBindingId: BINDING_ACTIVE,
      }),
    );

    await expect(retireQuarantinedAccountDeletionReceipt(quarantineId)).resolves.toEqual({
      ok: false,
      storageError: true,
    });

    await expectSingleQuarantineEntry(raw, quarantineId);
    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: true,
      intent: {
        accountId: 'account-fresh',
        operationId: OPERATION_FRESH,
        phase: 'pending',
        credentialBindingId: BINDING_ACTIVE,
      },
      orphans: [],
    });
  });
});

describe('salvageable partial current ledgers', () => {
  const salvageFixture = (version: number) =>
    JSON.stringify({
      version,
      active: { ...SALVAGE_INTENT },
      orphans: [
        {
          accountId: 'legacy-user',
          operationId: INVALID_OPERATION_ID,
          archivedAt: 'yesterday',
        },
      ],
    });

  const expectNormalizedMainState = async () => {
    expect(
      JSON.parse((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) as string),
    ).toEqual({
      version: 4,
      active: { ...SALVAGE_INTENT },
      orphans: [],
    });
  };

  it.each([3, 4])(
    'salvages the valid active of a broken v%d container and resumes normal operation',
    async (version) => {
      const raw = salvageFixture(version);
      await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);

      await expect(readAccountDeletionReceipt()).resolves.toEqual({
        ok: true,
        intent: { ...SALVAGE_INTENT },
        orphans: [],
      });

      await expectSingleQuarantineEntry(raw);
      await expectNormalizedMainState();

      await expect(
        completeAccountDeletionReceipt(SALVAGE_ACCOUNT_ID, SALVAGE_OPERATION_ID),
      ).resolves.toEqual({ ok: true });
      await expect(readAccountDeletionReceipt()).resolves.toEqual({
        ok: true,
        intent: { ...SALVAGE_INTENT, phase: 'complete' },
        orphans: [],
      });
    },
  );

  it('reports io and recovers the original raw when the normalized rewrite fails', async () => {
    const raw = salvageFixture(4);
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === ACCOUNT_DELETION_RECEIPT_KEY) throw new Error('quota exceeded');
      await baseSetItem(key, value);
    });

    await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);

    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(raw);
    await expectSingleQuarantineEntry(raw);
  });
});

// ---------------------------------------------------------------------------
// Malformed quarantine-ledger self-heal. When the primary quarantine ledger
// itself holds unreadable bytes, the read path must stay lossless: the
// malformed primary raw is backed up verbatim, the corrupt main raw is
// recovered into a separate ledger keyed by the returned quarantine id, and
// no original byte is ever rewritten or deleted. The current source does not
// implement this contract yet — these tests are the RED stage 1 definition.
// ---------------------------------------------------------------------------

const QUARANTINE_BACKUP_KEY = 'na-pivo-account-deletion-intent-quarantine-backup-v1';
const QUARANTINE_RECOVERED_KEY = 'na-pivo-account-deletion-intent-quarantine-recovered-v1';
const SELF_HEAL_CORRUPT_MAIN_RAW = '{broken-main-self-heal';
const SELF_HEAL_MALFORMED_PRIMARY_RAW = '{broken-primary-quarantine-ledger';

type TestLedgerEntry = { id: string; raw: string };

/** Strict shape check of a persisted [{id,raw}] append-only ledger. */
function parseTestLedger(serialized: string | null): TestLedgerEntry[] {
  if (serialized === null) throw new Error('expected a persisted ledger, got null');
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new Error('ledger is not an array');
  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('ledger entry is not an object');
    }
    const { id, raw } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0 || typeof raw !== 'string') {
      throw new Error('ledger entry shape invalid');
    }
    return { id, raw };
  });
}

function writtenValueFor(key: string): string | undefined {
  const calls = (AsyncStorage.setItem as unknown as jest.Mock).mock.calls as [
    string,
    string,
  ][];
  return calls.find(([calledKey]) => calledKey === key)?.[1];
}

function expectCorruptWithId(read: AccountDeletionReceiptReadResult): string {
  if (read.ok || read.failureKind !== 'corrupt' || typeof read.quarantineId !== 'string') {
    throw new Error(`expected a corrupt quarantine result, got ${JSON.stringify(read)}`);
  }
  expect(read.storageError).toBe(false);
  return read.quarantineId;
}

async function seedCorruptMainWithMalformedPrimary(): Promise<void> {
  await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, SELF_HEAL_CORRUPT_MAIN_RAW);
  await AsyncStorage.setItem(
    ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY,
    SELF_HEAL_MALFORMED_PRIMARY_RAW,
  );
}

async function expectOriginalSlotsExact(): Promise<void> {
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
    SELF_HEAL_CORRUPT_MAIN_RAW,
  );
  expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY)).toBe(
    SELF_HEAL_MALFORMED_PRIMARY_RAW,
  );
}

function expectNoRemovalOfOriginals(): void {
  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<
    typeof AsyncStorage.removeItem
  >;
  expect(removeItem).not.toHaveBeenCalledWith(ACCOUNT_DELETION_RECEIPT_KEY);
  expect(removeItem).not.toHaveBeenCalledWith(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY);
}

async function expectIoPreservingOriginals(): Promise<void> {
  await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);
  await expectOriginalSlotsExact();
  expectNoRemovalOfOriginals();
}

function expectAttemptedLedgerWrite(key: string, raw: string): void {
  const written = writtenValueFor(key);
  expect(written).toBeDefined();
  expect(parseTestLedger(written ?? null).some((entry) => entry.raw === raw)).toBe(true);
}

async function expectLedgerStoredWithRaw(key: string, raw: string): Promise<void> {
  const ledger = parseTestLedger(await AsyncStorage.getItem(key));
  expect(ledger.some((entry) => entry.raw === raw)).toBe(true);
}

describe('malformed quarantine-ledger self-heal', () => {
  it('backs up a malformed primary ledger and recovers corrupt main raw losslessly', async () => {
    await seedCorruptMainWithMalformedPrimary();

    const quarantineId = expectCorruptWithId(await readAccountDeletionReceipt());

    await expectOriginalSlotsExact();
    expectNoRemovalOfOriginals();

    expect(parseTestLedger(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY))).toEqual([
      { id: expect.any(String), raw: SELF_HEAL_MALFORMED_PRIMARY_RAW },
    ]);
    expect(parseTestLedger(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY))).toEqual([
      { id: quarantineId, raw: SELF_HEAL_CORRUPT_MAIN_RAW },
    ]);

    // Restart/idempotence: a repeated read keeps the same id and leaves both
    // self-heal ledgers byte-for-byte stable, without duplicating entries.
    const backupBytes = await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY);
    const recoveredBytes = await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY);
    await expect(readAccountDeletionReceipt()).resolves.toEqual({
      ok: false,
      storageError: false,
      failureKind: 'corrupt',
      quarantineId,
    });
    expect(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY)).toBe(backupBytes);
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBe(recoveredBytes);

    // Retire path: the auth/startup cleanup for an id stored in the recovered
    // ledger must clear only the main slot and never touch any evidence bytes.
    const removeItem = AsyncStorage.removeItem as jest.MockedFunction<
      typeof AsyncStorage.removeItem
    >;
    removeItem.mockClear();
    await expect(
      retireQuarantinedAccountDeletionReceipt(quarantineId),
    ).resolves.toEqual({ ok: true });
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY)).toBe(
      SELF_HEAL_MALFORMED_PRIMARY_RAW,
    );
    expect(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY)).toBe(backupBytes);
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBe(recoveredBytes);
    expect(removeItem).not.toHaveBeenCalledWith(
      ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY,
    );
    expect(removeItem).not.toHaveBeenCalledWith(QUARANTINE_BACKUP_KEY);
    expect(removeItem).not.toHaveBeenCalledWith(QUARANTINE_RECOVERED_KEY);

    // Retiring again stays idempotent and keeps every evidence byte intact.
    await expect(
      retireQuarantinedAccountDeletionReceipt(quarantineId),
    ).resolves.toEqual({ ok: true });
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY)).toBe(
      SELF_HEAL_MALFORMED_PRIMARY_RAW,
    );
    expect(parseTestLedger(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY))).toEqual([
      { id: expect.any(String), raw: SELF_HEAL_MALFORMED_PRIMARY_RAW },
    ]);
    expect(parseTestLedger(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY))).toEqual([
      { id: quarantineId, raw: SELF_HEAL_CORRUPT_MAIN_RAW },
    ]);
  });

  // Readable JSON that is not a valid primary ledger must self-heal exactly
  // like unreadable bytes: the wrongly shaped raw is evidence worth copying
  // verbatim before recovery. The current source's isUnreadableBytes only
  // accepts JSON.parse failures — these rows are the RED stage 2 signal.
  const READABLE_INVALID_PRIMARY_CASES: [string, string][] = [
    ['an empty object', '{}'],
    [
      'duplicate entry ids',
      JSON.stringify([
        { id: 'qd-duplicated-id-1', raw: 'first-entry-bytes' },
        { id: 'qd-duplicated-id-1', raw: 'second-entry-bytes' },
      ]),
    ],
    ['an entry missing its raw', JSON.stringify([{ id: 'qd-entry-without-raw' }])],
  ];

  it.each(READABLE_INVALID_PRIMARY_CASES)(
    'self-heals losslessly when the primary ledger holds %s',
    async (_label, invalidPrimaryRaw) => {
      await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, SELF_HEAL_CORRUPT_MAIN_RAW);
      await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY, invalidPrimaryRaw);

      const quarantineId = expectCorruptWithId(await readAccountDeletionReceipt());

      expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
        SELF_HEAL_CORRUPT_MAIN_RAW,
      );
      expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY)).toBe(
        invalidPrimaryRaw,
      );
      expectNoRemovalOfOriginals();

      expect(parseTestLedger(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY))).toEqual([
        { id: expect.any(String), raw: invalidPrimaryRaw },
      ]);
      expect(parseTestLedger(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY))).toEqual([
        { id: quarantineId, raw: SELF_HEAL_CORRUPT_MAIN_RAW },
      ]);
    },
  );

  // Concurrency contract for self-heal: two reads racing on distinct corrupt
  // main raws behind one malformed primary must both quarantine losslessly.
  // The module mutex currently serializes them (so this is likely green), but
  // the harness stays deadlock-free either way: if both entrants arrive in one
  // round both are released; otherwise the first settles before draining the
  // second, and every gate is released in `finally`.
  it('keeps both corrupt raws when two concurrent reads self-heal one malformed primary', async () => {
    const rawFirst = '{broken-concurrent-heal-first';
    const rawSecond = '{broken-concurrent-heal-second';
    await seedCorruptMainWithMalformedPrimary();

    const heldMainReads: ((value: string | null) => void)[] = [];
    const entrantRaws = [rawFirst, rawSecond];
    const gatedGetItem = jest.fn(async (key: string) => {
      if (key !== ACCOUNT_DELETION_RECEIPT_KEY) return baseGetItem(key);
      return new Promise<string | null>((resolve) => {
        heldMainReads.push(resolve);
      });
    });
    (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(gatedGetItem);

    const firstPromise = readAccountDeletionReceipt();
    const secondPromise = readAccountDeletionReceipt();

    const drainEntrants = async (): Promise<number> => {
      for (let turn = 0; heldMainReads.length < 1 && turn < 50; turn += 1) {
        await Promise.resolve();
      }
      const entrants = heldMainReads.splice(0);
      entrants.forEach((resolve) => resolve(entrantRaws.shift() ?? null));
      return entrants.length;
    };

    try {
      if ((await drainEntrants()) < 2) {
        await firstPromise;
        await drainEntrants();
      }
    } finally {
      for (const resolve of heldMainReads.splice(0)) resolve(null);
    }
    (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(baseGetItem);

    const firstId = expectCorruptWithId(await firstPromise);
    const secondId = expectCorruptWithId(await secondPromise);
    expect(secondId).not.toBe(firstId);

    await expectOriginalSlotsExact();
    expectNoRemovalOfOriginals();

    // Idempotence by exact raw: two backup attempts collapse into one entry.
    expect(parseTestLedger(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY))).toEqual([
      { id: expect.any(String), raw: SELF_HEAL_MALFORMED_PRIMARY_RAW },
    ]);
    const recovered = parseTestLedger(
      await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY),
    );
    expect(recovered).toHaveLength(2);
    expect(recovered).toContainEqual({ id: firstId, raw: rawFirst });
    expect(recovered).toContainEqual({ id: secondId, raw: rawSecond });
  });

  it('reports io when backing up the malformed primary rejects', async () => {
    await seedCorruptMainWithMalformedPrimary();
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === QUARANTINE_BACKUP_KEY) throw new Error('disk full');
      await baseSetItem(key, value);
    });

    await expectIoPreservingOriginals();

    expectAttemptedLedgerWrite(QUARANTINE_BACKUP_KEY, SELF_HEAL_MALFORMED_PRIMARY_RAW);
    expect(setItem).not.toHaveBeenCalledWith(QUARANTINE_RECOVERED_KEY, expect.any(String));
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBeNull();
  });

  it('reports io when the backup copy fails its readback', async () => {
    await seedCorruptMainWithMalformedPrimary();
    let backupWritten = false;
    const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    getItem.mockImplementation(async (key: string) =>
      key === QUARANTINE_BACKUP_KEY && backupWritten ? '{"tampered":true}' : baseGetItem(key),
    );
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === QUARANTINE_BACKUP_KEY) backupWritten = true;
      await baseSetItem(key, value);
    });

    await expectIoPreservingOriginals();

    expectAttemptedLedgerWrite(QUARANTINE_BACKUP_KEY, SELF_HEAL_MALFORMED_PRIMARY_RAW);
    expect(setItem).not.toHaveBeenCalledWith(QUARANTINE_RECOVERED_KEY, expect.any(String));
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBeNull();
  });

  it('reports io and keeps the verified backup when the recovered-ledger write rejects', async () => {
    await seedCorruptMainWithMalformedPrimary();
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === QUARANTINE_RECOVERED_KEY) throw new Error('disk full');
      await baseSetItem(key, value);
    });

    await expectIoPreservingOriginals();

    await expectLedgerStoredWithRaw(QUARANTINE_BACKUP_KEY, SELF_HEAL_MALFORMED_PRIMARY_RAW);
    expectAttemptedLedgerWrite(QUARANTINE_BACKUP_KEY, SELF_HEAL_MALFORMED_PRIMARY_RAW);
    expectAttemptedLedgerWrite(QUARANTINE_RECOVERED_KEY, SELF_HEAL_CORRUPT_MAIN_RAW);
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBeNull();
  });

  it('reports io and keeps the verified backup when the recovered ledger fails its readback', async () => {
    await seedCorruptMainWithMalformedPrimary();
    let recoveredWritten = false;
    const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    getItem.mockImplementation(async (key: string) =>
      key === QUARANTINE_RECOVERED_KEY && recoveredWritten
        ? '{"tampered":true}'
        : baseGetItem(key),
    );
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === QUARANTINE_RECOVERED_KEY) recoveredWritten = true;
      await baseSetItem(key, value);
    });

    await expectIoPreservingOriginals();

    await expectLedgerStoredWithRaw(QUARANTINE_BACKUP_KEY, SELF_HEAL_MALFORMED_PRIMARY_RAW);
    expectAttemptedLedgerWrite(QUARANTINE_RECOVERED_KEY, SELF_HEAL_CORRUPT_MAIN_RAW);
  });

  it('stays io without overwriting anything when the backup slot is itself malformed', async () => {
    await seedCorruptMainWithMalformedPrimary();
    const invalidBackupRaw = '{}';
    await AsyncStorage.setItem(QUARANTINE_BACKUP_KEY, invalidBackupRaw);

    await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);

    // The self-heal decision must consult the backup slot; the current source
    // never reads it, so this assertion carries the RED signal for this case.
    const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    expect(getItem).toHaveBeenCalledWith(QUARANTINE_BACKUP_KEY);

    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)).toBe(
      SELF_HEAL_CORRUPT_MAIN_RAW,
    );
    expect(await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY)).toBe(
      SELF_HEAL_MALFORMED_PRIMARY_RAW,
    );
    expect(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY)).toBe(invalidBackupRaw);

    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    expect(setItem).not.toHaveBeenCalledWith(QUARANTINE_RECOVERED_KEY, expect.any(String));
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBeNull();
  });

  // Get-level I/O seams of the self-heal path: every ledger key must survive
  // a rejecting read losslessly, without further copies being written.

  it('reports io when reading the malformed primary ledger itself rejects', async () => {
    await seedCorruptMainWithMalformedPrimary();
    const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    getItem.mockImplementation(async (key: string) => {
      if (key === ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY) {
        throw new Error('storage unavailable');
      }
      return baseGetItem(key);
    });

    await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);
    (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(baseGetItem);

    await expectOriginalSlotsExact();
    expectNoRemovalOfOriginals();
    expect(await AsyncStorage.getItem(QUARANTINE_BACKUP_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBeNull();
  });

  it('reports io when reading the backup ledger rejects', async () => {
    await seedCorruptMainWithMalformedPrimary();
    const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    getItem.mockImplementation(async (key: string) => {
      if (key === QUARANTINE_BACKUP_KEY) throw new Error('storage unavailable');
      return baseGetItem(key);
    });

    await expectIoPreservingOriginals();

    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    expect(setItem).not.toHaveBeenCalledWith(QUARANTINE_RECOVERED_KEY, expect.any(String));
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBeNull();
  });

  it('reports io when reading the recovered ledger rejects after a verified backup', async () => {
    await seedCorruptMainWithMalformedPrimary();
    const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    getItem.mockImplementation(async (key: string) => {
      if (key === QUARANTINE_RECOVERED_KEY) throw new Error('storage unavailable');
      return baseGetItem(key);
    });

    await expect(readAccountDeletionReceipt()).resolves.toEqual(IO_READ_FAILURE);
    (AsyncStorage.getItem as unknown as jest.Mock).mockImplementation(baseGetItem);

    await expectOriginalSlotsExact();
    expectNoRemovalOfOriginals();
    await expectLedgerStoredWithRaw(QUARANTINE_BACKUP_KEY, SELF_HEAL_MALFORMED_PRIMARY_RAW);
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBeNull();
  });

  it('reports io without overwriting a recovered ledger holding readable-invalid bytes', async () => {
    await seedCorruptMainWithMalformedPrimary();
    const invalidRecoveredRaw = '{}';
    await AsyncStorage.setItem(QUARANTINE_RECOVERED_KEY, invalidRecoveredRaw);
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockClear();

    await expectIoPreservingOriginals();

    await expectLedgerStoredWithRaw(QUARANTINE_BACKUP_KEY, SELF_HEAL_MALFORMED_PRIMARY_RAW);
    expect(setItem).not.toHaveBeenCalledWith(QUARANTINE_RECOVERED_KEY, expect.any(String));
    expect(await AsyncStorage.getItem(QUARANTINE_RECOVERED_KEY)).toBe(invalidRecoveredRaw);
  });
});
