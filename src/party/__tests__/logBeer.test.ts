/**
 * Counting a beer from the hub (src/party/logBeer.ts).
 *
 * The point of this module is that it is NOT a second counter: it writes to the
 * same session store and the same offline queue the counter uses, and only adds
 * the evening's code. So what is tested is that the beer lands in both places
 * exactly once, carries the code, and can be taken back without racing its own
 * delivery.
 */

import { beginPrivateAccountTransition } from '@/data/privateAccountBoundary';
import { logPartyBeer, renamePartyBeer, unlogPartyBeer, updatePartyDrink } from '@/party/logBeer';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const enqueueDrink: jest.Mock = jest.fn(async () => 'delivered');
const removeQueuedDrink: jest.Mock = jest.fn(async () => true);
const isDrinkQueued: jest.Mock = jest.fn(async () => false);
const flushDrinksQueue: jest.Mock = jest.fn(async () => undefined);
const updateQueuedDrinkBeerName: jest.Mock = jest.fn(async () => 'queued');
const updateQueuedDrink: jest.Mock = jest.fn(async () => 'queued');
jest.mock('@/data/drinksQueue', () => ({
  enqueueDrink: (...args: unknown[]) => enqueueDrink(...(args as [])),
  isDrinkQueued: (...args: unknown[]) => isDrinkQueued(...(args as [])),
  removeQueuedDrink: (...args: unknown[]) => removeQueuedDrink(...(args as [])),
  flushDrinksQueue: (...args: unknown[]) => flushDrinksQueue(...(args as [])),
  updateQueuedDrinkBeerName: (...args: unknown[]) => updateQueuedDrinkBeerName(...(args as [])),
  updateQueuedDrink: (...args: unknown[]) => updateQueuedDrink(...(args as [])),
}));

const enqueueDelete: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/data/deleteDrinksQueue', () => ({
  enqueueDelete: (...args: unknown[]) => enqueueDelete(...(args as [])),
}));

const enqueueDrinkUpdate: jest.Mock = jest.fn(async () => undefined);
const removeQueuedDrinkUpdate: jest.Mock = jest.fn(async () => true);
const flushUpdateDrinksQueue: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/data/updateDrinksQueue', () => ({
  enqueueDrinkUpdate: (...args: unknown[]) => enqueueDrinkUpdate(...(args as [])),
  removeQueuedDrinkUpdate: (...args: unknown[]) => removeQueuedDrinkUpdate(...(args as [])),
  flushUpdateDrinksQueue: (...args: unknown[]) => flushUpdateDrinksQueue(...(args as [])),
}));

const syncVisit: jest.Mock = jest.fn();
const deleteVisitByClientId: jest.Mock = jest.fn();
jest.mock('@/data/visitsSync', () => ({
  syncVisit: (...args: unknown[]) => syncVisit(...(args as [])),
  deleteVisitByClientId: (...args: unknown[]) => deleteVisitByClientId(...(args as [])),
}));

const flushVisitsQueue: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/data/visitsQueue', () => ({
  flushVisitsQueue: (...args: unknown[]) => flushVisitsQueue(...(args as [])),
}));

/** Praha, roughly — a real geohash-8, because the client decodes it. */
const PLACE = { pubKey: 'u2fkbjgx', pubName: 'U Fleků', pubCity: 'Praha' };

const flush = () => new Promise((resolve) => setImmediate(resolve));

function sameDrinkingDayBackdate(): string {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(4, 0, 0, 0);
  if (now < dayStart) dayStart.setDate(dayStart.getDate() - 1);
  return new Date(dayStart.getTime() + (now.getTime() - dayStart.getTime()) / 2).toISOString();
}

function storedSession(clientId: string, startedAt: string, drinkIds: string[]): TallySession {
  return {
    clientId,
    pubKey: clientId,
    pubName: clientId,
    startedAt,
    drinks: drinkIds.map((id, index) => ({
      id,
      beerName: `Pivo ${index + 1}`,
      at: new Date(Date.parse(startedAt) + index * 60_000).toISOString(),
      syncStatus: 'sent',
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  enqueueDrink.mockResolvedValue('delivered');
  removeQueuedDrink.mockResolvedValue(true);
  updateQueuedDrinkBeerName.mockResolvedValue('queued');
  updateQueuedDrink.mockResolvedValue('queued');
  flushDrinksQueue.mockResolvedValue(undefined);
  flushUpdateDrinksQueue.mockResolvedValue(undefined);
  enqueueDelete.mockResolvedValue('queued');
  enqueueDrinkUpdate.mockResolvedValue('queued');
  useTallyStore.setState({ current: null, history: [] });
});

describe('updatePartyDrink', () => {
  it('waits for an in-flight create before sending the edit', async () => {
    let finishCreate: (() => void) | undefined;
    flushDrinksQueue.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishCreate = resolve;
    }));
    updateQueuedDrink.mockResolvedValue('in-flight');
    const id = await loggedBeer({ place: PLACE, beerName: 'Ryzlink', deferDelivery: true });

    updatePartyDrink(id, {
      beerName: 'Ryzlink vlašský',
      drinkType: 'wine',
      priceCzk: 85,
      volumeMl: 200,
    });
    await flush();

    expect(enqueueDrinkUpdate).not.toHaveBeenCalled();
    finishCreate?.();
    await flush();

    expect(enqueueDrinkUpdate).toHaveBeenCalledWith(expect.objectContaining({
      client_id: id,
      beer_name: 'Ryzlink vlašský',
      drink_type: 'wine',
    }));
  });
});

describe('logPartyBeer', () => {
  it('does not run an addition queued before an account transition', async () => {
    let save!: (result: string) => void;
    enqueueDrink.mockImplementationOnce(() => new Promise<string>((resolve) => { save = resolve; }));
    const first = logPartyBeer({ place: PLACE, beerName: 'First', deferDelivery: true });
    await flush();
    const second = logPartyBeer({ place: PLACE, beerName: 'Second', deferDelivery: true });
    const transition = beginPrivateAccountTransition('test-party-addition');
    try {
      save('queued');
      expect(await Promise.all([first, second])).toEqual([null, null]);
      await transition?.drain();
      expect(enqueueDrink).toHaveBeenCalledTimes(1);
      expect(useTallyStore.getState().current).toBeNull();
    } finally {
      transition?.release();
    }
  });

  it('waits for durable storage before changing the tally', async () => {
    let save!: (result: string) => void;
    enqueueDrink.mockImplementationOnce(() => new Promise<string>((resolve) => { save = resolve; }));
    const pending = logPartyBeer({ place: PLACE, beerName: 'Plzeň', deferDelivery: true });
    await flush();
    expect(useTallyStore.getState().current).toBeNull();
    save('queued');
    expect(await pending).not.toBeNull();
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
  });

  it('does not confirm a drink when its durable queue cannot be saved', async () => {
    enqueueDrink.mockResolvedValueOnce('storage-error');
    const id = await logPartyBeer({ place: PLACE, beerName: 'Plzeň' });
    expect(id).toBeNull();
    expect(useTallyStore.getState().current).toBeNull();
    expect(syncVisit).not.toHaveBeenCalled();
  });

  it('writes the beer into the counter, not into a list of its own', async () => {
    const id = await loggedBeer({ place: PLACE, beerName: 'Plzeň', partyCode: 'STUL24' });
    const session = useTallyStore.getState().current;

    expect(session?.pubName).toBe('U Fleků');
    expect(session?.drinks.map((drink) => [drink.id, drink.beerName])).toEqual([[id, 'Plzeň']]);
  });

  it('sends it once, with the evening on it', async () => {
    await loggedBeer({ place: PLACE, beerName: 'Plzeň', partyCode: 'STUL24' });
    await flush();

    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(enqueueDrink.mock.calls[0][0]).toMatchObject({
      name: 'U Fleků',
      party_code: 'STUL24',
      beer: { name: 'Plzeň' },
    });
    expect(syncVisit).toHaveBeenCalledWith(
      expect.objectContaining({ pubName: 'U Fleků' }),
      expect.any(String),
      'STUL24',
      { deliver: false },
    );
  });

  it('keeps the evening association when the live hub supplies its current timestamp', async () => {
    const at = new Date().toISOString();

    await loggedBeer({ place: PLACE, beerName: 'Plzeň', partyCode: 'STUL24', at });
    await flush();

    expect(enqueueDrink).toHaveBeenCalledWith(
      expect.objectContaining({ drank_at: at, party_code: 'STUL24' }),
      { deliver: false },
    );
    expect(syncVisit).toHaveBeenCalledWith(
      expect.any(Object),
      at,
      'STUL24',
      { deliver: false },
    );
  });

  it('keeps a selected time in the local diary and queued drank_at', async () => {
    const at = sameDrinkingDayBackdate();
    const id = await loggedBeer({
      place: PLACE,
      beerName: 'Plzeň',
      partyCode: 'STUL24',
      deferDelivery: true,
      at,
      backdated: true,
    });
    await flush();

    expect(useTallyStore.getState().current?.drinks.find((drink) => drink.id === id)?.at).toBe(at);
    expect(enqueueDrink).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: id,
        drank_at: at,
      }),
      { deliver: false },
    );
    expect(enqueueDrink.mock.calls[0][0]).not.toHaveProperty('party_code');
  });

  it('keeps a past-day backdate out of the live tally while preserving its queue entry', async () => {
    const nowId = await loggedBeer({ place: PLACE, beerName: 'Plzeň', partyCode: 'STUL24' });
    const at = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const oldId = await loggedBeer({
      place: PLACE,
      beerName: 'Kozel',
      partyCode: 'STUL24',
      deferDelivery: true,
      at,
      backdated: true,
    });
    await flush();

    expect(useTallyStore.getState().current?.drinks.map((drink) => drink.id)).toEqual([nowId]);
    expect(useTallyStore.getState().history.some((session) =>
      session.drinks.some((drink) => drink.id === oldId && drink.at === at),
    )).toBe(true);
    expect(enqueueDrink).toHaveBeenLastCalledWith(
      expect.objectContaining({ client_id: oldId, drank_at: at }),
      { deliver: false },
    );
  });

  it('keeps edit and undo working for a queued backdated drink', async () => {
    const at = sameDrinkingDayBackdate();
    const id = await loggedBeer({
      place: PLACE,
      beerName: 'Plzeň',
      partyCode: 'STUL24',
      deferDelivery: true,
      at,
      backdated: true,
    });

    updatePartyDrink(id, {
      beerName: 'Plzeň 12',
      drinkType: 'beer',
      priceCzk: 65,
      volumeMl: 500,
      servingType: 'draft',
    });
    unlogPartyBeer(id);
    await flush();

    expect(updateQueuedDrink).toHaveBeenCalledWith(id, expect.objectContaining({
      beer_name: 'Plzeň 12',
      price_czk: 65,
    }));
    expect(removeQueuedDrink).toHaveBeenCalledWith(id);
    expect(useTallyStore.getState().current?.drinks).toEqual([]);
    expect(enqueueDelete).not.toHaveBeenCalled();
  });

  it('undoes the visit created for a one-drink past evening', async () => {
    const at = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const id = await loggedBeer({
      place: PLACE,
      beerName: 'Kozel',
      deferDelivery: true,
      at,
      backdated: true,
    });
    const pastSession = useTallyStore.getState().history.find((session) =>
      session.drinks.some((drink) => drink.id === id),
    );

    unlogPartyBeer(id);
    await flush();

    expect(deleteVisitByClientId).toHaveBeenCalledWith(pastSession?.clientId);
    expect(useTallyStore.getState().history).toEqual([]);
  });

  it('durably queues the first table beer without delivering before table creation', async () => {
    await loggedBeer({
      place: PLACE,
      beerName: 'Plzeň',
      partyCode: 'STUL24',
      deferDelivery: true,
    });
    await flush();

    expect(enqueueDrink).toHaveBeenCalledWith(
      expect.objectContaining({ party_code: 'STUL24' }),
      { deliver: false },
    );
    expect(syncVisit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      'STUL24',
      { deliver: false },
    );
  });

  it('leaves the code off a night nobody is sharing', async () => {
    await loggedBeer({ place: PLACE, beerName: 'Plzeň' });
    await flush();

    expect(enqueueDrink.mock.calls[0][0].party_code).toBeUndefined();
  });

  it('marks a delivered drink so the UI stops offering a local-only undo', async () => {
    const id = await loggedBeer({ place: PLACE, beerName: 'Plzeň' });
    await flush();

    expect(useTallyStore.getState().current?.drinks.find((d) => d.id === id)?.syncStatus).toBe(
      'sent',
    );
  });

  it('does not change the tally when enqueue rejects', async () => {
    enqueueDrink.mockRejectedValueOnce(new Error('account transition'));
    expect(await logPartyBeer({ place: PLACE, beerName: 'Plzeň' })).toBeNull();
    expect(useTallyStore.getState().current).toBeNull();
  });

  it('keeps the durable drink and concurrent edits when its visit cannot be saved', async () => {
    const earlierId = await loggedBeer({ place: PLACE, beerName: 'Earlier', deferDelivery: true });
    let finishVisit!: (result: string) => void;
    syncVisit.mockImplementationOnce(() => new Promise<string>((resolve) => { finishVisit = resolve; }));
    const pending = logPartyBeer({ place: PLACE, beerName: 'New', deferDelivery: true });
    await flush();
    const current = useTallyStore.getState().current!;
    useTallyStore.getState().updateDrinkNameInSession(current.startedAt, earlierId, 'Edited');
    finishVisit('storage-error');
    const id = await pending;
    expect(id).not.toBeNull();
    expect(useTallyStore.getState().current?.drinks.map((drink) => drink.beerName))
      .toEqual(['Edited', 'New']);
    expect(useTallyStore.getState().current?.drinks.find((drink) => drink.id === id)?.syncStatus)
      .toBe('pending');
    expect(removeQueuedDrink).not.toHaveBeenCalled();
  });

});

describe('unlogPartyBeer', () => {
  it('keeps the local drink when a delivered delete cannot reach storage', async () => {
    removeQueuedDrink.mockResolvedValue(false);
    enqueueDelete.mockResolvedValueOnce('storage-error');
    const id = await loggedBeer({ place: PLACE, beerName: 'Plzeň' });

    await expect(unlogPartyBeer(id)).resolves.toBe('storage-error');

    expect(useTallyStore.getState().current?.drinks.map((drink) => drink.id)).toContain(id);
    expect(removeQueuedDrinkUpdate).not.toHaveBeenCalled();
  });

  it('drops a pending edit only after the server delete is durable', async () => {
    removeQueuedDrink.mockResolvedValue(false);
    const id = await loggedBeer({ place: PLACE, beerName: 'Plzeň' });

    await expect(unlogPartyBeer(id)).resolves.toBe('removed');

    expect(enqueueDelete.mock.invocationCallOrder[0]).toBeLessThan(
      removeQueuedDrinkUpdate.mock.invocationCallOrder[0],
    );
  });

  it('drops a drink that never left the phone without telling the server', async () => {
    const id = await loggedBeer({ place: PLACE, beerName: 'Plzeň' });
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
    const id = await loggedBeer({ place: PLACE, beerName: 'Plzeň' });
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

  it('deletes an older crawl beer from history and queues its server tombstone', async () => {
    removeQueuedDrink.mockResolvedValue(false);
    const older = storedSession('old-stop', '2026-08-05T18:00:00Z', ['old-beer', 'keep']);
    const current = storedSession('new-stop', '2026-08-05T20:00:00Z', ['current-beer']);
    useTallyStore.setState({ current, history: [older] });

    unlogPartyBeer('old-beer');
    await flush();
    await flush();

    expect(useTallyStore.getState().history[0].drinks.map((drink) => drink.id)).toEqual(['keep']);
    expect(useTallyStore.getState().current?.drinks.map((drink) => drink.id)).toEqual([
      'current-beer',
    ]);
    expect(flushDrinksQueue).toHaveBeenCalled();
    expect(enqueueDelete).toHaveBeenCalledWith('old-beer');
  });
});

describe('renamePartyBeer', () => {
  it('keeps the old local name when the update cannot reach storage', async () => {
    updateQueuedDrinkBeerName.mockResolvedValue('storage-error');
    enqueueDrinkUpdate.mockResolvedValueOnce('storage-error');
    const id = await loggedBeer({ place: PLACE, beerName: 'Plze' });

    await expect(renamePartyBeer(id, 'Plzeň')).resolves.toBe('storage-error');

    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Plze');
  });

  it('fixes the name in the session and in the queued payload', async () => {
    const id = await loggedBeer({ place: PLACE, beerName: 'Plze' });
    renamePartyBeer(id, '  Plzeň  ');
    await flush();

    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Plzeň');
    expect(updateQueuedDrinkBeerName).toHaveBeenCalledWith(id, 'Plzeň');
    expect(enqueueDrinkUpdate).not.toHaveBeenCalled();
  });

  it('sends an update when the drink is already on the server', async () => {
    updateQueuedDrinkBeerName.mockResolvedValue('missing');
    const id = await loggedBeer({ place: PLACE, beerName: 'Plze' });
    renamePartyBeer(id, 'Plzeň');
    await flush();

    expect(enqueueDrinkUpdate).toHaveBeenCalledWith({ client_id: id, beer_name: 'Plzeň' });
  });

  it('refuses to rename a beer to nothing', async () => {
    const id = await loggedBeer({ place: PLACE, beerName: 'Plzeň' });
    renamePartyBeer(id, '   ');

    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Plzeň');
  });

  it('renames an older crawl beer in history and queues a server update', async () => {
    updateQueuedDrinkBeerName.mockResolvedValue('missing');
    const older = storedSession('old-stop', '2026-08-05T18:00:00Z', ['old-beer']);
    const current = storedSession('new-stop', '2026-08-05T20:00:00Z', ['current-beer']);
    useTallyStore.setState({ current, history: [older] });

    renamePartyBeer('old-beer', '  Opravený ležák  ');
    await flush();

    expect(useTallyStore.getState().history[0].drinks[0].beerName).toBe('Opravený ležák');
    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Pivo 1');
    expect(updateQueuedDrinkBeerName).toHaveBeenCalledWith('old-beer', 'Opravený ležák');
    expect(enqueueDrinkUpdate).toHaveBeenCalledWith({
      client_id: 'old-beer',
      beer_name: 'Opravený ležák',
    });
  });
});

async function loggedBeer(options: Parameters<typeof logPartyBeer>[0]): Promise<string> {
  const id = await logPartyBeer(options);
  expect(id).not.toBeNull();
  return id!;
}
