import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearWearableSnapshot } from 'na-pivo-wearable-bridge';

import { clearLocalPrivateAccountData } from '../privateAccountData';
import { useCommunityStore } from '@/stores/communityStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWearableTargetStore } from '@/stores/wearableTargetStore';
import { beginMobileWearableSyncOperation } from '@/wearables/mobileSyncBoundary';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

jest.mock('na-pivo-wearable-bridge', () => ({
  clearWearableSnapshot: jest.fn(async () => undefined),
}));

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
  'na-pivo-feedback-queue',
  'na-pivo-added-pubs-queue',
  'na-pivo-community-queue',
  'na-pivo-pub-name-corrections-queue',
  'na-pivo-pub-report-queue',
  'na-pivo-visits-queue',
  'na-pivo-pub-ratings-queue',
  'na-pivo-pub-amenities-queue',
  'na-pivo-community',
  'na-pivo-pub',
  'na-pivo-wearable-phone-shadow-v1',
  'na-pivo-wearable-phone-shadows-v2',
  'na-pivo-wearable-target-v1',
];

const mockClearWearableSnapshot =
  clearWearableSnapshot as jest.MockedFunction<typeof clearWearableSnapshot>;

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
  mockClearWearableSnapshot.mockResolvedValue(undefined);
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
  useSettingsStore.setState({ homePoint: null, navigationProvider: 'google' });
  useWearableTargetStore.getState().reset();
  useFocusedPubStore.setState({ pub: null });
});

it('clears local private stores and private sync queue storage', async () => {
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
  useWearableTargetStore.setState({
    manualTarget: {
      pubKey: 'u2fkbn1x',
      name: 'U Testu',
      latitude: 50.0812,
      longitude: 14.4182,
    },
  });
  useFocusedPubStore.setState({
    pub: {
      cacheKey: 'u2fkbn1x',
      name: 'U Testu',
      lat: 50.0812,
      lng: 14.4182,
    },
  });
  mockClearWearableSnapshot.mockImplementationOnce(async () => {
    expect(useTallyStore.getState().current?.clientId).toBe('visit-1');
    expect(useWearableTargetStore.getState().manualTarget?.pubKey).toBe('u2fkbn1x');
  });

  for (const key of PRIVATE_KEYS) {
    await AsyncStorage.setItem(key, JSON.stringify({ private: true }));
  }
  useSettingsStore.setState({
    homePoint: { lat: 50.08, lng: 14.42 },
    navigationProvider: 'mapy',
  });
  await AsyncStorage.setItem('na-pivo-settings', JSON.stringify({
    state: {
      homePoint: { lat: 50.08, lng: 14.42 },
      navigationProvider: 'mapy',
    },
    version: 1,
  }));

  const finishInFlightWearableCommand = beginMobileWearableSyncOperation();
  let clearSettled = false;
  const clearPromise = clearLocalPrivateAccountData().then(() => {
    clearSettled = true;
  });
  const wearableQueueKeys = [
    'na-pivo-drinks-queue',
    'na-pivo-delete-drinks-queue',
    'na-pivo-visits-queue',
  ];
  let firstClearValues: (string | null)[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    firstClearValues = await Promise.all(
      wearableQueueKeys.map((key) => AsyncStorage.getItem(key)),
    );
    if (firstClearValues.every((value) => value === null)) break;
    await Promise.resolve();
  }
  expect(firstClearValues).toEqual([null, null, null]);
  expect(clearSettled).toBe(false);

  // Model a pre-boundary command that acquired a queue lock before cleanup and
  // completed its durable write after the first clear.
  await Promise.all([
    AsyncStorage.setItem('na-pivo-drinks-queue', JSON.stringify([{ late: true }])),
    AsyncStorage.setItem(
      'na-pivo-delete-drinks-queue',
      JSON.stringify(['late-drink']),
    ),
    AsyncStorage.setItem('na-pivo-visits-queue', JSON.stringify([{ late: true }])),
  ]);
  finishInFlightWearableCommand();
  await clearPromise;

  expect(mockClearWearableSnapshot).toHaveBeenCalledTimes(2);
  expect(useTallyStore.getState().current).toBeNull();
  expect(useTallyStore.getState().history).toEqual([]);
  expect(useCommunityStore.getState().overrides).toEqual({});
  expect(usePubRatingsStore.getState().ratings).toEqual({});
  expect(usePubAmenitiesStore.getState().votes).toEqual({});
  expect(usePubStore.getState().revealedPub).toBeNull();
  expect(usePubStore.getState().reportedPubIds).toEqual([]);
  expect(usePubStore.getState().reportedCacheKeys).toEqual([]);
  expect(useWearableTargetStore.getState().manualTarget).toBeNull();
  expect(useFocusedPubStore.getState().pub).toBeNull();
  expect(useSettingsStore.getState().homePoint).toBeNull();
  expect(useSettingsStore.getState().navigationProvider).toBe('mapy');

  const settings = JSON.parse(
    await AsyncStorage.getItem('na-pivo-settings') as string,
  ) as { state: { homePoint: unknown; navigationProvider: string } };
  expect(settings.state.homePoint).toBeNull();
  expect(settings.state.navigationProvider).toBe('mapy');

  for (const key of PRIVATE_KEYS) {
    expect({ key, value: await AsyncStorage.getItem(key) }).toEqual({ key, value: null });
  }
});
