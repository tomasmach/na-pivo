import type { WearableCommandEnvelope, WearablePubRef } from '../protocol';

const ACCOUNT_ID = '1b89af06-08d8-41d5-8c9d-59ce15648af8';
const ACCOUNT_EPOCH = '924decbc-b2e0-4ba1-8e14-5e3ebf9ad4af';
const ACTOR_ID = 'watchos-watermark-test';
const PUB: WearablePubRef = {
  pubKey: 'u2fkbn4f',
  name: 'U Zlatého tygra',
  latitude: 50.08706,
  longitude: 14.41786,
};

type MockAccountState = { session: { accountId: string } | null };

let mockAccountState: MockAccountState = {
  session: { accountId: ACCOUNT_ID },
};
const mockAccountListeners: ((
  state: MockAccountState,
  previous: MockAccountState,
) => void)[] = [];
const mockWearableListeners: (() => void)[] = [];
const mockSecureStoreValues = new Map<string, string>();
const mockPublishSnapshot = jest.fn<Promise<void>, [string]>(
  async () => undefined,
);
const mockAckPendingCommands = jest.fn<Promise<void>, [string[]]>(
  async () => undefined,
);
const mockRequestSync = jest.fn<Promise<void>, []>(async () => undefined);
const mockGetPendingCommands = jest.fn<Promise<string[]>, []>(
  async () => [],
);
const mockGetAcknowledgedActorSequences = jest.fn<
  Promise<Record<string, number>>,
  [string]
>(async () => ({}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(
    async (key: string) => mockSecureStoreValues.get(key) ?? null,
  ),
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
    pendingCommands: 0,
    lastReceivedAt: null,
    lastSentAt: null,
  })),
  addWearableCommandListener: jest.fn((listener: () => void) => {
    mockWearableListeners.push(listener);
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

function targetCommand(
  sequence: number,
  messageId: string,
): WearableCommandEnvelope {
  return {
    protocolVersion: 1,
    messageId,
    accountEpoch: ACCOUNT_EPOCH,
    actorId: ACTOR_ID,
    actorKind: 'watchos',
    actorSequence: sequence,
    baseRevision: 0,
    sentAt: `2026-07-30T20:${String(sequence).padStart(2, '0')}:00.000Z`,
    kind: 'command',
    payload: {
      command: {
        type: 'set_target',
        target: { selection: 'manual', pub: PUB },
      },
    },
  };
}

function clearTargetCommand(
  sequence: number,
  messageId: string,
): WearableCommandEnvelope {
  return {
    ...targetCommand(sequence, messageId),
    payload: { command: { type: 'clear_target' } },
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

async function runIsolated(
  scenario: (harness: {
    AsyncStorage: typeof import('@react-native-async-storage/async-storage').default;
    initializeMobileWearableSync: typeof import('../mobileSync').initializeMobileWearableSync;
    useTallyStore: typeof import('@/stores/tallyStore').useTallyStore;
    useWearableTargetStore: typeof import('@/stores/wearableTargetStore').useWearableTargetStore;
    boundary: typeof import('../mobileSyncBoundary');
  }) => Promise<void>,
): Promise<void> {
  jest.resetModules();
  mockAccountListeners.length = 0;
  mockWearableListeners.length = 0;
  mockAccountState = { session: { accountId: ACCOUNT_ID } };
  mockSecureStoreValues.clear();
  mockSecureStoreValues.set(
    'na-pivo-wearable-account-epochs-v2',
    JSON.stringify({
      version: 2,
      byAccount: { [ACCOUNT_ID]: ACCOUNT_EPOCH },
    }),
  );
  mockPublishSnapshot.mockReset().mockResolvedValue(undefined);
  mockAckPendingCommands.mockReset().mockResolvedValue(undefined);
  mockRequestSync.mockReset().mockResolvedValue(undefined);
  mockGetPendingCommands.mockReset().mockResolvedValue([]);
  mockGetAcknowledgedActorSequences.mockReset().mockResolvedValue({});

  await jest.isolateModulesAsync(async () => {
    const [
      { default: AsyncStorage },
      { initializeMobileWearableSync },
      { useTallyStore },
      { useWearableTargetStore },
      boundary,
    ] = await Promise.all([
      import('@react-native-async-storage/async-storage'),
      import('../mobileSync'),
      import('@/stores/tallyStore'),
      import('@/stores/wearableTargetStore'),
      import('../mobileSyncBoundary'),
    ]);
    await AsyncStorage.clear();
    useTallyStore.setState({
      current: null,
      history: [],
      removedDrinkIds: [],
    });
    useWearableTargetStore.getState().reset();
    await scenario({
      AsyncStorage,
      initializeMobileWearableSync,
      useTallyStore,
      useWearableTargetStore,
      boundary,
    });
  });
}

describe('mobile wearable ACK watermarks', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reapplies and acknowledges sequence two after logout cleared both shadows', async () => {
    await runIsolated(async ({
      AsyncStorage,
      initializeMobileWearableSync,
      useWearableTargetStore,
      boundary,
    }) => {
      const pending = targetCommand(
        2,
        '22222222-2222-4222-8222-222222222222',
      );
      mockGetAcknowledgedActorSequences.mockResolvedValue({ [ACTOR_ID]: 1 });
      mockGetPendingCommands.mockResolvedValue([JSON.stringify(pending)]);
      await AsyncStorage.removeItem(boundary.MOBILE_WEARABLE_SHADOW_STORAGE_KEY);
      await AsyncStorage.removeItem(boundary.MOBILE_WEARABLE_SHADOWS_STORAGE_KEY);

      await initializeMobileWearableSync();

      expect(mockGetAcknowledgedActorSequences).toHaveBeenCalledWith(
        ACCOUNT_EPOCH,
      );
      expect(mockAckPendingCommands).toHaveBeenCalledWith([pending.messageId]);
      expect(useWearableTargetStore.getState().manualTarget).toEqual(PUB);
    });
  });

  it('keeps sequence seven unacknowledged until pending sequence six closes the gap', async () => {
    await runIsolated(async ({ initializeMobileWearableSync }) => {
      const sixth = clearTargetCommand(
        6,
        '66666666-6666-4666-8666-666666666666',
      );
      const seventh = clearTargetCommand(
        7,
        '77777777-7777-4777-8777-777777777777',
      );
      mockGetAcknowledgedActorSequences.mockResolvedValue({ [ACTOR_ID]: 5 });
      mockGetPendingCommands.mockResolvedValue([JSON.stringify(seventh)]);

      await initializeMobileWearableSync();
      expect(mockAckPendingCommands).not.toHaveBeenCalled();

      mockGetPendingCommands.mockResolvedValue([
        JSON.stringify(seventh),
        JSON.stringify(sixth),
      ]);
      mockWearableListeners[0]?.();
      await waitForExpectation(() => {
        expect(mockAckPendingCommands).toHaveBeenCalledTimes(1);
      });
      expect(mockAckPendingCommands).toHaveBeenCalledWith([
        sixth.messageId,
        seventh.messageId,
      ]);
    });
  });

  it('replays processed sequence one when cleanup wins before ACK and leases an in-flight ACK', async () => {
    await runIsolated(async ({
      AsyncStorage,
      initializeMobileWearableSync,
      useTallyStore,
      useWearableTargetStore,
      boundary,
    }) => {
      const pending = targetCommand(
        1,
        '11111111-1111-4111-8111-111111111111',
      );
      mockGetPendingCommands.mockResolvedValue([JSON.stringify(pending)]);
      let releasePublish!: () => void;
      mockPublishSnapshot.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releasePublish = resolve;
          }),
      );

      const firstActivation = initializeMobileWearableSync();
      await waitForExpectation(() => {
        expect(mockPublishSnapshot).toHaveBeenCalledTimes(1);
      });
      boundary.beginMobileWearableAccountBoundary();
      releasePublish();
      await firstActivation;
      expect(mockAckPendingCommands).not.toHaveBeenCalled();

      await AsyncStorage.removeItem(boundary.MOBILE_WEARABLE_SHADOW_STORAGE_KEY);
      await AsyncStorage.removeItem(boundary.MOBILE_WEARABLE_SHADOWS_STORAGE_KEY);
      useTallyStore.setState({
        current: null,
        history: [],
        removedDrinkIds: [],
      });
      useWearableTargetStore.getState().reset();
      mockGetAcknowledgedActorSequences.mockResolvedValue({});

      let releaseAcknowledgement!: () => void;
      mockAckPendingCommands.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseAcknowledgement = resolve;
          }),
      );
      const previousAccountState = mockAccountState;
      mockAccountState = { session: { accountId: ACCOUNT_ID } };
      for (const listener of mockAccountListeners) {
        listener(mockAccountState, previousAccountState);
      }
      await waitForExpectation(() => {
        expect(mockAckPendingCommands).toHaveBeenCalledTimes(1);
      });
      expect(useWearableTargetStore.getState().manualTarget).toEqual(PUB);

      boundary.beginMobileWearableAccountBoundary();
      let idleSettled = false;
      const idle = boundary.waitForMobileWearableSyncIdle().then(() => {
        idleSettled = true;
      });
      await Promise.resolve();
      expect(idleSettled).toBe(false);
      releaseAcknowledgement();
      await idle;
      expect(idleSettled).toBe(true);
    });
  });
});
