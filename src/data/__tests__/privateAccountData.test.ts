import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLocalPrivateAccountData } from '../privateAccountData';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
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
  'na-pivo-visits-seeded',
  'na-pivo-drinks-queue',
  'na-pivo-delete-drinks-queue',
  'na-pivo-update-drinks-queue',
  'na-pivo-visits-queue',
  'na-pivo-pub-ratings-queue',
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
  usePubRatingsStore.setState({ ratings: {} });
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

  for (const key of PRIVATE_KEYS) {
    await AsyncStorage.setItem(key, JSON.stringify({ private: true }));
  }

  await clearLocalPrivateAccountData();

  expect(useTallyStore.getState().current).toBeNull();
  expect(useTallyStore.getState().history).toEqual([]);
  expect(usePubRatingsStore.getState().ratings).toEqual({});

  for (const key of PRIVATE_KEYS) {
    expect(await AsyncStorage.getItem(key)).toBeNull();
  }
});
