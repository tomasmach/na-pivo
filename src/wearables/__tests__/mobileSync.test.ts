import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeMobileWearableSync } from '../mobileSync';
import type { WearableCommandEnvelope } from '../protocol';
import {
  beginMobileWearableAccountBoundary,
  getMobileWearableSyncBoundary,
  MOBILE_WEARABLE_SHADOW_STORAGE_KEY,
  MOBILE_WEARABLE_SHADOWS_STORAGE_KEY,
} from '../mobileSyncBoundary';
import { createWearableSyncState } from '../stateReducer';
import { geohash8 } from '@/data/geohash';
import { useTallyStore } from '@/stores/tallyStore';
import { useWearableTargetStore } from '@/stores/wearableTargetStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

const ACCOUNT_ID = '1b89af06-08d8-41d5-8c9d-59ce15648af8';
const ACCOUNT_EPOCH = '924decbc-b2e0-4ba1-8e14-5e3ebf9ad4af';
const listeners: (() => void)[] = [];
type MockAccountState = { session: { accountId: string } | null };
const mockAccountListeners: ((
  state: MockAccountState,
  previous: MockAccountState,
) => void)[] = [];
let mockAccountState: MockAccountState = {
  session: { accountId: ACCOUNT_ID },
};
const mockSecureStoreValues = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockSecureStoreValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStoreValues.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStoreValues.delete(key);
  }),
}));

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: {
    getState: () => mockAccountState,
    subscribe: jest.fn(
      (
        listener: (
          state: MockAccountState,
          previous: MockAccountState,
        ) => void,
      ) => {
        mockAccountListeners.push(listener);
        return () => undefined;
      },
    ),
  },
}));

const mockPublishSnapshot = jest.fn<Promise<void>, [string]>(async () => undefined);
const mockAckPendingCommands = jest.fn<Promise<void>, [string[]]>(
  async () => undefined,
);
const mockRequestSync = jest.fn<Promise<void>, []>(async () => undefined);
const mockGetPendingCommands = jest.fn<Promise<string[]>, []>();
const mockGetAcknowledgedActorSequences = jest.fn<
  Promise<Record<string, number>>,
  [string]
>(async () => ({}));

jest.mock('na-pivo-wearable-bridge', () => ({
  publishSnapshot: (...args: unknown[]) =>
    mockPublishSnapshot(...(args as [string])),
  ackPendingCommands: (...args: unknown[]) =>
    mockAckPendingCommands(...(args as [string[]])),
  requestSync: (...args: unknown[]) => mockRequestSync(...(args as [])),
  getPendingCommands: (...args: unknown[]) =>
    mockGetPendingCommands(...(args as [])),
  getAcknowledgedActorSequences: (...args: unknown[]) =>
    mockGetAcknowledgedActorSequences(...(args as [string])),
  getTransportStatus: jest.fn(async () => ({
    supported: true,
    paired: true,
    reachable: true,
    pendingCommands: 2,
    lastReceivedAt: null,
    lastSentAt: null,
  })),
  addWearableCommandListener: jest.fn((listener: () => void) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  }),
}));

jest.mock('@/data/drinksQueue', () => {
  const actual = jest.requireActual('@/data/drinksQueue');
  return { ...actual, flushDrinksQueue: jest.fn(async () => undefined) };
});
jest.mock('@/data/deleteDrinksQueue', () => {
  const actual = jest.requireActual('@/data/deleteDrinksQueue');
  return { ...actual, flushDeleteDrinksQueue: jest.fn(async () => undefined) };
});
jest.mock('@/data/visitsQueue', () => {
  const actual = jest.requireActual('@/data/visitsQueue');
  return { ...actual, flushVisitsQueue: jest.fn(async () => undefined) };
});

const PUB = {
  pubKey: 'u2fkbn4f',
  name: 'U Zlatého tygra',
  latitude: 50.08706,
  longitude: 14.41786,
  city: 'Praha',
  externalId: 'mapy:test',
};
const PUB_B = {
  pubKey: geohash8(50.0912, 14.4223),
  name: 'U Druhého kola',
  latitude: 50.0912,
  longitude: 14.4223,
  city: 'Praha',
  externalId: 'mapy:test-b',
};
const PUB_C = {
  pubKey: geohash8(50.0951, 14.4294),
  name: 'Na poslední',
  latitude: 50.0951,
  longitude: 14.4294,
  city: 'Praha',
  externalId: 'mapy:test-c',
};

function command(
  actorSequence: number,
  messageId: string,
  body: WearableCommandEnvelope['payload']['command'],
  options?: {
    actorId?: string;
    baseRevision?: number;
    sentAt?: string;
  },
): WearableCommandEnvelope {
  return {
    protocolVersion: 1,
    messageId,
    accountEpoch: ACCOUNT_EPOCH,
    actorId: options?.actorId ?? 'watchos-test',
    actorKind: 'watchos',
    actorSequence,
    baseRevision: options?.baseRevision ?? actorSequence - 1,
    sentAt:
      options?.sentAt ?? `2026-07-30T19:0${actorSequence}:00.000Z`,
    kind: 'command',
    payload: { command: body },
  };
}

async function waitForExpectation(
  assertion: () => void | Promise<void>,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

function latestSnapshot(): WearableStateSnapshotEnvelopeForTest {
  const call = mockPublishSnapshot.mock.calls.at(-1);
  if (!call) throw new Error('No wearable snapshot was published');
  return JSON.parse(call[0]) as WearableStateSnapshotEnvelopeForTest;
}

interface WearableStateSnapshotEnvelopeForTest {
  accountEpoch: string;
  payload: {
    revision: number;
    target: { selection: 'manual' | 'nearest'; pub: typeof PUB } | null;
    activeEvening: {
      eveningId: string;
      drinks: { id: string }[];
    } | null;
    otherEvenings: { eveningId: string }[];
  };
}

async function wakeWithPending(
  envelopes: WearableCommandEnvelope[],
): Promise<void> {
  const acknowledgementsBefore = mockAckPendingCommands.mock.calls.length;
  mockGetPendingCommands.mockResolvedValue(
    envelopes.map((envelope) => JSON.stringify(envelope)),
  );
  listeners[0]?.();
  await waitForExpectation(() => {
    expect(mockAckPendingCommands).toHaveBeenCalledTimes(
      acknowledgementsBefore + 1,
    );
  });
}

async function wakeForSnapshot(): Promise<void> {
  const snapshotsBefore = mockPublishSnapshot.mock.calls.length;
  mockGetPendingCommands.mockResolvedValue([]);
  listeners[0]?.();
  await waitForExpectation(() => {
    expect(mockPublishSnapshot).toHaveBeenCalledTimes(snapshotsBefore + 1);
  });
}

describe('mobile wearable coordinator', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    listeners.length = 0;
    mockAccountListeners.length = 0;
    mockAccountState = { session: { accountId: ACCOUNT_ID } };
    mockSecureStoreValues.clear();
    mockGetAcknowledgedActorSequences.mockResolvedValue({});
    mockSecureStoreValues.set(
      'na-pivo-wearable-account-epoch-v1',
      JSON.stringify({ accountId: ACCOUNT_ID, epoch: ACCOUNT_EPOCH }),
    );
    await AsyncStorage.clear();
    useTallyStore.setState({ current: null, history: [], removedDrinkIds: [] });
    useWearableTargetStore.getState().reset();
  });

  it('preserves durable ordered state across conflicts, reconnects and account boundaries', async () => {
    const startId = 'f4ed24c2-b261-4bf1-8be9-6cb85f65266f';
    const eveningId = '9f794b7b-cf88-4015-8578-cf0f4f1fe873';
    const drinkId = '59b1369e-288b-4b9f-af94-47f616593010';
    const swiftStart = command(
      1,
      startId.toUpperCase(),
      {
        type: 'start_evening_and_add_drink',
        eveningId: eveningId.toUpperCase(),
        pub: PUB,
        drinkingDayKey: '2026-07-30',
        drink: {
          id: drinkId.toUpperCase(),
          name: 'Pilsner Urquell 12°',
          drinkType: 'beer',
          volumeMl: 500,
          priceCzk: 68,
          servingType: 'draft',
          recordedAt: '2026-07-30T19:02:00.000Z',
        },
      },
      { actorId: 'watchOS-Swift-UUID' },
    );
    swiftStart.accountEpoch = ACCOUNT_EPOCH.toUpperCase();
    const lowercaseLegacyDuplicate = structuredClone(swiftStart);
    lowercaseLegacyDuplicate.messageId = startId;
    lowercaseLegacyDuplicate.accountEpoch = ACCOUNT_EPOCH;
    const duplicateCommand = lowercaseLegacyDuplicate.payload.command;
    if (duplicateCommand.type !== 'start_evening_and_add_drink') {
      throw new Error('fixture must start an evening');
    }
    duplicateCommand.eveningId = eveningId;
    duplicateCommand.drink.id = drinkId;
    mockGetPendingCommands.mockResolvedValue([
      JSON.stringify(swiftStart),
      JSON.stringify(lowercaseLegacyDuplicate),
    ]);
    await AsyncStorage.setItem(
      MOBILE_WEARABLE_SHADOW_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accountEpoch: ACCOUNT_EPOCH,
        actorId: 'phone-legacy-shadow',
        actorSequence: 0,
        state: createWearableSyncState(ACCOUNT_EPOCH),
      }),
    );

    await initializeMobileWearableSync();

    expect(useWearableTargetStore.getState().manualTarget).toEqual(PUB);
    expect(useTallyStore.getState().current).toMatchObject({
      clientId: eveningId,
      pubKey: PUB.pubKey,
      drinks: [
        {
          id: drinkId,
          beerName: 'Pilsner Urquell 12°',
          priceCzk: 68,
          volumeMl: 500,
        },
      ],
    });

    const queuedDrinks = JSON.parse(
      (await AsyncStorage.getItem('na-pivo-drinks-queue')) ?? '[]',
    ) as { client_id: string; evening_client_id?: string }[];
    expect(queuedDrinks).toEqual([
      expect.objectContaining({
        client_id: drinkId,
        evening_client_id: eveningId,
      }),
    ]);
    const queuedVisits = JSON.parse(
      (await AsyncStorage.getItem('na-pivo-visits-queue')) ?? '[]',
    ) as { clientId: string }[];
    expect(queuedVisits).toEqual([
      expect.objectContaining({ clientId: eveningId }),
    ]);

    expect(mockPublishSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = JSON.parse(mockPublishSnapshot.mock.calls[0][0]) as {
      payload: {
        activeEvening: { eveningId: string; drinks: { id: string }[] };
        menuDrinks: unknown[];
      };
    };
    expect(snapshot.payload.activeEvening).toMatchObject({
      eveningId,
      drinks: [expect.objectContaining({ id: drinkId })],
    });
    expect(snapshot.payload.menuDrinks).toEqual([]);
    expect(mockAckPendingCommands).toHaveBeenCalledTimes(1);
    expect(mockAckPendingCommands).toHaveBeenCalledWith([startId]);
    expect(mockPublishSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      mockAckPendingCommands.mock.invocationCallOrder[0],
    );
    expect(
      await AsyncStorage.getItem(MOBILE_WEARABLE_SHADOW_STORAGE_KEY),
    ).toBeNull();
    const migratedShadowLedger = JSON.parse(
      (await AsyncStorage.getItem(MOBILE_WEARABLE_SHADOWS_STORAGE_KEY)) ??
        '{}',
    ) as {
      byAccount?: Record<string, { actorId?: string }>;
    };
    expect(migratedShadowLedger.byAccount?.[ACCOUNT_ID]?.actorId).toBe(
      'phone-legacy-shadow',
    );

    // Android DataItems may be observed in reconnect order rather than actor
    // order. Closing A must land before starting B even when the inbox is reversed.
    const eveningB = '33333333-3333-4333-8333-333333333333';
    const drinkB = '44444444-4444-4444-8444-444444444444';
    const closeA = command(
      1,
      '11111111-1111-4111-8111-111111111111',
      {
        type: 'close_evening',
        eveningId,
        closedAt: '2026-07-30T20:01:00.000Z',
      },
      {
        actorId: 'wearos-order',
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:01:00.000Z',
      },
    );
    const startB = command(
      2,
      '22222222-2222-4222-8222-222222222222',
      {
        type: 'start_evening_and_add_drink',
        eveningId: eveningB,
        pub: PUB_B,
        drinkingDayKey: '2026-07-30',
        drink: {
          id: drinkB,
          name: 'Budvar 33',
          drinkType: 'beer',
          volumeMl: 500,
          priceCzk: 64,
          servingType: 'draft',
          recordedAt: '2026-07-30T20:02:00.000Z',
        },
      },
      {
        actorId: 'wearos-order',
        baseRevision: latestSnapshot().payload.revision + 1,
        sentAt: '2026-07-30T20:02:00.000Z',
      },
    );
    await wakeWithPending([startB, closeA]);
    expect(
      mockAckPendingCommands.mock.calls.at(-1)?.[0],
    ).toEqual([closeA.messageId, startB.messageId]);
    expect(useTallyStore.getState().current).toMatchObject({
      clientId: eveningB,
      pubKey: PUB_B.pubKey,
      drinks: [expect.objectContaining({ id: drinkB })],
    });
    expect(useWearableTargetStore.getState().manualTarget).toEqual(PUB);

    // A stale sequence is acknowledged as obsolete, never executed as a side
    // effect. This used to overwrite the target despite reducer rejection.
    const staleTarget = command(
      1,
      '55555555-5555-4555-8555-555555555555',
      {
        type: 'set_target',
        target: { selection: 'manual', pub: PUB_C },
      },
      {
        actorId: 'wearos-order',
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:03:00.000Z',
      },
    );
    const inconsistentPubIdentity = command(
      1,
      '54545454-5454-4454-8454-545454545454',
      {
        type: 'set_target',
        target: {
          selection: 'manual',
          pub: { ...PUB_C, pubKey: PUB_B.pubKey },
        },
      },
      {
        actorId: 'watchos-invalid-pub',
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:03:00.000Z',
      },
    );
    await wakeWithPending([inconsistentPubIdentity, staleTarget]);
    expect(mockAckPendingCommands.mock.calls.at(-1)?.[0]).toEqual([
      staleTarget.messageId,
    ]);
    expect(useWearableTargetStore.getState().manualTarget).toEqual(PUB);

    // Likewise, a concurrent manual/manual conflict remains explicit and keeps
    // the phone's current target until the user resolves it.
    const concurrentTarget = command(
      1,
      '66666666-6666-4666-8666-666666666666',
      {
        type: 'set_target',
        target: { selection: 'manual', pub: PUB_C },
      },
      {
        actorId: 'watchos-target-conflict',
        baseRevision: Math.max(0, latestSnapshot().payload.revision - 1),
        sentAt: '2026-07-30T20:04:00.000Z',
      },
    );
    await wakeWithPending([concurrentTarget]);
    expect(useWearableTargetStore.getState().manualTarget).toEqual(PUB);
    expect(latestSnapshot().payload.target?.pub.pubKey).toBe(PUB.pubKey);

    // Clearing an explicit target falls back to the cached nearest pub instead
    // of erasing the whole nearby snapshot.
    useWearableTargetStore.getState().setNearbySnapshot(PUB_C, [PUB_C, PUB_B]);
    const clearTarget = command(
      1,
      '77777777-7777-4777-8777-777777777777',
      { type: 'clear_target' },
      {
        actorId: 'watchos-clear-target',
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:05:00.000Z',
      },
    );
    await wakeWithPending([clearTarget]);
    expect(useWearableTargetStore.getState()).toMatchObject({
      manualTarget: null,
      nearestTarget: PUB_C,
    });
    expect(latestSnapshot().payload.target).toMatchObject({
      selection: 'nearest',
      pub: { pubKey: PUB_C.pubKey },
    });

    // A contact-only heartbeat advances the envelope sequence, not the semantic
    // revision used for offline conflict detection.
    const revisionBeforeHeartbeat = latestSnapshot().payload.revision;
    await wakeForSnapshot();
    expect(latestSnapshot().payload.revision).toBe(revisionBeforeHeartbeat);

    // Resolve a genuine three-way different-pub conflict and persist both the
    // newly selected evening and every displaced evening's closed state.
    const eveningC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const drinkC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const startConflict = command(
      1,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      {
        type: 'start_evening_and_add_drink',
        eveningId: eveningC,
        pub: PUB_C,
        drinkingDayKey: '2026-07-30',
        drink: {
          id: drinkC,
          name: 'Kofola originál',
          drinkType: 'soft_drink',
          volumeMl: 400,
          priceCzk: 49,
          servingType: 'draft',
          recordedAt: '2026-07-30T20:06:00.000Z',
        },
      },
      {
        actorId: 'watchos-evening-conflict',
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:06:00.000Z',
      },
    );
    await wakeWithPending([startConflict]);
    expect(useTallyStore.getState().current?.clientId).toBe(eveningB);
    expect(
      useTallyStore.getState().history.some(
        (session) => session.clientId === eveningC,
      ),
    ).toBe(true);

    const eveningD = '12121212-1212-4212-8212-121212121212';
    const drinkD = '13131313-1313-4313-8313-131313131313';
    const startSecondConflict = command(
      1,
      '14141414-1414-4414-8414-141414141414',
      {
        type: 'start_evening_and_add_drink',
        eveningId: eveningD,
        pub: PUB,
        drinkingDayKey: '2026-07-30',
        drink: {
          id: drinkD,
          name: 'Ryzlink vlašský',
          drinkType: 'wine',
          volumeMl: 200,
          priceCzk: 75,
          servingType: 'other',
          recordedAt: '2026-07-30T20:06:30.000Z',
        },
      },
      {
        actorId: 'wearos-second-evening-conflict',
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:06:30.000Z',
      },
    );
    await wakeWithPending([startSecondConflict]);
    expect(useTallyStore.getState().current?.clientId).toBe(eveningB);
    expect(
      useTallyStore.getState().history.map((session) => session.clientId),
    ).toEqual(expect.arrayContaining([eveningC, eveningD]));

    // The reducer shadow is durable beyond the capped/local Tally projection.
    // If the selected conflict branch is missing locally, resolving must rebuild
    // it from that shadow instead of acknowledging a no-op and losing the branch.
    useTallyStore.setState((state) => ({
      history: state.history.filter(
        (session) => session.clientId !== eveningC,
      ),
    }));
    expect(
      useTallyStore
        .getState()
        .history.some((session) => session.clientId === eveningC),
    ).toBe(false);

    const resolveConflict = command(
      2,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      {
        type: 'resolve_evening_conflict',
        activeEveningId: eveningC,
      },
      {
        actorId: 'watchos-evening-conflict',
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:07:00.000Z',
      },
    );
    await wakeWithPending([resolveConflict]);
    expect(useTallyStore.getState().current).toMatchObject({
      clientId: eveningC,
      pubKey: PUB_C.pubKey,
      drinks: [expect.objectContaining({ id: drinkC })],
    });
    for (const displacedEveningId of [eveningB, eveningD]) {
      expect(
        useTallyStore
          .getState()
          .history.find(
            (session) => session.clientId === displacedEveningId,
          ),
      ).toMatchObject({
        closedAt: '2026-07-30T20:07:00.000Z',
        archivedReason: 'manual',
      });
    }
    const conflictVisits = JSON.parse(
      (await AsyncStorage.getItem('na-pivo-visits-queue')) ?? '[]',
    ) as {
      clientId: string;
      op: 'upsert' | 'delete';
      entry?: { closed_at?: string };
    }[];
    expect(
      conflictVisits.find((item) => item.clientId === eveningB)?.entry,
    ).toMatchObject({ closed_at: '2026-07-30T20:07:00.000Z' });
    expect(
      conflictVisits.find((item) => item.clientId === eveningD)?.entry,
    ).toMatchObject({ closed_at: '2026-07-30T20:07:00.000Z' });
    expect(
      conflictVisits.find((item) => item.clientId === eveningC)?.entry
        ?.closed_at,
    ).toBeUndefined();

    // A phone-side Dopito must clear activeEvening on both watches.
    const revisionBeforeArchive = latestSnapshot().payload.revision;
    useTallyStore
      .getState()
      .archiveSession(eveningC, '2026-07-30T20:08:00.000Z');
    await wakeForSnapshot();
    expect(latestSnapshot().payload.activeEvening).toBeNull();
    expect(latestSnapshot().payload.revision).toBe(
      revisionBeforeArchive + 1,
    );

    // Removing the last archived drink must purge the stale shadow evening,
    // otherwise a later snapshot/restart could resurrect it.
    useTallyStore.getState().removeDrinkById(drinkC);
    await wakeForSnapshot();
    const storedShadow = JSON.parse(
      (await AsyncStorage.getItem(
        MOBILE_WEARABLE_SHADOWS_STORAGE_KEY,
      )) ?? '{}',
    ) as {
      byAccount?: Record<
        string,
        { state?: { evenings?: Record<string, unknown> } }
      >;
    };
    expect(
      storedShadow.byAccount?.[ACCOUNT_ID]?.state?.evenings?.[eveningC],
    ).toBeUndefined();

    // Account cleanup invalidates processing synchronously, before AccountStore
    // publishes its replacement session.
    const acksBeforeBoundary = mockAckPendingCommands.mock.calls.length;
    const boundaryEvening = 'abababab-abab-4bab-8bab-abababababab';
    const boundaryDrink = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
    mockGetPendingCommands.mockResolvedValue([
      JSON.stringify(
        command(
          1,
          'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
          {
            type: 'start_evening_and_add_drink',
            eveningId: boundaryEvening,
            pub: PUB,
            drinkingDayKey: '2026-07-30',
            drink: {
              id: boundaryDrink,
              name: 'Bernard 11°',
              drinkType: 'beer',
              volumeMl: 500,
              priceCzk: 61,
              servingType: 'draft',
              recordedAt: '2026-07-30T20:09:00.000Z',
            },
          },
          {
            actorId: 'watchos-account-boundary',
            baseRevision: latestSnapshot().payload.revision,
            sentAt: '2026-07-30T20:09:00.000Z',
          },
        ),
      ),
    ]);
    beginMobileWearableAccountBoundary();
    listeners[0]?.();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
    expect(mockAckPendingCommands).toHaveBeenCalledTimes(acksBeforeBoundary);
    expect(useTallyStore.getState().hasDrink(boundaryDrink)).toBe(false);

    // A password-reset login may replace the session object without changing
    // accountId. That replacement must still resume a suspended cleanup
    // boundary; comparing accountId alone leaves sync disabled forever.
    const previousAccountState = mockAccountState;
    mockAccountState = { session: { accountId: ACCOUNT_ID } };
    for (const accountListener of mockAccountListeners) {
      accountListener(mockAccountState, previousAccountState);
    }
    await waitForExpectation(() => {
      expect(mockAckPendingCommands).toHaveBeenCalledTimes(
        acksBeforeBoundary + 1,
      );
    });
    expect(getMobileWearableSyncBoundary().suspended).toBe(false);
    expect(useTallyStore.getState().hasDrink(boundaryDrink)).toBe(true);

    // The fast WCSession channel can deliver sequence 2 before the durable
    // sequence 1 transfer. It must remain unacknowledged until sequence 1 lands.
    const orderingActor = 'watchos-unseen-ordering';
    const closeBoundary = command(
      1,
      '15151515-1515-4515-8515-151515151515',
      {
        type: 'close_evening',
        eveningId: boundaryEvening,
        closedAt: '2026-07-30T20:10:00.000Z',
      },
      {
        actorId: orderingActor,
        baseRevision: latestSnapshot().payload.revision,
        sentAt: '2026-07-30T20:10:00.000Z',
      },
    );
    const laterTarget = command(
      2,
      '16161616-1616-4616-8616-161616161616',
      {
        type: 'set_target',
        target: { selection: 'manual', pub: PUB_B },
      },
      {
        actorId: orderingActor,
        baseRevision: latestSnapshot().payload.revision + 1,
        sentAt: '2026-07-30T20:11:00.000Z',
      },
    );
    const acksBeforeGap = mockAckPendingCommands.mock.calls.length;
    const snapshotsBeforeGap = mockPublishSnapshot.mock.calls.length;
    mockGetPendingCommands.mockResolvedValue([
      JSON.stringify(laterTarget),
    ]);
    listeners[0]?.();
    await waitForExpectation(() => {
      expect(mockPublishSnapshot).toHaveBeenCalledTimes(
        snapshotsBeforeGap + 1,
      );
    });
    expect(mockAckPendingCommands).toHaveBeenCalledTimes(acksBeforeGap);
    expect(useTallyStore.getState().current?.clientId).toBe(boundaryEvening);

    await wakeWithPending([laterTarget, closeBoundary]);
    expect(mockAckPendingCommands.mock.calls.at(-1)?.[0]).toEqual([
      closeBoundary.messageId,
      laterTarget.messageId,
    ]);
    expect(useTallyStore.getState().current).toBeNull();
    expect(
      useTallyStore
        .getState()
        .history.find((session) => session.clientId === boundaryEvening)
        ?.closedAt,
    ).toBe('2026-07-30T20:10:00.000Z');

    // Logging A → B → A must recover A's epoch and reducer shadow. The normal
    // account teardown removes the projected Tally state, so a queued add/close
    // must still find its old evening from the account-scoped shadow ledger.
    const originalEpoch = latestSnapshot().accountEpoch;
    const accountB = '2c90bf17-19e9-42e6-9dae-60df26759bf9';
    useTallyStore.setState({
      current: null,
      history: [],
      removedDrinkIds: [],
    });
    useWearableTargetStore.getState().reset();
    mockGetPendingCommands.mockResolvedValue([]);
    const accountABeforeSwitch = mockAccountState;
    mockAccountState = { session: { accountId: accountB } };
    for (const accountListener of mockAccountListeners) {
      accountListener(mockAccountState, accountABeforeSwitch);
    }
    await waitForExpectation(() => {
      expect(latestSnapshot().accountEpoch).not.toBe(originalEpoch);
      expect(latestSnapshot().payload.activeEvening).toBeNull();
    });

    const acksBeforeReturningToA = mockAckPendingCommands.mock.calls.length;
    const returnedDrink = '17171717-1717-4717-8717-171717171717';
    const addAfterReturn = command(
      2,
      '18181818-1818-4818-8818-181818181818',
      {
        type: 'add_drink',
        eveningId: boundaryEvening,
        drink: {
          id: returnedDrink,
          name: 'Gambrinus 10°',
          drinkType: 'beer',
          volumeMl: 500,
          priceCzk: 55,
          servingType: 'draft',
          recordedAt: '2026-07-30T20:12:00.000Z',
        },
      },
      {
        actorId: 'watchos-account-boundary',
        baseRevision: 0,
        sentAt: '2026-07-30T20:12:00.000Z',
      },
    );
    const closeAfterReturn = command(
      3,
      '19191919-1919-4919-8919-191919191919',
      {
        type: 'close_evening',
        eveningId: boundaryEvening,
        closedAt: '2026-07-30T20:13:00.000Z',
      },
      {
        actorId: 'watchos-account-boundary',
        baseRevision: 0,
        sentAt: '2026-07-30T20:13:00.000Z',
      },
    );
    mockGetPendingCommands.mockResolvedValue([
      JSON.stringify(closeAfterReturn),
      JSON.stringify(addAfterReturn),
    ]);
    const accountBBeforeSwitch = mockAccountState;
    mockAccountState = { session: { accountId: ACCOUNT_ID } };
    for (const accountListener of mockAccountListeners) {
      accountListener(mockAccountState, accountBBeforeSwitch);
    }
    await waitForExpectation(() => {
      expect(latestSnapshot().accountEpoch).toBe(originalEpoch);
      expect(mockAckPendingCommands).toHaveBeenCalledTimes(
        acksBeforeReturningToA + 1,
      );
    });
    expect(mockAckPendingCommands.mock.calls.at(-1)?.[0]).toEqual([
      addAfterReturn.messageId,
      closeAfterReturn.messageId,
    ]);
    expect(
      useTallyStore
        .getState()
        .history.find((session) => session.clientId === boundaryEvening),
    ).toMatchObject({
      closedAt: '2026-07-30T20:10:00.000Z',
      drinks: [
        expect.objectContaining({ id: boundaryDrink }),
        expect.objectContaining({ id: returnedDrink }),
      ],
    });

    const epochBindings = JSON.parse(
      mockSecureStoreValues.get('na-pivo-wearable-account-epochs-v2') ?? '{}',
    ) as { byAccount?: Record<string, string> };
    expect(epochBindings.byAccount?.[ACCOUNT_ID]).toBe(originalEpoch);
    expect(epochBindings.byAccount?.[accountB]).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    const accountShadows = JSON.parse(
      (await AsyncStorage.getItem(MOBILE_WEARABLE_SHADOWS_STORAGE_KEY)) ??
        '{}',
    ) as {
      byAccount?: Record<
        string,
        {
          accountEpoch?: string;
          state?: {
            evenings?: Record<string, { drinks?: { id: string }[] }>;
          };
        }
      >;
    };
    expect(accountShadows.byAccount?.[ACCOUNT_ID]).toMatchObject({
      accountEpoch: originalEpoch,
      state: {
        evenings: {
          [boundaryEvening]: {
            drinks: expect.arrayContaining([
              expect.objectContaining({ id: returnedDrink }),
            ]),
          },
        },
      },
    });
    expect(accountShadows.byAccount?.[accountB]).toMatchObject({
      state: { evenings: {} },
    });
  });
});
