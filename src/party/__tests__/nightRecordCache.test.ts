import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearNightRecordCache,
  loadLatestNightRecordCache,
  loadNightRecordCache,
  NIGHT_RECORD_CACHE_LIMIT,
  NIGHT_RECORD_STORAGE_KEY,
  readNightRecordCache,
  writeNightRecordCache,
} from '@/party/nightRecordCache';
import { emptyNight, type NightRecord } from '@/party/nightRecord';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function endedRecord(id: string, code: string, endedAt = '2026-08-05T22:00:00Z'): NightRecord {
  return {
    ...emptyNight(id, '2026-08-05T18:00:00Z', code),
    endedAt,
  };
}

beforeEach(async () => {
  await clearNightRecordCache();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it("never serves one account another account's private recap", async () => {
  const record = endedRecord('night-1', 'STUL24');
  await writeNightRecordCache('account-a', record);

  expect(readNightRecordCache('account-a', 'stul24')).toBe(record);
  expect(readNightRecordCache('account-b', 'STUL24')).toBeNull();
  expect(await loadNightRecordCache('account-b', 'STUL24')).toBeNull();

  await clearNightRecordCache();
  expect(readNightRecordCache('account-a', 'STUL24')).toBeNull();
  expect(await AsyncStorage.getItem(NIGHT_RECORD_STORAGE_KEY)).toBeNull();
});

it('hydrates a completed recap from durable storage after a cold start', async () => {
  await writeNightRecordCache('account-a', endedRecord('memory-copy', 'STUL24'));
  const stored = JSON.parse((await AsyncStorage.getItem(NIGHT_RECORD_STORAGE_KEY))!);
  stored.entries[0].record.id = 'disk-copy';
  await AsyncStorage.setItem(NIGHT_RECORD_STORAGE_KEY, JSON.stringify(stored));

  const exact = await loadNightRecordCache('account-a', 'stul24');
  const latest = await loadLatestNightRecordCache('account-a');

  expect(exact?.id).toBe('disk-copy');
  expect(latest?.id).toBe('disk-copy');
});

it('persists a finished offline party even before it has a server join code', async () => {
  const localOnly = {
    ...endedRecord('local-night', 'TEMP24'),
    code: null,
  };

  await writeNightRecordCache('account-a', localOnly);

  const stored = JSON.parse((await AsyncStorage.getItem(NIGHT_RECORD_STORAGE_KEY))!);
  expect(stored.entries[0]).toMatchObject({ accountId: 'account-a', code: null });
  await expect(loadLatestNightRecordCache('account-a')).resolves.toMatchObject({
    id: 'local-night',
    code: null,
  });
});

it('keeps a running poll in memory without writing AsyncStorage every ten seconds', async () => {
  const running = emptyNight('running-night', '2026-08-05T18:00:00Z', 'BEHY24');

  await writeNightRecordCache('account-a', running);

  expect(readNightRecordCache('account-a', 'BEHY24')).toBe(running);
  expect(await AsyncStorage.getItem(NIGHT_RECORD_STORAGE_KEY)).toBeNull();
});

it('keeps only a small bounded set of recent private recaps', async () => {
  for (let index = 0; index < NIGHT_RECORD_CACHE_LIMIT + 2; index += 1) {
    await writeNightRecordCache('account-a', endedRecord(`night-${index}`, `STUL2${index}`));
  }

  const stored = JSON.parse((await AsyncStorage.getItem(NIGHT_RECORD_STORAGE_KEY))!);
  expect(stored.entries).toHaveLength(NIGHT_RECORD_CACHE_LIMIT);
  expect(stored.entries.map((entry: { record: NightRecord }) => entry.record.id)).toEqual([
    'night-6',
    'night-5',
    'night-4',
    'night-3',
    'night-2',
  ]);
});

it('ignores a malformed persisted recap instead of crashing the route', async () => {
  await AsyncStorage.setItem(
    NIGHT_RECORD_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      entries: [
        {
          accountId: 'account-a',
          code: 'STUL24',
          savedAt: 1,
          record: { id: 'bad' },
        },
      ],
    }),
  );

  await expect(loadLatestNightRecordCache('account-a')).resolves.toBeNull();
});
