import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import type { WireVisit } from '../visitsClient';
import {
  VISITS_MAP_SNAPSHOT_KEY,
  clearVisitsSnapshot,
  loadVisitsSnapshot,
  saveVisitsSnapshot,
  subscribeVisitsBoundary,
  visitsSnapshotGeneration,
} from '../visitsSnapshot';

const visit: WireVisit = {
  client_id: 'visit-1',
  cache_key: 'u2fkbn1x',
  name: 'U Testu',
  lat: 50.08,
  lng: 14.42,
  city: 'Praha',
  external_id: null,
  started_at: '2026-07-01T18:00:00.000Z',
  ended_at: null,
  updated_at: '2026-07-01T18:00:00.000Z',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('visits map snapshot', () => {
  it('round-trips valid private visit history', async () => {
    await saveVisitsSnapshot([visit], visitsSnapshotGeneration());
    await expect(loadVisitsSnapshot()).resolves.toEqual([visit]);
  });

  it('drops malformed rows instead of crashing the map', async () => {
    await AsyncStorage.setItem(
      VISITS_MAP_SNAPSHOT_KEY,
      JSON.stringify({ visits: [visit, { client_id: 'broken' }] }),
    );
    await expect(loadVisitsSnapshot()).resolves.toEqual([visit]);
  });

  it('does not let an old-account write recreate data after a boundary clear', async () => {
    const oldGeneration = visitsSnapshotGeneration();
    await clearVisitsSnapshot();
    await saveVisitsSnapshot([visit], oldGeneration);
    expect(await AsyncStorage.getItem(VISITS_MAP_SNAPSHOT_KEY)).toBeNull();
  });

  it('notifies mounted consumers immediately at an account boundary', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeVisitsBoundary(listener);
    await clearVisitsSnapshot();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
