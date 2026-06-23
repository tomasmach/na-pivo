import {
  buildAmenityRows,
  selectCompleteness,
  selectPersonalProgress,
  type AmenityRow,
} from '../pubAmenitiesView';
import { AMENITIES } from '../amenities';
import type { WireAmenityAggregate } from '../pubAmenitiesClient';
import type { PubAmenityVotes } from '@/stores/pubAmenitiesStore';

function agg(partial: Partial<WireAmenityAggregate> & { amenity_key: string }): WireAmenityAggregate {
  return {
    status: 'unknown',
    confidence: 0,
    yes_count: 0,
    no_count: 0,
    distinct_voter_count: 0,
    ...partial,
  };
}

function rowFor(rows: AmenityRow[], key: string): AmenityRow {
  const row = rows.find((r) => r.amenityKey === key);
  if (!row) throw new Error(`row ${key} missing`);
  return row;
}

describe('buildAmenityRows', () => {
  it('returns one row per active amenity in catalogue order', () => {
    const rows = buildAmenityRows({ aggregates: [], myVotes: undefined });
    expect(rows).toHaveLength(AMENITIES.length);
    expect(rows.map((r) => r.amenityKey)).toEqual(AMENITIES.map((a) => a.key));
  });

  it('marks every row loading when aggregates are unresolved (undefined), never unmapped', () => {
    const rows = buildAmenityRows({ aggregates: undefined, myVotes: undefined });
    expect(rows.every((r) => r.signalState === 'loading')).toBe(true);
    // Never fabricate a 0× ano for an unmapped amenity.
    expect(rows.every((r) => r.yesCount === 0 && r.noCount === 0)).toBe(true);
  });

  it('marks a confirmed zero-vote aggregate as unmapped (resolved empty array)', () => {
    const rows = buildAmenityRows({ aggregates: [], myVotes: undefined });
    expect(rows.every((r) => r.signalState === 'unmapped')).toBe(true);
  });

  it('renders known counts verbatim from the aggregate (no +1 heuristic)', () => {
    const aggregates = [agg({ amenity_key: 'payment_card', status: 'yes', yes_count: 8, no_count: 1 })];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    const card = rowFor(rows, 'payment_card');
    expect(card.signalState).toBe('known');
    expect(card.yesCount).toBe(8);
    expect(card.noCount).toBe(1);
    expect(card.status).toBe('yes');
    // No own vote → myValue null, and the crowd count is untouched.
    expect(card.myValue).toBeNull();
  });

  it("uses the server's my_value exactly as the user's own answer when there is no local vote", () => {
    const aggregates = [
      agg({ amenity_key: 'game_darts', status: 'yes', yes_count: 4, no_count: 0, my_value: 'yes' }),
    ];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    const darts = rowFor(rows, 'game_darts');
    expect(darts.myValue).toBe('yes');
    // The crowd tally is NOT mutated by the user's own contribution.
    expect(darts.yesCount).toBe(4);
  });

  it('lets a local pending vote win over the server my_value', () => {
    const aggregates = [
      agg({ amenity_key: 'game_darts', status: 'yes', yes_count: 4, no_count: 0, my_value: 'yes' }),
    ];
    const myVotes: PubAmenityVotes = {
      game_darts: { vote: 'no', updatedAt: '2026-01-01T00:00:00.000Z' },
    };
    const rows = buildAmenityRows({ aggregates, myVotes });
    expect(rowFor(rows, 'game_darts').myValue).toBe('no');
  });

  it('shows an optimistic local vote even when the aggregate is still loading', () => {
    const myVotes: PubAmenityVotes = {
      practical_wifi: { vote: 'yes', updatedAt: '2026-01-01T00:00:00.000Z' },
    };
    const rows = buildAmenityRows({ aggregates: undefined, myVotes });
    const wifi = rowFor(rows, 'practical_wifi');
    expect(wifi.myValue).toBe('yes');
    expect(wifi.signalState).toBe('loading');
  });

  it('surfaces a disputed verdict as known with both counts', () => {
    const aggregates = [
      agg({ amenity_key: 'game_billiards', status: 'disputed', yes_count: 3, no_count: 4 }),
    ];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    const row = rowFor(rows, 'game_billiards');
    expect(row.status).toBe('disputed');
    expect(row.signalState).toBe('known');
  });

  it('treats a non-unknown status with zero counts as known (seeded prior), not unmapped', () => {
    const aggregates = [agg({ amenity_key: 'seating_garden', status: 'yes', yes_count: 0, no_count: 0 })];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    expect(rowFor(rows, 'seating_garden').signalState).toBe('known');
  });

  it('ignores aggregates for unknown / reserved keys', () => {
    const aggregates = [
      agg({ amenity_key: 'practical_tank_beer', status: 'yes', yes_count: 9 }),
      agg({ amenity_key: 'totally_unknown', status: 'yes', yes_count: 9 }),
    ];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    expect(rows.find((r) => r.amenityKey === 'practical_tank_beer')).toBeUndefined();
    expect(rows.find((r) => r.amenityKey === 'totally_unknown')).toBeUndefined();
  });
});

describe('selectCompleteness', () => {
  it('counts only known rows for the local fallback meter', () => {
    const aggregates = [
      agg({ amenity_key: 'payment_card', status: 'yes', yes_count: 2 }),
      agg({ amenity_key: 'game_darts', status: 'no', no_count: 1 }),
    ];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    const c = selectCompleteness(rows);
    expect(c.totalKinds).toBe(AMENITIES.length);
    expect(c.mappedCount).toBe(2);
    expect(c.pct).toBeCloseTo(2 / AMENITIES.length);
  });

  it('reports 0% while everything is loading', () => {
    const rows = buildAmenityRows({ aggregates: undefined, myVotes: undefined });
    const c = selectCompleteness(rows);
    expect(c.mappedCount).toBe(0);
    expect(c.pct).toBe(0);
  });

  it('prefers the server completeness object and clamps it', () => {
    const rows = buildAmenityRows({ aggregates: [], myVotes: undefined });
    const c = selectCompleteness(rows, { mappedCount: 99, totalKinds: 16, pct: 1.5 });
    expect(c.totalKinds).toBe(16);
    expect(c.mappedCount).toBe(16); // clamped to totalKinds
    expect(c.pct).toBe(1); // clamped to 1
  });

  it('falls back to local computation when server completeness has a zero denominator', () => {
    const aggregates = [agg({ amenity_key: 'payment_card', status: 'yes', yes_count: 1 })];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    const c = selectCompleteness(rows, { mappedCount: 0, totalKinds: 0, pct: 0 });
    expect(c.totalKinds).toBe(AMENITIES.length);
    expect(c.mappedCount).toBe(1);
  });
});

describe('selectPersonalProgress', () => {
  it('counts the amenities the user themselves answered', () => {
    const myVotes: PubAmenityVotes = {
      payment_card: { vote: 'yes', updatedAt: '2026-01-01T00:00:00.000Z' },
      game_darts: { vote: 'no', updatedAt: '2026-01-01T00:00:00.000Z' },
    };
    const rows = buildAmenityRows({ aggregates: [], myVotes });
    const p = selectPersonalProgress(rows);
    expect(p.answered).toBe(2);
    expect(p.total).toBe(AMENITIES.length);
  });

  it('counts a server my_value (synced from another device) toward personal progress', () => {
    const aggregates = [agg({ amenity_key: 'practical_wifi', my_value: 'yes', yes_count: 3, status: 'yes' })];
    const rows = buildAmenityRows({ aggregates, myVotes: undefined });
    expect(selectPersonalProgress(rows).answered).toBe(1);
  });
});
