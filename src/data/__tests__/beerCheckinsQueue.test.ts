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

import {
  clearBeerCheckinsQueue,
  enqueueBeerCheckInOp,
  flushBeerCheckinsQueue,
  getPendingBeerCheckIns,
} from '../beerCheckinsQueue';
import type { BeerCheckInInput } from '../beerCheckinsClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** Real client, used verbatim by the UGC-consent regression tests below. */
const actualSubmitBeerCheckIn =
  jest.requireActual<typeof import('../beerCheckinsClient')>('../beerCheckinsClient')
    .submitBeerCheckIn;

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 't',
    authenticated: false,
  })),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const submitBeerCheckIn: jest.Mock = jest.fn(async () => 'ok');
jest.mock('../beerCheckinsClient', () => {
  const actual = jest.requireActual('../beerCheckinsClient');
  return {
    ...actual,
    submitBeerCheckIn: (...args: unknown[]) => submitBeerCheckIn(...(args as [])),
    reactToBeerCheckIn: jest.fn(async () => ({ ok: true })),
    clearBeerCheckInReaction: jest.fn(async () => ({ ok: true })),
  };
});

const STORAGE_KEY = 'na-pivo-beer-checkins-queue';
const ORIGINAL_FETCH = global.fetch;

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

  it('preserves historical start and end times while pending', async () => {
    submitBeerCheckIn.mockResolvedValue('retry');
    await enqueueBeerCheckInOp({
      op: 'checkin',
      payload: checkin({
        checkedInAt: '2026-07-01T18:00:00.000Z',
        endedAt: '2026-07-01T21:30:00.000Z',
        quantity: 3,
        priceCzk: 62,
      }),
    });

    const pending = await getPendingBeerCheckIns();
    expect(pending).toHaveLength(1);
    expect(pending[0].checkedInAt).toBe('2026-07-01T18:00:00.000Z');
    expect(pending[0].endedAt).toBe('2026-07-01T21:30:00.000Z');
    expect(pending[0].quantity).toBe(3);
    expect(pending[0].priceCzk).toBe(62);
  });

  it('keeps multiple beer kinds from one historical evening pending', async () => {
    submitBeerCheckIn.mockResolvedValue('retry');
    const visitClientId = '4f05b1bf-0933-4f97-a7ce-37fc168ecae2';

    await enqueueBeerCheckInOp({
      op: 'checkin',
      payload: checkin({ clientId: 'c1', beerName: 'Pilsner Urquell', visitClientId }),
    });
    await enqueueBeerCheckInOp({
      op: 'checkin',
      payload: checkin({ clientId: 'c2', beerName: 'Kozel 11', visitClientId }),
    });

    const pending = await getPendingBeerCheckIns();
    expect(pending).toHaveLength(2);
    expect(pending.map((item) => item.beerName)).toEqual(['Pilsner Urquell', 'Kozel 11']);
    expect(pending.every((item) => item.visitClientId === visitClientId)).toBe(true);
  });

  it('still replaces a retried pending check-in with the same client id', async () => {
    submitBeerCheckIn.mockResolvedValue('retry');
    const visitClientId = '4f05b1bf-0933-4f97-a7ce-37fc168ecae2';

    await enqueueBeerCheckInOp({
      op: 'checkin',
      payload: checkin({ clientId: 'c1', beerName: 'Pilsner Urquell', visitClientId, quantity: 1 }),
    });
    await enqueueBeerCheckInOp({
      op: 'checkin',
      payload: checkin({ clientId: 'c1', beerName: 'Pilsner Urquell', visitClientId, quantity: 2 }),
    });

    const pending = await getPendingBeerCheckIns();
    expect(pending).toHaveLength(1);
    expect(pending[0].quantity).toBe(2);
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

describe('UGC consent retry contract — HTTP 428 keeps the queued check-in', () => {
  const ugc428Responses = [
    { name: 'bare 428 without a semantic body code', body: {} as Record<string, unknown> },
    {
      name: '428 with ugc_consent_required',
      body: { code: 'ugc_consent_required', detail: 'Potřebujeme souhlas.' },
    },
    {
      name: '428 with ugc_policy_update_required',
      body: { code: 'ugc_policy_update_required', detail: 'Pravidla se změnila.' },
    },
  ];

  function fetchResponding(status: number, body: unknown): void {
    global.fetch = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
  }

  beforeEach(() => {
    // Run the REAL client classification against a mocked fetch, so the test
    // covers exactly what a released app does with a 428 response.
    submitBeerCheckIn.mockImplementation(
      (input: BeerCheckInInput) => actualSubmitBeerCheckIn(input),
    );
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it.each(ugc428Responses)('retains the op on $name until delivery succeeds', async ({ body }) => {
    fetchResponding(428, body);
    await enqueueBeerCheckInOp({ op: 'checkin', payload: checkin() });

    // REGRESSION: a 428 (consent/policy gate) is transient — the check-in must
    // stay durable, never be dropped like a validation error.
    expect(await readQueue()).toHaveLength(1);
    expect(await getPendingBeerCheckIns()).toHaveLength(1);

    // Once the server accepts, the retained op drains on the next flush.
    fetchResponding(200, { ok: true });
    await flushBeerCheckinsQueue();
    expect(await readQueue()).toHaveLength(0);
  });
});
