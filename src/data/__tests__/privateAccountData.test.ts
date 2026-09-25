import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLocalPrivateAccountData } from '../privateAccountData';
import { pulledRecently, trackForegroundPull } from '../foregroundPulls';
import { useCommunityStore } from '@/stores/communityStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import { useSettingsStore } from '@/stores/settingsStore';

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
  useSettingsStore.setState({ homePoint: null, navigationProvider: 'google' });
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

  await clearLocalPrivateAccountData();

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

  const settings = JSON.parse(
    await AsyncStorage.getItem('na-pivo-settings') as string,
  ) as { state: { homePoint: unknown; navigationProvider: string } };
  expect(settings.state.homePoint).toBeNull();
  expect(settings.state.navigationProvider).toBe('mapy');

  for (const key of PRIVATE_KEYS) {
    expect({ key, value: await AsyncStorage.getItem(key) }).toEqual({ key, value: null });
  }
});


it('removes retired 2.0 private data and settings while retaining public caches and device choices', async () => {
  const retiredKeys = [
    'na-pivo-account-preferences-queue', 'na-pivo-party-games-queue',
    'na-pivo-party-games-queue-quarantine-v1', 'na-pivo-party-game-starts-queue',
    'na-pivo-party-game-starts-queue-quarantine-v1', 'na-pivo-party-evening-actions-queue',
    'na-pivo-party-evening-identity-v1', 'na-pivo-party-games-account-merge',
    'na-pivo-private-account-merge-v0', 'na-pivo-live-party',
    'na-pivo-party-night-records-v1', 'na-pivo-contest-results',
    'na-pivo-search-recent-v1', 'na-pivo-pending-invite-code',
    'na-pivo-beer-checkin-action-tickets', 'na-pivo-beer-photo-deletion-tombstones',
    'na-pivo-counter-telemetry', 'na-pivo-account-deletion-intent-v2',
    'na-pivo-account-deletion-intent-quarantine-v1',
    'na-pivo-account-deletion-intent-quarantine-backup-v1',
    'na-pivo-account-deletion-intent-quarantine-recovered-v1',
    'na-pivo-beer-count-reminder-state', 'na-pivo-pub-reminder-state',
    'na-pivo-pub-reminder-geofences', 'na-pivo-handled-notification-responses-v1',
    'na-pivo-night-feed-v1:old-account:night-1',
    'na-pivo-night-feed-v1:old-account:night-2',
  ];
  // Cleanup must also remove malformed data; it cannot rely on the retired schema.
  for (const key of retiredKeys) await AsyncStorage.setItem(key, '{malformed private data');
  await AsyncStorage.setItem('na-pivo-pubs-snapshot', 'public-pubs');
  useSettingsStore.setState({
    marketingEmailsEnabled: true, lastSeenPartyStreak: 12, navigationProvider: 'mapy', hapticEnabled: false,
  });
  await AsyncStorage.setItem('na-pivo-settings', JSON.stringify({ version: 1, state: {
    navigationProvider: 'mapy', hapticEnabled: false,
    homePoint: { lat: 50, lng: 14 }, marketingEmailsEnabled: true, lastSeenPartyStreak: 12,
    pendingAccountPreferences: { home_point: { lat: 50, lng: 14 } },
    pendingAccountPreferencesOwnerId: 'old-account',
  } }));

  await clearLocalPrivateAccountData();

  for (const key of retiredKeys) expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(await AsyncStorage.getItem('na-pivo-pubs-snapshot')).toBe('public-pubs');
  expect(useSettingsStore.getState()).toMatchObject({
    homePoint: null, marketingEmailsEnabled: false, lastSeenPartyStreak: 0,
  });
  const settings = JSON.parse((await AsyncStorage.getItem('na-pivo-settings'))!);
  expect(settings.state).toMatchObject({
    homePoint: null, marketingEmailsEnabled: false, lastSeenPartyStreak: 0,
    pendingAccountPreferences: {}, pendingAccountPreferencesOwnerId: null,
    navigationProvider: 'mapy',
  });
});

it('forgets recent server pulls so a re-login restores the wiped data', async () => {
  await trackForegroundPull('ratings', async () => true, () => 'acc-1');
  expect(pulledRecently('ratings', 'acc-1')).toBe(true);

  await clearLocalPrivateAccountData();

  expect(pulledRecently('ratings', 'acc-1')).toBe(false);
});
