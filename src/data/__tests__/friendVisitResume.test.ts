import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'test', token: 'synthetic' })),
  generateUuidV4: () => 'session-test',
}));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://127.0.0.1:18082${path}` }));
const submitVisit = jest.fn<Promise<string>, unknown[]>(async () => 'ok');
jest.mock('../visitsClient', () => ({
  submitVisit: (...args: unknown[]) => submitVisit(...args),
  deleteVisit: jest.fn(async () => 'ok'),
}));

import { IDLE_TIMEOUT_MS, useTallyStore } from '@/stores/tallyStore';
import { geohash8 } from '../geohash';
import { clearVisitsQueue, flushVisitsQueue } from '../visitsQueue';
import { clearFriendsQueue, enqueueFriendOp, isRetriableFriendError } from '../friendsQueue';
import { shareFriendPubActivity } from '../friendsClient';
import type { Pub } from '../pubs';

const pub: Pub = { id: 'test-pub', name: 'Test', lat: 50.08, lng: 14.42 };
const startedAt = '2026-09-19T16:00:00.000Z';
const resumedAt = new Date(Date.parse(startedAt) + IDLE_TIMEOUT_MS + 60_000).toISOString();

async function until(assertion: () => void | Promise<void>): Promise<void> {
  let error: unknown;
  for (let i = 0; i < 80; i++) {
    try { await assertion(); return; } catch (caught) { error = caught; }
    await Promise.resolve();
  }
  throw error;
}

it('retries an acknowledged no-op broadcast automatically once the visit reopens', async () => {
  await clearVisitsQueue();
  await clearFriendsQueue();
  await AsyncStorage.clear();
  useTallyStore.setState({ current: null, history: [] });
  useTallyStore.getState().addDrink({ pubKey: geohash8(pub.lat, pub.lng), pubName: pub.name }, {
    id: 'drink', beerName: 'Test', at: startedAt,
  });
  useTallyStore.getState().maybeAutoArchive(Date.parse(startedAt) + IDLE_TIMEOUT_MS);
  await flushVisitsQueue();

  let finishReopening!: () => void;
  let reopened = false;
  submitVisit.mockImplementationOnce(() => new Promise((resolve) => {
    finishReopening = () => { reopened = true; resolve('ok'); };
  }));
  const originalFetch = global.fetch;
  const fetchMock = jest.fn(async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify(reopened ? { id: 'activity', active: true } : { ended: true, applied: false }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  try {
    expect(useTallyStore.getState().resumeLast(geohash8(pub.lat, pub.lng), Date.parse(resumedAt))).toBe(true);
    await until(() => expect(finishReopening).toBeDefined());
    const result = await shareFriendPubActivity(pub, '', 'session-test', undefined, resumedAt);
    expect(result).toMatchObject({ ok: false, code: 'visit_pending' });
    expect(isRetriableFriendError(result as { ok: false; code: string; detail: string })).toBe(true);
    await enqueueFriendOp({
      op: 'activity', clientId: 'session-test', payload: { pub, startedAt: resumedAt },
    });
    expect(await AsyncStorage.getItem('na-pivo-friends-queue')).not.toBeNull();

    finishReopening();
    await flushVisitsQueue();
    await until(async () => expect(await AsyncStorage.getItem('na-pivo-friends-queue')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].body as string))
      .toMatchObject({ client_id: 'session-test', started_at: resumedAt });
  } finally {
    finishReopening?.();
    await flushVisitsQueue();
    await clearFriendsQueue();
    global.fetch = originalFetch;
  }
});

it('retries a persisted broadcast after a cold-start visit flush reopens the evening', async () => {
  await clearVisitsQueue();
  await clearFriendsQueue();
  await AsyncStorage.clear();
  useTallyStore.setState({ current: null, history: [] });
  await AsyncStorage.setItem('na-pivo-visits-queue', JSON.stringify([{
    op: 'upsert', clientId: 'persisted-visit', entry: {
      client_id: 'persisted-visit', name: pub.name, lat: pub.lat, lng: pub.lng,
      started_at: startedAt, closed_at: null, updated_at: resumedAt,
    },
  }]));
  await AsyncStorage.setItem('na-pivo-friends-queue', JSON.stringify([{
    op: 'activity', clientId: 'persisted-visit', payload: { pub, startedAt: resumedAt },
  }]));
  const originalFetch = global.fetch;
  const fetchMock = jest.fn(async () => ({ ok: true, status: 201, text: async () => '{"active":true}' }));
  global.fetch = fetchMock as unknown as typeof fetch;
  try {
    await flushVisitsQueue();
    await until(async () => expect(await AsyncStorage.getItem('na-pivo-friends-queue')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await clearFriendsQueue();
    global.fetch = originalFetch;
  }
});
