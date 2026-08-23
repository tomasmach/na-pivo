import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLeaderboardsCache } from '../leaderboardsClient';
import { clearPhotoContestCache } from '../photoContestClient';
import {
  clearLocalPrivateAccountData,
  PRIVATE_STORAGE_KEYS,
  rehydratePrivateStoresAfterBoundary,
  resetPrivateAccountMemory,
} from '../privateAccountData';
import privateAccountStorage from '../privateAccountStorage';
import {
  isPrivateAccountMutationFrozen,
  PrivateAccountMutationFrozenError,
  setPrivateAccountDeletionRecoveryBlocked,
} from '../privateAccountBoundary';
import { useCommunityStore } from '@/stores/communityStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { usePartyGamesStore } from '@/stores/partyGamesStore';
import {
  clearContestResultsAccountData,
  useContestResultsStore,
} from '@/stores/contestResultsStore';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../telemetryClient', () => ({
  setTelemetrySession: jest.fn(),
  trackApiFailure: jest.fn(),
  trackClientEvent: jest.fn(async () => undefined),
}));

jest.mock('../leaderboardsClient', () => ({
  clearLeaderboardsCache: jest.fn(),
}));

jest.mock('../photoContestClient', () => ({
  clearPhotoContestCache: jest.fn(),
  enterPhotoContest: jest.fn(),
}));

jest.mock('@/liveActivity/liveBeerActivity', () => ({
  clearLiveBeerActivityForAccountBoundary: jest.fn(async () => true),
}));

jest.mock('@/notifications/beerCountReminder', () => ({
  clearBeerCountReminderForAccountBoundary: jest.fn(async () => true),
}));

jest.mock('@/notifications/pubReminderNotifications', () => ({
  clearPubReminderAccountData: jest.fn(async () => true),
}));

jest.mock('@/stores/contestResultsStore', () => ({
  CONTEST_RESULTS_STORAGE_KEY: 'na-pivo-contest-results',
  clearContestResultsAccountData: jest.fn(async () => undefined),
  useContestResultsStore: {
    setState: jest.fn(),
    persist: {
      hasHydrated: jest.fn(() => true),
      rehydrate: jest.fn(async () => undefined),
    },
  },
}));

const PRIVATE_KEYS = [
  'na-pivo-tally',
  'na-pivo-pub-ratings',
  'na-pivo-pub-amenities',
  'na-pivo-visits-seeded',
  'na-pivo-drinks-history-seeded-v1',
  'na-pivo-drinks-history-progress-v1',
  'na-pivo-drinks-queue',
  'na-pivo-delete-drinks-queue',
  'na-pivo-update-drinks-queue',
  'na-pivo-beer-checkins-queue',
  'na-pivo-beer-photos',
  'na-pivo-beer-photos-queue',
  'na-pivo-feedback-queue',
  'na-pivo-account-preferences-queue',
  'na-pivo-added-pubs-queue',
  'na-pivo-community-queue',
  'na-pivo-pub-name-corrections-queue',
  'na-pivo-pub-report-queue',
  'na-pivo-visits-queue',
  'na-pivo-pub-ratings-queue',
  'na-pivo-pub-amenities-queue',
  'na-pivo-community',
  'na-pivo-pub',
  'na-pivo-visits-map-snapshot',
  'na-pivo-friends-queue',
  'na-pivo-friends-dashboard',
  'na-pivo-nights-queue',
  'na-pivo-search-recent-v1',
  'na-pivo-party-groups',
  'na-pivo-party-games-queue',
  'na-pivo-party-game-starts-queue',
  'na-pivo-party-games-queue-quarantine-v1',
  'na-pivo-party-game-starts-queue-quarantine-v1',
  'na-pivo-party-evening-actions-queue',
  'na-pivo-party-evening-identity-v1',
  'na-pivo-live-party',
  'na-pivo-party-night-records-v1',
  'na-pivo-contest-results',
  'na-pivo-vycep',
  'na-pivo-pending-invite-code',
  'na-pivo-beer-count-reminder-state',
  'na-pivo-pub-reminder-state',
  'na-pivo-pub-reminder-geofences',
];

function session(overrides: Partial<TallySession> = {}): TallySession {
  return {
    clientId: 'visit-1',
    pubKey: 'u2fkbn1x',
    pubName: 'U Testu',
    startedAt: '2026-06-14T19:00:00.000Z',
    drinks: [
      {
        id: 'drink-1',
        beerName: 'Plzeň',
        priceCzk: 62,
        at: '2026-06-14T19:10:00.000Z',
      },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useTallyStore.setState({ current: null, history: [] });
  useCommunityStore.setState({ overrides: {} });
  usePubRatingsStore.setState({ ratings: {} });
  usePubAmenitiesStore.setState({ votes: {} });
  usePubStore.setState({
    revealedPub: null,
    reportedPubIds: [],
    reportedCacheKeys: [],
  });
  useSettingsStore.setState({
    homePoint: null,
    navigationProvider: 'google',
    priceCurrency: 'CZK',
    priceCurrencyRate: 1,
  });
  useLivePartyStore.getState().end();
  usePartyEveningStore.setState({
    evening: null,
    confirmedIdentity: null,
    lastEvening: null,
    busy: false,
    loaded: false,
    error: null,
    pendingJoinCode: null,
  });
  usePartyGamesStore.setState({
    code: null,
    games: [],
    events: [],
    live: false,
  });
  useBeerPhotosStore.setState({ photos: [] });
});

it('clears local private stores and private sync queue storage', async () => {
  expect(new Set(PRIVATE_STORAGE_KEYS)).toEqual(new Set(PRIVATE_KEYS));
  useTallyStore.setState({
    current: session(),
    history: [session({ clientId: 'visit-2' })],
  });
  usePubRatingsStore.setState({
    ratings: {
      u2fkbn1x: {
        verdict: 'like',
        note: 'Výčep drží',
        updatedAt: '2026-06-14T20:00:00.000Z',
      },
    },
  });
  usePubAmenitiesStore.setState({
    votes: {
      u2fkbn1x: {
        game_darts: { vote: 'yes', updatedAt: '2026-06-14T20:00:00.000Z' },
      },
    },
  });
  useCommunityStore.setState({
    overrides: {
      u2fkbn1x: {
        beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }],
        updatedAt: Date.now(),
      },
    },
  });
  usePubStore.setState({
    revealedPub: {
      id: 'mapy:test',
      name: 'U Testu',
      lat: 50.0812,
      lng: 14.4182,
    },
    reportedPubIds: ['mapy:test'],
    reportedCacheKeys: ['u2fkbn1x'],
  });
  useLivePartyStore.getState().start('U Tajného stolu', 'Ležák', 'u2fkbjgx');
  usePartyEveningStore.setState({
    confirmedIdentity: {
      id: 'active-evening',
      joinCode: 'STUL24',
      isHost: true,
      confirmedAt: Date.now(),
    },
    lastEvening: {
      id: 'old-evening',
      joinCode: 'STUL24',
      joinUrl: 'https://na-pivo.cz/party/STUL24',
      host: {
        id: 'old',
        nickname: 'stary',
        displayName: 'Starý',
        avatarUrl: null,
      },
      pubName: 'U Tajného stolu',
      pubCity: 'Praha',
      active: false,
      startedAt: '2026-06-14T19:00:00.000Z',
      endedAt: '2026-06-14T22:00:00.000Z',
      isHost: true,
      members: [],
      events: [],
    },
  });
  usePartyGamesStore.setState({
    code: 'STUL24',
    games: [],
    events: [],
    live: true,
  });
  useBeerPhotosStore.getState().addPendingPhoto({
    clientId: 'private-photo',
    localUri: 'file:///private-photo.jpg',
    caption: 'Soukromá',
    visibility: 'private',
    takenAt: '2026-06-14T20:00:00.000Z',
  });

  for (const key of PRIVATE_KEYS) {
    await AsyncStorage.setItem(key, JSON.stringify({ private: true }));
  }
  const privateFeedCacheKey = 'na-pivo-night-feed-v1:account-a:friends';
  await AsyncStorage.setItem(privateFeedCacheKey, JSON.stringify({ private: true }));
  useSettingsStore.setState({
    homePoint: { lat: 50.08, lng: 14.42 },
    navigationProvider: 'mapy',
  });
  await AsyncStorage.setItem(
    'na-pivo-settings',
    JSON.stringify({
      state: {
        homePoint: { lat: 50.08, lng: 14.42 },
        navigationProvider: 'mapy',
      },
      version: 1,
    }),
  );

  await expect(clearLocalPrivateAccountData()).resolves.toEqual({ ok: true });

  expect(useTallyStore.getState().current).toBeNull();
  expect(useTallyStore.getState().history).toEqual([]);
  expect(useCommunityStore.getState().overrides).toEqual({});
  expect(usePubRatingsStore.getState().ratings).toEqual({});
  expect(usePubAmenitiesStore.getState().votes).toEqual({});
  expect(usePubStore.getState().revealedPub).toBeNull();
  expect(usePubStore.getState().reportedPubIds).toEqual([]);
  expect(usePubStore.getState().reportedCacheKeys).toEqual([]);
  expect(useSettingsStore.getState().homePoint).toBeNull();
  expect(useSettingsStore.getState().navigationProvider).toBe('mapy');
  expect(useLivePartyStore.getState().live).toBe(false);
  expect(useLivePartyStore.getState().pubVisits).toEqual([]);
  expect(usePartyEveningStore.getState().evening).toBeNull();
  expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull();
  expect(usePartyEveningStore.getState().lastEvening).toBeNull();
  expect(usePartyGamesStore.getState()).toMatchObject({
    code: null,
    games: [],
    events: [],
    live: false,
  });
  expect(useBeerPhotosStore.getState().photos).toEqual([]);
  expect(clearLeaderboardsCache).toHaveBeenCalledTimes(1);
  expect(clearPhotoContestCache).toHaveBeenCalledTimes(1);
  expect(clearContestResultsAccountData).toHaveBeenCalledTimes(1);

  const settings = JSON.parse((await AsyncStorage.getItem('na-pivo-settings')) as string) as {
    state: { homePoint: unknown; navigationProvider: string };
  };
  expect(settings.state.homePoint).toBeNull();
  expect(settings.state.navigationProvider).toBe('mapy');

  for (const key of PRIVATE_KEYS) {
    expect({ key, value: await AsyncStorage.getItem(key) }).toEqual({
      key,
      value: null,
    });
  }
  expect(await AsyncStorage.getItem(privateFeedCacheKey)).toBeNull();
});

it('final memory reset removes a late explicit pub stop from the outgoing account', () => {
  useLivePartyStore.setState({
    live: true,
    pubVisits: [
      {
        clientId: 'visit-account-a',
        pubKey: 'u2fkbn1x',
        pubName: 'Soukromá štace A',
        startedAt: '2026-08-06T18:00:00.000Z',
      },
    ],
  });

  resetPrivateAccountMemory();

  expect(useLivePartyStore.getState()).toMatchObject({ live: false, pubVisits: [] });
});

it('fails closed after synchronous invalidation when a helper or final removal fails', async () => {
  useTallyStore.setState({ current: session(), history: [] });
  const clearContestResults =
    clearContestResultsAccountData as jest.MockedFunction<
      typeof clearContestResultsAccountData
  >;
  clearContestResults.mockRejectedValueOnce(new Error('storage unavailable'));
  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<
    typeof AsyncStorage.removeItem
  >;
  const originalRemoveItem = removeItem.getMockImplementation();
  expect(originalRemoveItem).toBeDefined();
  removeItem.mockImplementation((key) =>
    key === 'na-pivo-search-recent-v1'
      ? Promise.reject(new Error('storage unavailable'))
      : originalRemoveItem!(key),
  );

  try {
    await expect(clearLocalPrivateAccountData()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'storage',
        failedOperations: expect.arrayContaining([
          'contest_results',
          'remove:na-pivo-search-recent-v1',
        ]),
      }),
    );
  } finally {
    removeItem.mockImplementation(originalRemoveItem!);
  }

  expect(useTallyStore.getState().current).toBeNull();
  expect(useBeerPhotosStore.getState().photos).toEqual([]);
});

it('succeeds on retry after a transient durable removal failure', async () => {
  await AsyncStorage.setItem('na-pivo-tally', JSON.stringify({ private: true }));
  const removeItem = AsyncStorage.removeItem as jest.MockedFunction<
    typeof AsyncStorage.removeItem
  >;
  const originalRemoveItem = removeItem.getMockImplementation();
  expect(originalRemoveItem).toBeDefined();
  let failedOnce = false;
  removeItem.mockImplementation((key) => {
    if (key === 'na-pivo-tally' && !failedOnce) {
      failedOnce = true;
      return Promise.reject(new Error('storage unavailable'));
    }
    return originalRemoveItem!(key);
  });

  try {
    await expect(clearLocalPrivateAccountData()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'storage' }),
    );
    await expect(clearLocalPrivateAccountData()).resolves.toEqual({ ok: true });
  } finally {
    removeItem.mockImplementation(originalRemoveItem!);
  }
  expect(await AsyncStorage.getItem('na-pivo-tally')).toBeNull();
});

it('fails closed when dynamic private-key discovery is unreadable', async () => {
  const getAllKeys = AsyncStorage.getAllKeys as jest.MockedFunction<
    typeof AsyncStorage.getAllKeys
  >;
  const originalGetAllKeys = getAllKeys.getMockImplementation();
  expect(originalGetAllKeys).toBeDefined();
  let failuresRemaining = 2;
  getAllKeys.mockImplementation(() => {
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      return Promise.reject(new Error('storage unavailable'));
    }
    return originalGetAllKeys!();
  });

  try {
    await expect(clearLocalPrivateAccountData()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'storage',
        failedOperations: expect.arrayContaining(['discover_dynamic_storage']),
      }),
    );
  } finally {
    getAllKeys.mockImplementation(originalGetAllKeys!);
  }

  await expect(clearLocalPrivateAccountData()).resolves.toEqual({ ok: true });
});

it('fails closed when the persisted home point cannot be read, then retries', async () => {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  const originalGetItem = getItem.getMockImplementation();
  expect(originalGetItem).toBeDefined();
  let failuresRemaining = 2;
  getItem.mockImplementation((key) => {
    if (key === 'na-pivo-settings' && failuresRemaining > 0) {
      failuresRemaining -= 1;
      return Promise.reject(new Error('storage unavailable'));
    }
    return originalGetItem!(key);
  });

  try {
    await expect(clearLocalPrivateAccountData()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'storage',
        failedOperations: expect.arrayContaining([
          'settings_private_fields',
          'verify_settings_private_fields',
        ]),
      }),
    );
    await expect(clearLocalPrivateAccountData()).resolves.toEqual({ ok: true });
  } finally {
    getItem.mockImplementation(originalGetItem!);
  }
});

it('reports rehydration failure when storage reads reject during pending deletion recovery', async () => {
  await AsyncStorage.setItem(
    'na-pivo-tally',
    JSON.stringify({ state: { current: session(), history: [] }, version: 1 }),
  );

  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  const originalGetItem = getItem.getMockImplementation();
  expect(originalGetItem).toBeDefined();
  getItem.mockImplementation(() => Promise.reject(new Error('storage unavailable')));
  setPrivateAccountDeletionRecoveryBlocked(true);

  try {
    expect(isPrivateAccountMutationFrozen()).toBe(true);
    await expect(privateAccountStorage.getItem('na-pivo-tally')).rejects.toBeInstanceOf(
      PrivateAccountMutationFrozenError,
    );
    await expect(AsyncStorage.getItem('na-pivo-tally')).rejects.toThrow('storage unavailable');

    const rehydrated = await rehydratePrivateStoresAfterBoundary();

    expect(rehydrated).toBe(false);
    expect(useTallyStore.getState().current).toBeNull();
  } finally {
    getItem.mockImplementation(originalGetItem!);
    setPrivateAccountDeletionRecoveryBlocked(false);
  }
});

it('rehydrates stores through authorized reads while deletion recovery stays frozen', async () => {
  await AsyncStorage.setItem(
    'na-pivo-tally',
    JSON.stringify({ state: { current: session(), history: [] }, version: 1 }),
  );
  setPrivateAccountDeletionRecoveryBlocked(true);

  try {
    expect(isPrivateAccountMutationFrozen()).toBe(true);

    await expect(
      privateAccountStorage.setItem('na-pivo-tally', '{"state":{"current":null}}'),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
    await expect(
      privateAccountStorage.removeItem('na-pivo-tally'),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
    await expect(privateAccountStorage.getItem('na-pivo-tally')).rejects.toBeInstanceOf(
      PrivateAccountMutationFrozenError,
    );

    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(true);
    expect(useTallyStore.getState().current).toMatchObject({ clientId: 'visit-1' });

    await expect(privateAccountStorage.getItem('na-pivo-tally')).rejects.toBeInstanceOf(
      PrivateAccountMutationFrozenError,
    );
    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(true);
  } finally {
    setPrivateAccountDeletionRecoveryBlocked(false);
  }
});

it('fails when persisted tally payload is malformed during blocked deletion recovery', async () => {
  await AsyncStorage.setItem('na-pivo-tally', '{broken');
  setPrivateAccountDeletionRecoveryBlocked(true);

  try {
    expect(isPrivateAccountMutationFrozen()).toBe(true);

    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(false);
    expect(useTallyStore.getState().current).toBeNull();
  } finally {
    setPrivateAccountDeletionRecoveryBlocked(false);
  }
});

it('fails closed when useTallyStore.persist.hasHydrated reports no hydration after rehydrate', async () => {
  const rehydrateSpy = jest
    .spyOn(useTallyStore.persist, 'rehydrate')
    .mockResolvedValue(undefined);
  const hasHydratedSpy = jest
    .spyOn(useTallyStore.persist, 'hasHydrated')
    .mockReturnValue(false);

  try {
    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(false);
  } finally {
    rehydrateSpy.mockRestore();
    hasHydratedSpy.mockRestore();
  }
});

it('migration writes current raw versions for tally and settings behind blocked recovery', async () => {
  await AsyncStorage.setItem(
    'na-pivo-tally',
    JSON.stringify({ state: { current: session(), history: [] }, version: 0 }),
  );
  await AsyncStorage.setItem(
    'na-pivo-settings',
    JSON.stringify({
      state: { homePoint: null, priceCurrency: 'CZK', priceCurrencyRate: 1 },
      version: 0,
    }),
  );
  setPrivateAccountDeletionRecoveryBlocked(true);

  try {
    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(true);
    expect(useTallyStore.getState().current).toMatchObject({ clientId: 'visit-1' });

    const tallyRaw = JSON.parse((await AsyncStorage.getItem('na-pivo-tally')) as string) as {
      version?: number;
    };
    const settingsRaw = JSON.parse(
      (await AsyncStorage.getItem('na-pivo-settings')) as string,
    ) as { version?: number };
    expect(tallyRaw.version).toBe(1);
    expect(settingsRaw.version).toBe(2);
  } finally {
    setPrivateAccountDeletionRecoveryBlocked(false);
  }
});

it('resets stale tally memory when the blocked-recovery migration write fails', async () => {
  await AsyncStorage.setItem(
    'na-pivo-tally',
    JSON.stringify({ state: { current: session(), history: [] }, version: 0 }),
  );

  const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
  const originalSetItem = setItem.getMockImplementation();
  expect(originalSetItem).toBeDefined();
  setItem.mockImplementation((key, value) =>
    key === 'na-pivo-tally'
      ? Promise.reject(new Error('storage unavailable'))
      : originalSetItem!(key, value),
  );
  setPrivateAccountDeletionRecoveryBlocked(true);

  try {
    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(false);
    expect(useTallyStore.persist.hasHydrated()).toBe(false);
    expect(useTallyStore.getState().current).toBeNull();
    expect(useTallyStore.getState().history).toEqual([]);
  } finally {
    setItem.mockImplementation(originalSetItem!);
    setPrivateAccountDeletionRecoveryBlocked(false);
  }
});

it('resolves false when a real settings onRehydrate callback throws during blocked recovery', async () => {
  await AsyncStorage.setItem(
    'na-pivo-settings',
    JSON.stringify({
      state: { homePoint: null, priceCurrency: { bad: true }, priceCurrencyRate: 2 },
      version: 2,
    }),
  );
  setPrivateAccountDeletionRecoveryBlocked(true);

  try {
    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(false);
  } finally {
    setPrivateAccountDeletionRecoveryBlocked(false);
  }
});

it('unrelated private keys stay frozen while an authorized tally read is pending', async () => {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
  const originalGetItem = getItem.getMockImplementation();
  expect(originalGetItem).toBeDefined();
  let releaseTallyRead!: (value: string | null) => void;
  const pendingTallyRead = new Promise<string | null>((resolve) => {
    releaseTallyRead = resolve;
  });
  getItem.mockImplementation((key) =>
    key === 'na-pivo-tally' ? pendingTallyRead : originalGetItem!(key),
  );
  setPrivateAccountDeletionRecoveryBlocked(true);

  try {
    const hydration = rehydratePrivateStoresAfterBoundary();
    await Promise.resolve();

    await expect(
      privateAccountStorage.getItem('na-pivo-unrelated'),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
    await expect(
      privateAccountStorage.setItem('na-pivo-unrelated', '{}'),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);

    releaseTallyRead(null);
    await expect(hydration).resolves.toBe(true);
  } finally {
    getItem.mockImplementation(originalGetItem!);
    setPrivateAccountDeletionRecoveryBlocked(false);
  }
});

it('queues a concurrent boundary rehydration behind the in-flight tally pass', async () => {
  let releaseTallyRehydrate!: () => void;
  const blockedTallyRehydrate = new Promise<void>((resolve) => {
    releaseTallyRehydrate = resolve;
  });
  let tallyInvocations = 0;
  const rehydrateSpy = jest
    .spyOn(useTallyStore.persist, 'rehydrate')
    .mockImplementation(() => {
      tallyInvocations += 1;
      if (tallyInvocations === 1) return blockedTallyRehydrate;
      return Promise.resolve();
    });

  let first: Promise<boolean> | null = null;
  let second: Promise<boolean> | null = null;
  try {
    first = rehydratePrivateStoresAfterBoundary();
    second = rehydratePrivateStoresAfterBoundary();

    expect(tallyInvocations).toBe(1);
  } finally {
    releaseTallyRehydrate();
    await Promise.allSettled(
      [first, second].filter((pending): pending is Promise<boolean> => pending !== null),
    );
    rehydrateSpy.mockRestore();
  }

  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(true);
});

it('resolves false when contestResults rehydrate throws synchronously', async () => {
  const rehydrateMock = useContestResultsStore.persist.rehydrate as jest.Mock;
  const originalImplementation = rehydrateMock.getMockImplementation();
  expect(originalImplementation).toBeDefined();
  rehydrateMock.mockImplementation(() => {
    throw new Error('contest results rehydrate exploded');
  });

  try {
    await expect(rehydratePrivateStoresAfterBoundary()).resolves.toBe(false);
  } finally {
    rehydrateMock.mockImplementation(originalImplementation!);
  }
});
