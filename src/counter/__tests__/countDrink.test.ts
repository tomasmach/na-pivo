jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const enqueueDrink = jest.fn((_entry: unknown, _options?: unknown) => Promise.resolve(true));
const flushDrinksQueue = jest.fn(() => Promise.resolve(undefined));
const removeQueuedDrink = jest.fn((_clientId: string) => Promise.resolve(true));
const isDrinkQueued = jest.fn((_clientId: string) => Promise.resolve(false));
jest.mock('@/data/drinksQueue', () => ({ enqueueDrink, flushDrinksQueue, isDrinkQueued, removeQueuedDrink }));

const enqueueDelete = jest.fn((_clientId: string, _options?: unknown) => Promise.resolve(undefined));
const flushDeleteDrinksQueue = jest.fn(() => Promise.resolve(undefined));
jest.mock('@/data/deleteDrinksQueue', () => ({ enqueueDelete, flushDeleteDrinksQueue }));

jest.mock('@/data/telemetryClient', () => ({ trackClientEvent: jest.fn(async () => undefined) }));
jest.mock('@/notifications/beerCountReminder', () => ({ refreshBeerCountReminderAfterBeer: jest.fn(async () => undefined) }));

let mockUuid = 0;
jest.mock('@/data/account', () => ({
  generateUuidV4: jest.fn(() => `uuid-${++mockUuid}`),
  setAnonymousSessionEvictionListener: jest.fn(),
}));

const syncVisit = jest.fn();
const deleteVisitByClientId = jest.fn();
jest.mock('@/data/visitsSync', () => ({ syncVisit, deleteVisitByClientId }));

const mockTours: { activeRun: unknown; markStop: jest.Mock } = { activeRun: null, markStop: jest.fn(async () => ({ ok: true })) };
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => mockTours } }));

import { countDrink, removeCountedDrink, UNDO_WINDOW_MS, type CountPlace } from '@/counter/countDrink';
import { geohash8 } from '@/data/geohash';
import { useCommunityStore } from '@/stores/communityStore';
import { useTallyStore } from '@/stores/tallyStore';

const PUB: CountPlace = { kind: 'pub', pub: { id: 'p1', name: 'U Tygra', lat: 50.0855, lng: 14.4195, city: 'Praha' } };
const HOME: CountPlace = { kind: 'outside', context: 'private' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockUuid = 0;
  useTallyStore.setState({ current: null, history: [] });
  useCommunityStore.setState({ overrides: {} });
});

afterEach(() => jest.useRealTimers());

it('counts a pub beer offline: tally, held POST, visit and the community price', () => {
  const result = countDrink(PUB, { name: 'Pilsner Urquell', priceCzk: 59, volumeMl: 500 });

  const current = useTallyStore.getState().current;
  expect(current?.pubKey).toBe(geohash8(50.0855, 14.4195));
  expect(current?.drinks.map((d) => [d.id, d.beerName, d.priceCzk])).toEqual([[result.id, 'Pilsner Urquell', 59]]);
  expect(enqueueDrink).toHaveBeenCalledWith(
    expect.objectContaining({ client_id: result.id, name: 'U Tygra', beer: { name: 'Pilsner Urquell', price_czk: 59, volume_ml: 500 } }),
    { deliver: false },
  );
  expect(flushDrinksQueue).not.toHaveBeenCalled();
  expect(syncVisit).toHaveBeenCalledWith(current);
  expect(useCommunityStore.getState().overrides[current!.pubKey]?.beers).toEqual([{ name: 'Pilsner Urquell', priceCzk: 59, volumeMl: 500 }]);

  jest.advanceTimersByTime(UNDO_WINDOW_MS);
  expect(flushDrinksQueue).toHaveBeenCalled();
});

it('keeps a home beer out of pub visits and community menus', () => {
  countDrink(HOME, { name: 'Bernard 11°', servingType: 'can', volumeMl: 500 });

  const current = useTallyStore.getState().current;
  expect(current?.placeContext).toBe('private');
  expect(enqueueDrink).toHaveBeenCalledWith(expect.objectContaining({ place_context: 'private', beer: { name: 'Bernard 11°', volume_ml: 500, serving_type: 'can' } }), { deliver: false });
  expect(syncVisit).not.toHaveBeenCalled();
  expect(useCommunityStore.getState().overrides).toEqual({});
});

it('files a backdated drink from an earlier day into history, never into the live evening', () => {
  countDrink(PUB, { name: 'Kozel 11°', priceCzk: 52 });
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600000).toISOString();

  countDrink(PUB, { name: 'Kozel 11°', priceCzk: 52 }, { at: twoDaysAgo });

  const state = useTallyStore.getState();
  expect(state.current?.drinks).toHaveLength(1);
  expect(state.history[0].drinks[0].at).toBe(twoDaysAgo);
});

it('undo pulls a still-queued drink and drops the visit of an emptied evening', async () => {
  const { id } = countDrink(PUB, { name: 'Pilsner Urquell', priceCzk: 59 });
  const clientId = useTallyStore.getState().current!.clientId;

  expect(removeCountedDrink(id)).toBe(true);
  await Promise.resolve();

  expect(useTallyStore.getState().current?.drinks).toEqual([]);
  expect(deleteVisitByClientId).toHaveBeenCalledWith(clientId);
  expect(removeQueuedDrink).toHaveBeenCalledWith(id);
  expect(enqueueDelete).not.toHaveBeenCalled();
  jest.advanceTimersByTime(UNDO_WINDOW_MS);
  expect(flushDrinksQueue).not.toHaveBeenCalled();
});

it('undo of an already delivered drink queues a durable DELETE', async () => {
  removeQueuedDrink.mockResolvedValueOnce(false);
  const { id } = countDrink(HOME, { name: 'Bernard 11°' });

  removeCountedDrink(id);
  await Promise.resolve();
  await Promise.resolve();

  expect(enqueueDelete).toHaveBeenCalledWith(id, { deliver: false });
});
