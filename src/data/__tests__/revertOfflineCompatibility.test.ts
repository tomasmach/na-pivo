import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushDrinksQueue } from '../drinksQueue';
import { enqueueDrinkUpdate, flushUpdateDrinksQueue } from '../updateDrinksQueue';
import { buildHistoricalDrinkEntry } from '../drinksHistorySync';
import { geohash8 } from '../geohash';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../account', () => ({
  ...jest.requireActual('../account'),
  ensureAccount: jest.fn(async () => ({ deviceId: 'test-device', accountId: 'test-account', token: 'test-token' })),
}));
jest.mock('../telemetryClient', () => ({
  trackApiFailure: jest.fn(),
  trackClientEvent: jest.fn(async () => undefined),
}));

const originalFetch = global.fetch;
const originalUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
const drinkKey = 'na-pivo-drinks-queue';
const updateKey = 'na-pivo-update-drinks-queue';
const clientId = '3f1a2b3c-0000-4000-8000-000000000009';
const restoredDrink = {
  client_id: clientId,
  name: 'Testovací hospoda',
  lat: 50.0876,
  lng: 14.4214,
  beer: { name: 'Plzeň', volume_ml: 500 },
  drank_at: '2026-09-10T18:40:00+02:00',
  party_code: 'ABCD',
};
const restoredUpdate = {
  client_id: clientId,
  beer_name: 'Kozel',
  drink_type: 'beer',
  price_czk: 60,
  volume_ml: 300,
  serving_type: 'draft',
};

function reply(status: number): Response {
  return { ok: status < 300, status, json: async () => ({}) } as Response;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  process.env.EXPO_PUBLIC_BACKEND_URL = 'http://127.0.0.1:8012';
  global.fetch = jest.fn(async () => reply(200));
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = originalUrl;
});

describe('offline data restored from 2.0', () => {
  it('retries a pub drink without a price and sends its original payload', async () => {
    await AsyncStorage.setItem(drinkKey, JSON.stringify([restoredDrink]));
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(503));
    await flushDrinksQueue();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem(drinkKey))!)).toEqual([restoredDrink]);

    await flushDrinksQueue();
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual(restoredDrink);
    expect(await AsyncStorage.getItem(drinkKey)).toBeNull();
  });

  it('can rebuild a price-less pub drink from local history', () => {
    const drink = { id: clientId, beerName: 'Plzeň', at: restoredDrink.drank_at, volumeMl: 500 };
    expect(buildHistoricalDrinkEntry({
      clientId: 'test-session', pubKey: geohash8(restoredDrink.lat, restoredDrink.lng),
      pubName: restoredDrink.name, startedAt: drink.at, drinks: [drink],
    }, drink)).toMatchObject({ client_id: clientId, beer: { name: 'Plzeň', volume_ml: 500 } });
  });

  it.each([
    restoredUpdate,
    { ...restoredUpdate, price_czk: null, volume_ml: null },
    { client_id: clientId, price_czk: null, volume_ml: null },
  ])(
    'retries every restored edit field, including explicit clears: %j', async (entry) => {
      await AsyncStorage.setItem(updateKey, JSON.stringify([entry]));
      (global.fetch as jest.Mock).mockResolvedValueOnce(reply(503));
      await flushUpdateDrinksQueue();
      expect(JSON.parse((await AsyncStorage.getItem(updateKey))!)).toEqual([entry]);
      await flushUpdateDrinksQueue();
      const { client_id: _, ...update } = entry;
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual(update);
      expect(await AsyncStorage.getItem(updateKey)).toBeNull();
    },
  );

  it('keeps restored edit fields when the old UI renames the same drink offline', async () => {
    await AsyncStorage.setItem(updateKey, JSON.stringify([restoredUpdate]));
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(503));
    await enqueueDrinkUpdate({ client_id: clientId, beer_name: 'Kozel 11' });
    expect(JSON.parse((await AsyncStorage.getItem(updateKey))!)).toEqual([
      { ...restoredUpdate, beer_name: 'Kozel 11' },
    ]);
    await flushUpdateDrinksQueue();
    const { client_id: _, ...update } = restoredUpdate;
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual({ ...update, beer_name: 'Kozel 11' });
  });
});
