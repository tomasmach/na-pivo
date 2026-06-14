import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const enqueueVisitOp: jest.Mock = jest.fn((_item?: unknown) => Promise.resolve(undefined));
const flushVisitsQueue: jest.Mock = jest.fn(() => Promise.resolve(undefined));
jest.mock('../visitsQueue', () => ({
  enqueueVisitOp: (...args: unknown[]) => enqueueVisitOp(...(args as [])),
  flushVisitsQueue: () => flushVisitsQueue(),
}));

import {
  buildVisitEntry,
  syncVisit,
  seedVisitsFromHistory,
} from '../visitsSync';
import { geohash8 } from '../geohash';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

const PUB_KEY = geohash8(50.0876, 14.4214);

function session(over: Partial<TallySession> = {}): TallySession {
  return {
    clientId: 'v1',
    pubKey: PUB_KEY,
    pubName: 'U Zlatého tygra',
    startedAt: '2026-06-14T19:00:00.000Z',
    drinks: [
      { id: 'd1', beerName: 'Plzeň', priceCzk: 62, at: '2026-06-14T19:05:00.000Z' },
      { id: 'd2', beerName: 'Plzeň', priceCzk: 62, at: '2026-06-14T20:30:00.000Z' },
    ],
    ...over,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useTallyStore.setState({ current: null, history: [] });
});

describe('buildVisitEntry', () => {
  it('derives lat/lng from the pubKey cell that re-encodes to the same key', () => {
    const entry = buildVisitEntry(session());
    expect(entry).not.toBeNull();
    expect(geohash8(entry!.lat, entry!.lng)).toBe(PUB_KEY);
  });

  it('sets ended_at to the timestamp of the LAST counted beer', () => {
    expect(buildVisitEntry(session())?.ended_at).toBe('2026-06-14T20:30:00.000Z');
  });

  it('sets ended_at to null for an empty session', () => {
    expect(buildVisitEntry(session({ drinks: [] }))?.ended_at).toBeNull();
  });

  it('carries the session clientId as the idempotency key', () => {
    expect(buildVisitEntry(session({ clientId: 'abc' }))?.client_id).toBe('abc');
  });
});

describe('syncVisit', () => {
  it('enqueues an upsert for a session', () => {
    syncVisit(session());
    expect(enqueueVisitOp).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'upsert', clientId: 'v1' }),
    );
  });

  it('is a no-op for a null session', () => {
    syncVisit(null);
    expect(enqueueVisitOp).not.toHaveBeenCalled();
  });
});

describe('seedVisitsFromHistory', () => {
  it('enqueues every history session once and sets the guard', async () => {
    useTallyStore.setState({
      current: null,
      history: [session({ clientId: 'h1' }), session({ clientId: 'h2' })],
    });
    await seedVisitsFromHistory();
    const ids = enqueueVisitOp.mock.calls.map((c) => (c[0] as unknown as { clientId: string }).clientId).sort();
    expect(ids).toEqual(['h1', 'h2']);
    expect(await AsyncStorage.getItem('na-pivo-visits-seeded')).toBe('1');
  });

  it('does not re-seed once the guard is set', async () => {
    await AsyncStorage.setItem('na-pivo-visits-seeded', '1');
    useTallyStore.setState({ current: null, history: [session({ clientId: 'h1' })] });
    await seedVisitsFromHistory();
    expect(enqueueVisitOp).not.toHaveBeenCalled();
  });

  it('includes the current session when it holds drinks', async () => {
    useTallyStore.setState({ current: session({ clientId: 'cur' }), history: [] });
    await seedVisitsFromHistory();
    const ids = enqueueVisitOp.mock.calls.map((c) => (c[0] as unknown as { clientId: string }).clientId);
    expect(ids).toContain('cur');
  });
});
