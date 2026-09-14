import {
  sessionDurationMs,
  sessionGapsMs,
  sessionFastestGapMs,
  performanceTone,
  computeLastPerformance,
  computeLifetime,
  computePeriodStats,
  computeRecords,
  computeTopPubs,
} from '../statsModel';
import type { TallySession } from '@/stores/tallyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** Local-time ISO so drinking-day bucketing is deterministic across test
 *  runners regardless of the machine timezone (drinkingDayKey reads local
 *  calendar fields). `mo` is 1-based for readability. */
function at(y: number, mo: number, d: number, h: number, mi = 0, sec = 0): string {
  return new Date(y, mo - 1, d, h, mi, sec, 0).toISOString();
}

let idSeq = 0;
function drink(over: Partial<{
  priceCzk: number;
  volumeMl: number;
  at: string;
  drinkType: 'beer' | 'soft_drink' | 'shot';
}> = {}) {
  idSeq += 1;
  return {
    id: `id-${idSeq}`,
    beerName: 'Pilsner Urquell',
    priceCzk: over.priceCzk ?? 60,
    at: over.at ?? at(2026, 6, 14, 19, 0),
    ...(typeof over.volumeMl === 'number' ? { volumeMl: over.volumeMl } : {}),
    ...(over.drinkType && over.drinkType !== 'beer' ? { drinkType: over.drinkType } : {}),
  };
}

function session(drinks: ReturnType<typeof drink>[], over: Partial<TallySession> = {}): TallySession {
  return {
    clientId: over.clientId ?? 'visit-aaaaaaaa',
    pubKey: over.pubKey ?? 'aaaaaaaa',
    pubName: over.pubName ?? 'U Zlatého tygra',
    startedAt: over.startedAt ?? drinks[0]?.at ?? at(2026, 6, 14, 19, 0),
    drinks: drinks.map((d) => d as TallySession['drinks'][number]),
    ...(over.archivedReason ? { archivedReason: over.archivedReason } : {}),
  };
}

beforeEach(() => {
  idSeq = 0;
});

describe('sessionDurationMs / gaps / fastest', () => {
  it('returns 0 / [] / null for a single-beer evening', () => {
    const s = session([drink({ at: at(2026, 6, 14, 19, 0) })]);
    expect(sessionDurationMs(s)).toBe(0);
    expect(sessionGapsMs(s)).toEqual([]);
    expect(sessionFastestGapMs(s)).toBeNull();
  });

  it('computes span, gaps and fastest gap across ordered drinks', () => {
    const s = session([
      drink({ at: at(2026, 6, 14, 19, 0) }),
      drink({ at: at(2026, 6, 14, 19, 30) }), // +30 min
      drink({ at: at(2026, 6, 14, 19, 42) }), // +12 min  ← fastest
      drink({ at: at(2026, 6, 14, 20, 30) }), // +48 min
    ]);
    expect(sessionDurationMs(s)).toBe(90 * 60 * 1000); // 19:00 → 20:30
    expect(sessionGapsMs(s)).toEqual([30, 12, 48].map((m) => m * 60 * 1000));
    expect(sessionFastestGapMs(s)).toBe(12 * 60 * 1000);
  });

  it('sorts out-of-order drinks before measuring', () => {
    const s = session([
      drink({ at: at(2026, 6, 14, 20, 0) }),
      drink({ at: at(2026, 6, 14, 19, 0) }),
      drink({ at: at(2026, 6, 14, 19, 50) }),
    ]);
    expect(sessionDurationMs(s)).toBe(60 * 60 * 1000); // 19:00 → 20:00
    expect(sessionFastestGapMs(s)).toBe(10 * 60 * 1000); // 19:50 → 20:00
  });

  it('ignores duplicate-like gaps and non-beer drinks when picking the fastest beer', () => {
    const s = session([
      drink({ at: at(2026, 6, 14, 19, 0) }),
      drink({ at: at(2026, 6, 14, 19, 0, 1) }),
      drink({ at: at(2026, 6, 14, 19, 3), drinkType: 'shot' }),
      drink({ at: at(2026, 6, 14, 19, 12) }),
    ]);

    expect(sessionGapsMs(s)).toEqual([1000, 12 * 60_000 - 1000]);
    expect(sessionFastestGapMs(s)).toBe(12 * 60_000 - 1000);
  });

  it('leaves fastest beer empty when every interval looks like a duplicate', () => {
    const s = session([
      drink({ at: at(2026, 6, 14, 19, 0) }),
      drink({ at: at(2026, 6, 14, 19, 1) }),
    ]);
    expect(sessionFastestGapMs(s)).toBeNull();
  });
});

describe('performanceTone', () => {
  it('buckets beer counts from start to huge', () => {
    expect(performanceTone(0)).toBe('start');
    expect(performanceTone(1)).toBe('start');
    expect(performanceTone(2)).toBe('warmup');
    expect(performanceTone(3)).toBe('warmup');
    expect(performanceTone(4)).toBe('solid');
    expect(performanceTone(6)).toBe('solid');
    expect(performanceTone(7)).toBe('big');
    expect(performanceTone(9)).toBe('big');
    expect(performanceTone(10)).toBe('huge');
    expect(performanceTone(20)).toBe('huge');
  });
});

describe('computeLifetime', () => {
  it('sums beers, evenings, distinct pubs and spend', () => {
    const sessions = [
      session([drink({ priceCzk: 50 }), drink({ priceCzk: 60 })], { pubKey: 'a' }),
      session([drink({ priceCzk: 40 })], { pubKey: 'a' }),
      session([drink({ priceCzk: 70 }), drink({ priceCzk: 70 }), drink({ priceCzk: 70 })], { pubKey: 'b' }),
    ];
    expect(computeLifetime(sessions)).toEqual({
      totalBeers: 6,
      totalEvenings: 3,
      distinctPubs: 2,
      totalSpentCzk: 50 + 60 + 40 + 70 + 70 + 70,
    });
  });

  it('is all-zero for no sessions', () => {
    expect(computeLifetime([])).toEqual({
      totalBeers: 0,
      totalEvenings: 0,
      distinctPubs: 0,
      totalSpentCzk: 0,
    });
  });

  it('counts outside evenings as beers/evenings/spend but never as a pub', () => {
    const sessions = [
      session([drink({ priceCzk: 50 })], { pubKey: 'a' }),
      session([drink({ priceCzk: 25 }), drink({ priceCzk: 25 })], {
        pubKey: 'ctx:private',
        pubName: 'Doma / na chatě',
        placeContext: 'private',
      }),
    ];
    expect(computeLifetime(sessions)).toEqual({
      totalBeers: 3,
      totalEvenings: 2,
      distinctPubs: 1,
      totalSpentCzk: 100,
    });
  });
});

describe('computePeriodStats', () => {
  it('groups by local drinking month and year and computes the average per evening', () => {
    const sessions = [
      session([drink({ priceCzk: 50 }), drink({ priceCzk: 60 })], {
        pubKey: 'a',
        startedAt: at(2025, 12, 31, 20, 0),
      }),
      session([drink({ priceCzk: 70 })], {
        pubKey: 'b',
        startedAt: at(2026, 1, 2, 1, 30),
      }),
      session([drink({ priceCzk: 80 }), drink({ priceCzk: 80 }), drink({ priceCzk: 80 })], {
        pubKey: 'c',
        startedAt: at(2026, 1, 20, 19, 0),
      }),
    ];

    expect(computePeriodStats(sessions)).toEqual({
      months: [
        {
          period: '2025-12',
          beers: 2,
          evenings: 1,
          spentCzk: 110,
          averageBeersPerEvening: 2,
        },
        {
          period: '2026-01',
          beers: 4,
          evenings: 2,
          spentCzk: 310,
          averageBeersPerEvening: 2,
        },
      ],
      years: [
        {
          period: '2025',
          beers: 2,
          evenings: 1,
          spentCzk: 110,
          averageBeersPerEvening: 2,
        },
        {
          period: '2026',
          beers: 4,
          evenings: 2,
          spentCzk: 310,
          averageBeersPerEvening: 2,
        },
      ],
    });
  });

  it('returns empty arrays without sessions and ignores malformed dates', () => {
    expect(computePeriodStats([])).toEqual({ months: [], years: [] });
    expect(computePeriodStats([session([drink()], { startedAt: 'not-a-date' })])).toEqual({
      months: [],
      years: [],
    });
  });
});

describe('computeRecords', () => {
  it('tracks most beers, fastest beer and longest evening across evenings', () => {
    const sessions = [
      // 2 beers, 20 min gap, 20 min span
      session(
        [drink({ at: at(2026, 6, 10, 19, 0) }), drink({ at: at(2026, 6, 10, 19, 20) })],
        { pubKey: 'a', pubName: 'Hospoda A', startedAt: at(2026, 6, 10, 19, 0) },
      ),
      // 3 beers, fastest gap 5 min, span 65 min  ← most beers + longest + fastest
      session(
        [
          drink({ at: at(2026, 6, 12, 18, 0) }),
          drink({ at: at(2026, 6, 12, 18, 5) }),
          drink({ at: at(2026, 6, 12, 19, 5) }),
        ],
        { pubKey: 'b', pubName: 'Hospoda B', startedAt: at(2026, 6, 12, 18, 0) },
      ),
    ];
    expect(computeRecords(sessions)).toEqual({
      mostBeersInEvening: 3,
      mostBeersPubName: 'Hospoda B',
      mostBeersStartedAt: at(2026, 6, 12, 18, 0),
      fastestBeerMs: 5 * 60 * 1000,
      longestEveningMs: 65 * 60 * 1000,
    });
  });

  it('leaves timing records null when no evening has 2 beers', () => {
    const sessions = [session([drink()], { pubKey: 'a' })];
    expect(computeRecords(sessions)).toEqual({
      mostBeersInEvening: 1,
      mostBeersPubName: 'U Zlatého tygra',
      mostBeersStartedAt: sessions[0].startedAt,
      fastestBeerMs: null,
      longestEveningMs: null,
    });
  });
});

describe('computeTopPubs', () => {
  it('aggregates per pub, sorts by beers, and keeps the most recent name', () => {
    const sessions = [
      session([drink(), drink()], { pubKey: 'a', pubName: 'Stará cedule', startedAt: at(2026, 6, 1, 19, 0) }),
      session([drink(), drink(), drink()], { pubKey: 'b', pubName: 'U Tygra', startedAt: at(2026, 6, 5, 19, 0) }),
      // Newer evening at pub 'a' under a renamed sign → name should follow.
      session([drink({ at: at(2026, 6, 20, 19, 0) })], {
        pubKey: 'a',
        pubName: 'Nová cedule',
        startedAt: at(2026, 6, 20, 19, 0),
      }),
    ];
    const top = computeTopPubs(sessions);
    expect(top).toHaveLength(2);
    // pub 'a' has 3 beers total, pub 'b' has 3 too → tie broken by most-recent.
    expect(top[0].pubKey).toBe('a');
    expect(top[0].beers).toBe(3);
    expect(top[0].pubName).toBe('Nová cedule');
    expect(top[1].pubKey).toBe('b');
    expect(top[1].beers).toBe(3);
  });

  it('respects the limit and ignores empty evenings', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session([drink()], { pubKey: `pub-${i}`, startedAt: at(2026, 6, 1 + i, 19, 0) }),
    );
    expect(computeTopPubs(sessions, 3)).toHaveLength(3);
  });

  it('excludes outside ("ctx:*") evenings — the top-pubs chart is a pub chart', () => {
    const sessions = [
      session([drink()], { pubKey: 'a', pubName: 'U Tygra' }),
      session([drink(), drink(), drink()], {
        pubKey: 'ctx:private',
        pubName: 'Doma / na chatě',
        placeContext: 'private',
      }),
    ];
    const top = computeTopPubs(sessions);
    expect(top).toHaveLength(1);
    expect(top[0].pubKey).toBe('a');
  });
});

describe('computeLastPerformance', () => {
  it('returns null when there are no evenings', () => {
    expect(computeLastPerformance(null, [], new Date(2026, 5, 15, 9, 0))).toBeNull();
  });

  it("surfaces yesterday's evening the morning after", () => {
    const s = session(
      [
        drink({ at: at(2026, 6, 14, 20, 0), priceCzk: 50 }),
        drink({ at: at(2026, 6, 14, 20, 40), priceCzk: 50 }),
        drink({ at: at(2026, 6, 14, 21, 0), priceCzk: 50 }),
      ],
      { pubKey: 'a', pubName: 'U Tygra', startedAt: at(2026, 6, 14, 20, 0) },
    );
    const perf = computeLastPerformance(null, [s], new Date(2026, 5, 15, 9, 0));
    expect(perf).not.toBeNull();
    expect(perf?.relation).toBe('yesterday');
    expect(perf?.beers).toBe(3);
    expect(perf?.spentCzk).toBe(150);
    expect(perf?.durationMs).toBe(60 * 60 * 1000); // 20:00 → 21:00
    expect(perf?.avgGapMs).toBe(30 * 60 * 1000); // 60 min / 2 gaps
    expect(perf?.fastestGapMs).toBe(20 * 60 * 1000); // 20:40 → 21:00
    expect(perf?.tone).toBe('warmup');
  });

  it('hides the hero when the newest evening is older than yesterday', () => {
    const s = session([drink({ at: at(2026, 6, 1, 20, 0) })], { startedAt: at(2026, 6, 1, 20, 0) });
    expect(computeLastPerformance(null, [s], new Date(2026, 5, 15, 9, 0))).toBeNull();
  });

  it('handles a single-beer evening with null gaps', () => {
    const s = session([drink({ at: at(2026, 6, 15, 12, 0), priceCzk: 45 })], {
      startedAt: at(2026, 6, 15, 12, 0),
    });
    const perf = computeLastPerformance(s, [], new Date(2026, 5, 15, 18, 0));
    expect(perf?.relation).toBe('today');
    expect(perf?.beers).toBe(1);
    expect(perf?.durationMs).toBe(0);
    expect(perf?.avgGapMs).toBeNull();
    expect(perf?.fastestGapMs).toBeNull();
    expect(perf?.tone).toBe('start');
  });
});
