import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLocalPrivateAccountData } from '../privateAccountData';
import { useCommunityStore } from '@/stores/communityStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
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

const PRIVATE_KEYS = [
  'na-pivo-tally',
  'na-pivo-pub-ratings',
  'na-pivo-pub-amenities',
  'na-pivo-visits-seeded',
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

  for (const key of PRIVATE_KEYS) {
    await AsyncStorage.setItem(key, JSON.stringify({ private: true }));
  }

  await clearLocalPrivateAccountData();

  expect(useTallyStore.getState().current).toBeNull();
  expect(useTallyStore.getState().history).toEqual([]);
  expect(useCommunityStore.getState().overrides).toEqual({});
  expect(usePubRatingsStore.getState().ratings).toEqual({});
  expect(usePubAmenitiesStore.getState().votes).toEqual({});
  expect(usePubStore.getState().revealedPub).toBeNull();
  expect(usePubStore.getState().reportedPubIds).toEqual([]);
  expect(usePubStore.getState().reportedCacheKeys).toEqual([]);

  for (const key of PRIVATE_KEYS) {
    expect(await AsyncStorage.getItem(key)).toBeNull();
  }
});
