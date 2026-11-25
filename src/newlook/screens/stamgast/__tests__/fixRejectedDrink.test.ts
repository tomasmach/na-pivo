import AsyncStorage from '@react-native-async-storage/async-storage';

// The queue first: loading the client first would hand the queue the real submitDrink.
import { clearDrinksQueue, flushDrinksQueue } from '@/data/drinksQueue';
import { submitDrink, type DrinkEntry } from '@/data/drinksClient';
import { fixSessionDrink } from '@/myBeers/drinkEdits';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

import { canFixRejectedField, nightsOf, nightToFix } from '../eveningData';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@/data/drinksClient', () => ({
  ...jest.requireActual('@/data/drinksClient'),
  submitDrink: jest.fn(async () => 'retry'),
}));
jest.mock('@/data/drinksRateLimit', () => ({
  registerDrinkRetryFlush: jest.fn(),
  registerDrinkRateLimitAccountReader: jest.fn(),
  shouldPauseDrinkSync: jest.fn(() => false),
}));
jest.mock('@/data/visitsSync', () => ({ syncVisit: jest.fn(), deleteVisitByClientId: jest.fn() }));

const STARTED = new Date(2026, 9, 24, 19).toISOString();

function evening(): TallySession {
  return {
    clientId: 'evening-1',
    pubKey: 'ctx:private',
    pubName: 'Doma',
    placeContext: 'private',
    startedAt: STARTED,
    drinks: [
      { id: 'ok-1', at: STARTED, beerName: 'Plzeň', syncStatus: 'sent' },
      { id: 'bad-1', at: new Date(2026, 9, 24, 20).toISOString(), beerName: 'Plzeň', priceCzk: 4000, syncStatus: 'rejected', rejectedField: 'beer.price_czk' },
    ],
  };
}

async function queued(): Promise<DrinkEntry[]> {
  return JSON.parse((await AsyncStorage.getItem('na-pivo-drinks-queue')) ?? '[]');
}

/** The fix sends in the background; let the enqueue and its first flush finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function drink(id: string) {
  return useTallyStore.getState().history[0].drinks.find((d: { id: string }) => d.id === id);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await clearDrinksQueue();
  useTallyStore.setState({ current: null, history: [evening()] });
});

it('the diary points at the evening that holds refused drinks', () => {
  const toFix = nightToFix(nightsOf(useTallyStore.getState().history));
  expect(toFix?.night.day).toBe('2026-10-24');
  expect(toFix?.count).toBe(1);
  expect(canFixRejectedField('beer.price_czk')).toBe(true);
  expect(canFixRejectedField('drank_at')).toBe(false);
});

it('offline, a fixed drink waits in the queue under its own client_id', async () => {
  (submitDrink as jest.Mock).mockResolvedValue('retry');
  const rejected = drink('bad-1')!;

  expect(fixSessionDrink(STARTED, rejected, { beerName: 'Plzeň', drinkType: 'beer', priceCzk: 45 })).toBe(true);
  await settle();

  expect(drink('bad-1')).toMatchObject({ syncStatus: 'pending', priceCzk: 45 });
  expect(drink('bad-1')?.rejectedField).toBeUndefined();
  expect(await queued()).toEqual([expect.objectContaining({ client_id: 'bad-1', beer: expect.objectContaining({ price_czk: 45 }) })]);

  (submitDrink as jest.Mock).mockResolvedValue('ok');
  await flushDrinksQueue();
  expect(await queued()).toEqual([]);
});

it('a new refusal flags the drink again', async () => {
  (submitDrink as jest.Mock).mockImplementation(async (_entry: DrinkEntry, _signal?: AbortSignal, onRejected?: (field?: string) => void) => {
    onRejected?.('beer.name');
    return 'permanent-error';
  });

  fixSessionDrink(STARTED, drink('bad-1')!, { beerName: 'Plzeň', drinkType: 'beer', priceCzk: 45 });
  await settle();

  expect(drink('bad-1')).toMatchObject({ syncStatus: 'rejected', rejectedField: 'beer.name' });
});
