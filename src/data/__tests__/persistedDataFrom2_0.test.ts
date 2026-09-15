/**
 * 2.1.0 ships the 1.5.1 app on top of phones that ran 2.0.0. Whatever 2.0.0
 * left in AsyncStorage must load here without wiping the beer counter,
 * settings or the offline drink queue. The blobs below copy the 2.0.0 shapes:
 * tally v2 (`closedAt`, `removedDrinkIds`), settings v2 (pending account
 * preferences) and a queued drink carrying `party_code`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@/data/visitsSync', () => ({ deleteVisitByClientId: jest.fn(), syncVisit: jest.fn() }));
jest.mock('../drinksClient', () => ({
  ...jest.requireActual('../drinksClient'),
  submitDrink: jest.fn(async () => 'ok'),
}));

import { migrateTally, useTallyStore } from '@/stores/tallyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { flushDrinksQueue } from '../drinksQueue';
import { submitDrink } from '../drinksClient';

const tallyV2 = {
  current: {
    clientId: '3f1a2b3c-0000-4000-8000-000000000001',
    pubKey: 'u2fkbn3x',
    pubName: 'U Zlatého tygra',
    pubCity: 'Praha',
    startedAt: '2026-09-10T18:02:00+02:00',
    drinks: [
      { id: 'd1', beerName: 'Plzeň', at: '2026-09-10T18:02:00+02:00', priceCzk: 65, syncStatus: 'sent' },
      { id: 'd2', beerName: 'Plzeň', at: '2026-09-10T18:40:00+02:00', priceCzk: 65, syncStatus: 'pending' },
    ],
  },
  history: [
    {
      clientId: '3f1a2b3c-0000-4000-8000-000000000002',
      pubKey: 'u2fkbn3y',
      pubName: 'Lokál',
      startedAt: '2026-09-08T19:00:00+02:00',
      archivedReason: 'day-rollover',
      closedAt: '2026-09-08T23:10:00+02:00',
      drinks: [{ id: 'd0', beerName: 'Kozel', at: '2026-09-08T19:00:00+02:00', priceCzk: 55, syncStatus: 'sent' }],
    },
  ],
  removedDrinkIds: ['gone-1'],
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('data persisted by 2.0.0 survive the 2.1.0 (1.5.1 UI) app', () => {
  it('keeps the running evening and history from a tally v2 blob', async () => {
    const migrated = migrateTally(tallyV2, 2);
    expect(migrated.current?.drinks.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(migrated.history).toHaveLength(1);

    await AsyncStorage.setItem('na-pivo-tally', JSON.stringify({ state: tallyV2, version: 2 }));
    await useTallyStore.persist.rehydrate();
    expect(useTallyStore.getState().current?.pubName).toBe('U Zlatého tygra');
    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
    expect(useTallyStore.getState().history[0]?.pubName).toBe('Lokál');
  });

  it('keeps settings from a settings v2 blob', async () => {
    await AsyncStorage.setItem(
      'na-pivo-settings',
      JSON.stringify({
        state: {
          waterNudgeEnabled: true,
          priceCurrency: 'CZK',
          priceCurrencyRate: 1,
          pendingAccountPreferences: { share_spend_with_parta: true },
          pendingAccountPreferencesOwnerId: 'acc-1',
        },
        version: 2,
      }),
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().waterNudgeEnabled).toBe(true);
  });

  it('flushes a drink queued by 2.0.0 with its extra fields', async () => {
    await AsyncStorage.setItem(
      'na-pivo-drinks-queue',
      JSON.stringify([
        {
          client_id: '3f1a2b3c-0000-4000-8000-000000000009',
          name: 'U Zlatého tygra',
          city: 'Praha',
          lat: 50.0876,
          lng: 14.4213,
          external_id: 'mapy:123',
          beer: { name: 'Plzeň', price_czk: 65, volume_ml: 500 },
          drank_at: '2026-09-10T18:40:00+02:00',
          party_code: 'ABCD',
        },
      ]),
    );
    await flushDrinksQueue();
    expect(submitDrink).toHaveBeenCalledTimes(1);
    expect((submitDrink as jest.Mock).mock.calls[0][0]).toMatchObject({ party_code: 'ABCD' });
    expect(await AsyncStorage.getItem('na-pivo-drinks-queue')).toBe(null);
  });
});
