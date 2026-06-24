import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  readPubAmenitiesSnapshot,
  writePubAmenitiesSnapshot,
} from '../pubAmenitiesSnapshot';
import type { WireAmenityAggregate, WireAmenityCompleteness } from '../pubAmenitiesClient';

const PUB = 'u2fkbf8x';

const COMPLETENESS: WireAmenityCompleteness = { mapped_count: 2, total_kinds: 14, pct: 2 / 14 };
const AGGREGATES: WireAmenityAggregate[] = [
  { amenity_key: 'game_darts', status: 'yes', confidence: 0.9, yes_count: 4, no_count: 0, distinct_voter_count: 4 },
];

beforeEach(() => {
  (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, unknown> }).__INTERNAL_MOCK_STORAGE__ = {};
  jest.useRealTimers();
});

it('round-trips a fresh snapshot', async () => {
  await writePubAmenitiesSnapshot(PUB, { amenities: AGGREGATES, completeness: COMPLETENESS, mapperCount: 4 });
  const cached = await readPubAmenitiesSnapshot(PUB);
  expect(cached?.amenities[0].yes_count).toBe(4);
  expect(cached?.completeness.total_kinds).toBe(14);
  expect(cached?.mapperCount).toBe(4);
});

it('returns null for a missing pub', async () => {
  expect(await readPubAmenitiesSnapshot('nope')).toBeNull();
});

it('expires a snapshot older than the TTL', async () => {
  const now = Date.parse('2026-06-23T12:00:00.000Z');
  jest.useFakeTimers().setSystemTime(now);
  await writePubAmenitiesSnapshot(PUB, { amenities: AGGREGATES, completeness: COMPLETENESS, mapperCount: 1 });

  // Within TTL (5h later) → still cached.
  jest.setSystemTime(now + 5 * 60 * 60 * 1000);
  expect(await readPubAmenitiesSnapshot(PUB)).not.toBeNull();

  // Past TTL (7h later) → expired.
  jest.setSystemTime(now + 7 * 60 * 60 * 1000);
  expect(await readPubAmenitiesSnapshot(PUB)).toBeNull();
});

it('returns null for an empty pubKey rather than throwing', async () => {
  expect(await readPubAmenitiesSnapshot('')).toBeNull();
  await expect(writePubAmenitiesSnapshot('', { amenities: [], completeness: COMPLETENESS, mapperCount: 0 })).resolves.toBeUndefined();
});
