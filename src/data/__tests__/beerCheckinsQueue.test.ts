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
  enqueueBeerCheckInBatch,
  enqueueBeerCheckInOp,
  flushBeerCheckinsQueue,
  getPendingBeerCheckIns,
  getOrCreateBeerCheckInActionTicket,
  loadBeerCheckInActionTicket,
  removeBeerCheckInActionTicket,
  saveBeerCheckInActionTicket,
} from '../beerCheckinsQueue';
import type { BeerCheckInInput } from '../beerCheckinsClient';
import {
  PrivateAccountMutationFrozenError,
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';

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
const reactToBeerCheckIn: jest.Mock = jest.fn(async () => ({ ok: true }));
jest.mock('../beerCheckinsClient', () => {
  const actual = jest.requireActual('../beerCheckinsClient');
  return {
    ...actual,
    submitBeerCheckIn: (...args: unknown[]) => submitBeerCheckIn(...(args as [])),
    reactToBeerCheckIn: (...args: unknown[]) => reactToBeerCheckIn(...(args as [])),
    clearBeerCheckInReaction: jest.fn(async () => ({ ok: true })),
  };
});

const STORAGE_KEY = 'na-pivo-beer-checkins-queue';
const ACTION_TICKETS_STORAGE_KEY = 'na-pivo-beer-checkin-action-tickets';
const ORIGINAL_FETCH = global.fetch;
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function checkin(over: Partial<BeerCheckInInput> = {}): BeerCheckInInput {
  return {
    clientId: UUID_A,
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
  resetPrivateAccountBoundaryForTests();
  submitBeerCheckIn.mockResolvedValue('ok');
  reactToBeerCheckIn.mockResolvedValue({ ok: true });
  await AsyncStorage.clear();
  await clearBeerCheckinsQueue();
});

it.each(['http_408', 'http_409', 'http_425'])('keeps a cheer queued after transient %s', async (code) => {
  reactToBeerCheckIn.mockResolvedValue({ ok: false, code, detail: 'zkus znovu' });

  await enqueueBeerCheckInOp({ op: 'cheer', checkInId: UUID_A });

  expect(await readQueue()).toEqual([{ op: 'cheer', checkInId: UUID_A }]);
});

afterEach(async () => {
  await flushBeerCheckinsQueue();
  resetPrivateAccountBoundaryForTests();
});

describe('beer-checkins queue — tag round-trip', () => {
  it('restores the same bounded action ticket after a restart and ignores malformed storage', async () => {
    const ticket = {
      key: 'counter:radegast',
      visitClientId: null,
      clientIds: [UUID_A],
      checkedInAt: '2026-07-01T19:40:00.000Z',
      createdAt: 1,
    };
    await expect(saveBeerCheckInActionTicket(ticket)).resolves.toBe(true);
    await expect(loadBeerCheckInActionTicket(ticket.key)).resolves.toEqual(ticket);

    await AsyncStorage.setItem(
      ACTION_TICKETS_STORAGE_KEY,
      JSON.stringify([{ ...ticket, clientIds: ['not-a-uuid'] }]),
    );
    await expect(loadBeerCheckInActionTicket(ticket.key)).resolves.toBeNull();

    for (let index = 0; index < 25; index += 1) {
      await saveBeerCheckInActionTicket({
        ...ticket,
        key: `ticket-${index}`,
        clientIds: [index % 2 === 0 ? UUID_A : UUID_B],
      });
    }
    const raw = await AsyncStorage.getItem(ACTION_TICKETS_STORAGE_KEY);
    expect(JSON.parse(raw as string)).toHaveLength(20);
    await expect(removeBeerCheckInActionTicket('ticket-24')).resolves.toBe(true);
    await expect(loadBeerCheckInActionTicket('ticket-24')).resolves.toBeNull();
  });

  it('serializes close→reopen ticket acquisition onto one exact ID', async () => {
    const create = jest
      .fn()
      .mockReturnValueOnce({
        key: 'same-action',
        visitClientId: null,
        clientIds: [UUID_A],
        checkedInAt: '2026-07-01T19:40:00.000Z',
        createdAt: 1,
      })
      .mockReturnValue({
        key: 'same-action',
        visitClientId: null,
        clientIds: [UUID_B],
        checkedInAt: '2026-07-01T19:41:00.000Z',
        createdAt: 2,
      });

    const [first, reopened] = await Promise.all([
      getOrCreateBeerCheckInActionTicket('same-action', create),
      getOrCreateBeerCheckInActionTicket('same-action', create),
    ]);

    expect(first?.clientIds).toEqual([UUID_A]);
    expect(reopened?.clientIds).toEqual([UUID_A]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('persists a historical batch once before partially delivering it', async () => {
    submitBeerCheckIn.mockResolvedValueOnce('ok').mockResolvedValueOnce('retry');
    const setItem = jest.spyOn(AsyncStorage, 'setItem');

    await expect(enqueueBeerCheckInBatch([
      { op: 'checkin', payload: checkin({ clientId: UUID_A, beerName: 'Plzeň' }) },
      { op: 'checkin', payload: checkin({ clientId: UUID_B, beerName: 'Kozel' }) },
    ])).resolves.toBe('queued');

    expect(setItem).toHaveBeenCalledTimes(2);
    expect(submitBeerCheckIn).toHaveBeenCalledTimes(2);
    expect(setItem.mock.invocationCallOrder[0]).toBeLessThan(
      submitBeerCheckIn.mock.invocationCallOrder[0],
    );
    expect((await getPendingBeerCheckIns()).map((item) => item.clientId)).toEqual([UUID_B]);
  });

  it('refuses to commit an A batch after an account transition starts mid-delivery', async () => {
    let deliveryStarted!: () => void;
    let finishDelivery!: (result: 'retry') => void;
    const started = new Promise<void>((resolve) => { deliveryStarted = resolve; });
    submitBeerCheckIn.mockReturnValueOnce(new Promise((resolve) => {
      finishDelivery = resolve;
      deliveryStarted();
    }));

    const enqueue = enqueueBeerCheckInBatch([
      { op: 'checkin', payload: checkin({ clientId: UUID_A }) },
    ]);
    const outcome = enqueue.then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    await started;

    const transition = beginPrivateAccountTransition('account-switch', 'A');
    expect(transition).not.toBeNull();
    const drain = transition!.drain();
    finishDelivery('retry');
    await drain;
    transition!.release();

    expect(await outcome).toEqual({
      status: 'rejected',
      error: expect.any(PrivateAccountMutationFrozenError),
    });
  });

  it('reports a storage failure and never sends a non-durable check-in', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      enqueueBeerCheckInOp({ op: 'checkin', payload: checkin() }),
    ).resolves.toBe('storage-error');

    expect(submitBeerCheckIn).not.toHaveBeenCalled();
  });

  it('drops malformed persisted client IDs while delivering healthy siblings', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      { op: 'checkin', payload: checkin({ clientId: 'not-a-uuid' }) },
      { op: 'checkin', payload: checkin({ clientId: UUID_A }) },
    ]));

    await flushBeerCheckinsQueue();

    expect(submitBeerCheckIn).toHaveBeenCalledTimes(1);
    expect(submitBeerCheckIn).toHaveBeenCalledWith(expect.objectContaining({ clientId: UUID_A }));
  });

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
      payload: checkin({ clientId: UUID_A, beerName: 'Pilsner Urquell', visitClientId }),
    });
    await enqueueBeerCheckInOp({
      op: 'checkin',
      payload: checkin({ clientId: UUID_B, beerName: 'Kozel 11', visitClientId }),
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
      payload: checkin({ clientId: UUID_A, beerName: 'Pilsner Urquell', visitClientId, quantity: 1 }),
    });
    await enqueueBeerCheckInOp({
      op: 'checkin',
      payload: checkin({ clientId: UUID_A, beerName: 'Pilsner Urquell', visitClientId, quantity: 2 }),
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
    expect(delivered.clientId).toBe(UUID_A);
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
