/**
 * Counting a beer from the hub (src/party/logBeer.ts).
 *
 * The point of this module is that it is NOT a second counter: it writes to the
 * same session store and the same offline queue the counter uses, and only adds
 * the evening's code. So what is tested is that the beer lands in both places
 * exactly once, carries the code, and can be taken back without racing its own
 * delivery.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const enqueueDrink: jest.Mock = jest.fn(async () => true);
const removeQueuedDrink: jest.Mock = jest.fn(async () => true);
const flushDrinksQueue: jest.Mock = jest.fn(async () => undefined);
const updateQueuedDrinkBeerName: jest.Mock = jest.fn(async () => 'queued');
jest.mock('@/data/drinksQueue', () => ({
  enqueueDrink: (...args: unknown[]) => enqueueDrink(...(args as [])),
  removeQueuedDrink: (...args: unknown[]) => removeQueuedDrink(...(args as [])),
  flushDrinksQueue: (...args: unknown[]) => flushDrinksQueue(...(args as [])),
  updateQueuedDrinkBeerName: (...args: unknown[]) => updateQueuedDrinkBeerName(...(args as [])),
}));

const enqueueDelete: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/data/deleteDrinksQueue', () => ({
  enqueueDelete: (...args: unknown[]) => enqueueDelete(...(args as [])),
}));

const enqueueDrinkUpdate: jest.Mock = jest.fn(async () => undefined);
const removeQueuedDrinkUpdate: jest.Mock = jest.fn(async () => true);
jest.mock('@/data/updateDrinksQueue', () => ({
  enqueueDrinkUpdate: (...args: unknown[]) => enqueueDrinkUpdate(...(args as [])),
  removeQueuedDrinkUpdate: (...args: unknown[]) => removeQueuedDrinkUpdate(...(args as [])),
}));

import { logPartyBeer, renamePartyBeer, unlogPartyBeer } from '@/party/logBeer';
import { useTallyStore } from '@/stores/tallyStore';

/** Praha, roughly — a real geohash-8, because the client decodes it. */
const PLACE = { pubKey: 'u2fkbjgx', pubName: 'U Fleků', pubCity: 'Praha' };

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  enqueueDrink.mockResolvedValue(true);
  removeQueuedDrink.mockResolvedValue(true);
  updateQueuedDrinkBeerName.mockResolvedValue('queued');
  useTallyStore.setState({ current: null, history: [] });
});

describe('logPartyBeer', () => {
  it('writes the beer into the counter, not into a list of its own', () => {
    const id = logPartyBeer({ place: PLACE, beerName: 'Plzeň', partyCode: 'STUL24' });
    const session = useTallyStore.getState().current;

    expect(session?.pubName).toBe('U Fleků');
    expect(session?.drinks.map((drink) => [drink.id, drink.beerName])).toEqual([[id, 'Plzeň']]);
  });

  it('sends it once, with the evening on it', async () => {
    logPartyBeer({ place: PLACE, beerName: 'Plzeň', partyCode: 'STUL24' });
    await flush();

    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(enqueueDrink.mock.calls[0][0]).toMatchObject({
      name: 'U Fleků',
      party_code: 'STUL24',
      beer: { name: 'Plzeň' },
    });
  });

  it('leaves the code off a night nobody is sharing', async () => {
    logPartyBeer({ place: PLACE, beerName: 'Plzeň' });
    await flush();

    expect(enqueueDrink.mock.calls[0][0].party_code).toBeUndefined();
  });

  it('marks a delivered drink so the UI stops offering a local-only undo', async () => {
    const id = logPartyBeer({ place: PLACE, beerName: 'Plzeň' });
    await flush();

    expect(useTallyStore.getState().current?.drinks.find((d) => d.id === id)?.syncStatus).toBe(
      'sent',
    );
  });
});

describe('unlogPartyBeer', () => {
  it('drops a drink that never left the phone without telling the server', async () => {
    const id = logPartyBeer({ place: PLACE, beerName: 'Plzeň' });
    enqueueDrink.mockClear();
    unlogPartyBeer(id);
    await flush();

    expect(useTallyStore.getState().current?.drinks).toEqual([]);
    expect(enqueueDelete).not.toHaveBeenCalled();
  });

  it('waits for the flush before deleting one that is already out there', async () => {
    // Otherwise the DELETE can overtake an in-flight POST and delete a row the
    // server has not created yet.
    removeQueuedDrink.mockResolvedValue(false);
    const id = logPartyBeer({ place: PLACE, beerName: 'Plzeň' });
    unlogPartyBeer(id);
    await flush();
    await flush();

    expect(flushDrinksQueue).toHaveBeenCalled();
    expect(enqueueDelete).toHaveBeenCalledWith(id);
  });

  it('does nothing for a drink that is not there', () => {
    unlogPartyBeer('nope');

    expect(removeQueuedDrink).not.toHaveBeenCalled();
  });
});

describe('renamePartyBeer', () => {
  it('fixes the name in the session and in the queued payload', async () => {
    const id = logPartyBeer({ place: PLACE, beerName: 'Plze' });
    const session = useTallyStore.getState().current!;
    renamePartyBeer(session, id, '  Plzeň  ');
    await flush();

    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Plzeň');
    expect(updateQueuedDrinkBeerName).toHaveBeenCalledWith(id, 'Plzeň');
    expect(enqueueDrinkUpdate).not.toHaveBeenCalled();
  });

  it('sends an update when the drink is already on the server', async () => {
    updateQueuedDrinkBeerName.mockResolvedValue('missing');
    const id = logPartyBeer({ place: PLACE, beerName: 'Plze' });
    renamePartyBeer(useTallyStore.getState().current!, id, 'Plzeň');
    await flush();

    expect(enqueueDrinkUpdate).toHaveBeenCalledWith({ client_id: id, beer_name: 'Plzeň' });
  });

  it('refuses to rename a beer to nothing', () => {
    const id = logPartyBeer({ place: PLACE, beerName: 'Plzeň' });
    renamePartyBeer(useTallyStore.getState().current!, id, '   ');

    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Plzeň');
  });
});
