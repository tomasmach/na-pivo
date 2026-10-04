/**
 * Regression for the 429 storm on PUT /v1/pub-amenities/votes: the real queue and
 * client run against a mocked fetch. One 429 must pause every vote request until
 * Retry-After plus backoff, across concurrent flushes and an app restart, and the
 * queue must then deliver each vote exactly once.
 */

// Survives jest.resetModules(), like the device's disk survives an app restart.
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockDisk.delete(key); }),
}));

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `https://api.test${path}`,
}));

jest.mock('../account', () => ({
  ensureAccount: async () => ({ deviceId: 'd', accountId: 'a', token: 'tok', authenticated: false }),
  clearCachedAnonymousAccount: async () => true,
}));

jest.mock('../telemetryClient', () => ({
  trackClientEvent: async () => undefined,
}));

import {
  clearPubAmenitiesQueue,
  enqueueAmenityOp,
  flushPubAmenitiesQueue,
  type AmenityQueueItem,
} from '../pubAmenitiesQueue';
import { submitAmenityVotesDetailed } from '../pubAmenitiesClient';

const QUEUE_KEY = 'na-pivo-pub-amenities-queue';
const ORIGINAL_FETCH = global.fetch;

function upsert(amenityKey: string): AmenityQueueItem {
  return {
    op: 'upsert',
    pubKey: 'u2fkbnhu',
    amenityKey,
    payload: {
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
      amenity_key: amenityKey,
      value: 'yes',
      taxonomy_version: 1,
      client_updated_at: '2026-10-03T19:00:00.000Z',
    },
  };
}

function reply(status: number, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter ?? null : null) },
    json: async () => ({ results: [], mapper: null }),
  };
}

/**
 * Fetch answering from `replies` in order, then 200 for everything else. Returns
 * the amenity keys it received; jest.resetModules() would wipe mock.calls.
 */
function serve(...replies: ReturnType<typeof reply>[]): string[] {
  const sent: string[] = [];
  global.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)).votes[0].amenity_key);
    return replies.shift() ?? reply(200);
  }) as unknown as typeof fetch;
  return sent;
}

function queuedKeys(): string[] {
  const raw = mockDisk.get(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as AmenityQueueItem[]).map((item) => item.amenityKey) : [];
}

const KEYS = ['game_darts', 'practical_wifi', 'payment_card', 'seating_garden'];

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date('2026-10-04T11:00:00Z') });
  await clearPubAmenitiesQueue();
  mockDisk.clear();
});

afterEach(async () => {
  await clearPubAmenitiesQueue();
  await flushPubAmenitiesQueue();
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = ORIGINAL_FETCH;
});

it('stops the pass at the first 429 and sends nothing until Retry-After, then delivers each vote once', async () => {
  const sent = serve(reply(429, '30'));
  for (const key of KEYS) await enqueueAmenityOp(upsert(key));

  await flushPubAmenitiesQueue();
  expect(sent).toHaveLength(1);
  expect(queuedKeys()).toEqual(KEYS);

  // Foreground, launch and a new tap during the pause, all at once.
  await Promise.all([
    flushPubAmenitiesQueue(),
    flushPubAmenitiesQueue(),
    enqueueAmenityOp(upsert('practical_toilet')),
    submitAmenityVotesDetailed([upsert('game_pool').payload]),
  ]);
  await jest.advanceTimersByTimeAsync(29_000);
  expect(sent).toHaveLength(1);

  await jest.advanceTimersByTimeAsync(1_000);
  expect(sent.slice(1).sort()).toEqual([...KEYS, 'practical_toilet'].sort());
  expect(queuedKeys()).toEqual([]);

  await flushPubAmenitiesQueue();
  expect(sent).toHaveLength(6);
});

it('lengthens the pause while the server keeps answering 429', async () => {
  const sent = serve(reply(429, '1'), reply(429));
  for (const key of KEYS) await enqueueAmenityOp(upsert(key));

  await flushPubAmenitiesQueue();
  // Retry-After 1 s is shorter than the first backoff step.
  await jest.advanceTimersByTimeAsync(4_999);
  expect(sent).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(sent).toHaveLength(2);

  // The second 429 has no Retry-After; the next backoff step applies.
  await jest.advanceTimersByTimeAsync(29_999);
  expect(sent).toHaveLength(2);
  await jest.advanceTimersByTimeAsync(1);
  expect(sent).toHaveLength(2 + KEYS.length);
  expect(queuedKeys()).toEqual([]);
});

it('keeps the queue and the pause across an app restart, then delivers each vote once', async () => {
  const sent = serve(reply(429, '60'));
  for (const key of KEYS) await enqueueAmenityOp(upsert(key));
  await flushPubAmenitiesQueue();
  expect(sent).toHaveLength(1);

  // Kill the process: timers and module memory go away, the disk stays.
  jest.clearAllTimers();
  jest.resetModules();
  await jest.advanceTimersByTimeAsync(10_000);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const restarted = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');

  await restarted.flushPubAmenitiesQueue();
  await jest.advanceTimersByTimeAsync(49_999);
  expect(sent).toHaveLength(1);
  expect(queuedKeys()).toEqual(KEYS);

  await jest.advanceTimersByTimeAsync(1);
  expect(sent.slice(1)).toEqual(KEYS);
  expect(queuedKeys()).toEqual([]);
  await restarted.clearPubAmenitiesQueue();
});
