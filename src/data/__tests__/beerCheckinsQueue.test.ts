/**
 * Tests for the beer-checkins offline queue (src/data/beerCheckinsQueue.ts).
 *
 * The queue payload is the whole BeerCheckInInput object, so the "Pivo jako
 * identita" tags must ride along transparently: persisted to storage on enqueue
 * and handed back verbatim to submitBeerCheckIn on flush. AsyncStorage is the
 * jest mock; the network client is mocked so we can capture the delivered
 * payload without touching fetch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const submitBeerCheckIn: jest.Mock = jest.fn(async () => 'ok');
jest.mock('../beerCheckinsClient', () => ({
  submitBeerCheckIn: (...args: unknown[]) => submitBeerCheckIn(...(args as [])),
  reactToBeerCheckIn: jest.fn(async () => ({ ok: true })),
  clearBeerCheckInReaction: jest.fn(async () => ({ ok: true })),
}));

import {
  clearBeerCheckinsQueue,
  enqueueBeerCheckInOp,
  flushBeerCheckinsQueue,
} from '../beerCheckinsQueue';
import type { BeerCheckInInput } from '../beerCheckinsClient';

const STORAGE_KEY = 'na-pivo-beer-checkins-queue';

function checkin(over: Partial<BeerCheckInInput> = {}): BeerCheckInInput {
  return {
    clientId: 'c1',
    beerName: 'Radegast 12',
    breweryName: '',
    rating: 4,
    note: '',
    tags: ['crisp', 'one_more'],
    pubCacheKey: 'pk',
    pubName: 'Lokál Dlouhá',
    pubCity: 'Praha',
    visitClientId: null,
    visibility: 'friends',
    checkedInAt: '2026-07-01T19:40:00.000Z',
    ...over,
  };
}

async function readQueue(): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  submitBeerCheckIn.mockResolvedValue('ok');
  await AsyncStorage.clear();
  await clearBeerCheckinsQueue();
});

afterEach(async () => {
  await flushBeerCheckinsQueue();
});

describe('beer-checkins queue — tag round-trip', () => {
  it('persists the full input (tags included) to storage on enqueue', async () => {
    // Keep it in the queue: make delivery retry so it is not drained.
    submitBeerCheckIn.mockResolvedValue('retry');
    await enqueueBeerCheckInOp({ op: 'checkin', payload: checkin() });

    const queue = (await readQueue()) as { op: string; payload: BeerCheckInInput }[];
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.tags).toEqual(['crisp', 'one_more']);
  });

  it('delivers the tags verbatim to submitBeerCheckIn on flush', async () => {
    await enqueueBeerCheckInOp({ op: 'checkin', payload: checkin({ tags: ['smooth'] }) });

    expect(submitBeerCheckIn).toHaveBeenCalledTimes(1);
    const delivered = submitBeerCheckIn.mock.calls[0][0] as BeerCheckInInput;
    expect(delivered.tags).toEqual(['smooth']);
    // The whole input object round-trips, not just tags.
    expect(delivered.beerName).toBe('Radegast 12');
    expect(delivered.clientId).toBe('c1');
  });

  it('drains the queue once delivery succeeds', async () => {
    await enqueueBeerCheckInOp({ op: 'checkin', payload: checkin() });
    expect(await readQueue()).toHaveLength(0);
  });
});
