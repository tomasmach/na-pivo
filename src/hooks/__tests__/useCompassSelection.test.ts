/**
 * Hours-aware selection coverage for useCompass (the "Skrýt zavřené hospody"
 * filter, default ON).
 *
 * Focus: how resolved opening hours drive which pub the hook ends up targeting.
 *   • hideClosedPubs ON  → a pub resolving to isOpenNow === false is auto-skipped
 *     to the next nearest, walking one pub at a time until an open/unknown pub
 *     (or null) is reached, unless the user has already revealed that pub.
 *   • An UNKNOWN-hours pub is NOT skipped (we only hide pubs we KNOW are closed).
 *   • hideClosedPubs OFF → nothing is auto-skipped.
 *   • skip() excludes the current pub and advances to the next nearest.
 *   • The skip / auto-closed exclusion sets RESET on context change (mode / maxKm
 *     change), so they only accumulate while standing in one place.
 *   • A dormant backend (empty hours map) hides nothing — the closed-looking pub
 *     stays because its hours never resolve to a definite closed.
 *
 * Kept separate from useCompass.test.ts / useCompassHours.test.ts so the
 * exclusion-walking mocks don't perturb those suites.
 */

import React from 'react';
import { findNearestPub, findRandomPubInRadius, type Pub } from '@/data/pubs';
import { useDevicePosition } from '@/compass/useDevicePosition';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePubStore } from '@/stores/pubStore';
import { fetchPubHours } from '@/data/hoursClient';
import type { PubHoursResult } from '@/data/hoursClient';
import { persistPubReport } from '@/data/pubReportQueue';
import { geohash8 } from '@/data/geohash';
import { useCompass } from '../useCompass';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The compass focus-gates its sensors via expo-router's useFocusEffect; under
// test the screen is treated as focused, so the effect runs on mount (and its
// cleanup on unmount) exactly like a focused tab.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      useEffect(() => cb(), [cb]);
    },
  };
});

jest.mock('@/data/pubs', () => ({
  findNearestPub: jest.fn(),
  findRandomPubInRadius: jest.fn(),
  isLoaded: jest.fn(() => true),
  fetchPubsNear: jest.fn(async () => undefined),
}));

jest.mock('@/data/hoursClient', () => ({
  fetchPubHours: jest.fn(),
}));

jest.mock('@/data/pubReportQueue', () => ({
  persistPubReport: jest.fn(async () => true),
  flushPubReportQueue: jest.fn(async () => undefined),
}));

jest.mock('@/compass/useDevicePosition', () => ({
  useDevicePosition: jest.fn(() => ({
    position: { lat: 50.08, lng: 14.42, accuracyMeters: 8 },
  })),
}));

jest.mock('@/compass/useDeviceHeading', () => ({
  useDeviceHeading: jest.fn(() => ({
    smoothedHeading: { value: 10 },
    accuracyDeg: 5,
    hasMagnetometer: true,
  })),
}));

jest.mock('react-native-reanimated', () => ({
  useSharedValue: jest.fn((value) => ({ value })),
  useDerivedValue: jest.fn((factory) => ({ value: factory() })),
}));

jest.mock('@/compass/useTargetBearing', () => ({
  useTargetBearing: jest.fn(() => ({ bearing: 30, distanceMeters: 750 })),
}));

jest.mock('@/compass/useArrivalDetector', () => ({
  useArrivalDetector: jest.fn(() => ({ arrived: false, dismiss: jest.fn() })),
}));

jest.mock('@/compass/permissions', () => ({
  checkLocationPermission: jest.fn(async () => 'granted'),
  ensureLocationPermission: jest.fn(async () => 'granted'),
  openSystemSettings: jest.fn(async () => undefined),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const hookCleanups: Array<() => void> = [];

function renderCompassHook() {
  let latestResult: ReturnType<typeof useCompass> | undefined;
  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };

  function Harness() {
    latestResult = useCompass();
    return null;
  }

  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness));
  });

  const hook = {
    get result() {
      if (!latestResult) throw new Error('Hook result was not captured.');
      return latestResult;
    },
    rerender() {
      act(() => {
        renderer.update(React.createElement(Harness));
      });
    },
    unmount() {
      act(() => {
        renderer.unmount();
      });
    },
  };
  hookCleanups.push(hook.unmount);
  return hook;
}

/** Flush microtasks (and chained promise resolutions) inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const CLOSED: Pub = { id: 'mapy:closed', name: 'Closed Pub', lat: 50.08, lng: 14.42 };
const OPEN: Pub = { id: 'mapy:open', name: 'Open Pub', lat: 50.081, lng: 14.421 };
const UNKNOWN: Pub = { id: 'mapy:unknown', name: 'Unknown Pub', lat: 50.082, lng: 14.422 };
const THIRD: Pub = { id: 'mapy:third', name: 'Third Pub', lat: 50.083, lng: 14.423 };

function hours(overrides: Partial<PubHoursResult> = {}): PubHoursResult {
  return {
    openingHours: 'Po–Ne 11:00–23:00',
    isOpenNow: true,
    nextChange: '2026-06-08T23:00:00+02:00',
    status: 'ok',
    source: null,
    communityHours: null,
    beers: [],
    historicalBeers: [],
    beersUpdatedAt: null,
    beerMenuRotates: false,
    hoursUpdatedAt: null,
    rating: null,
    ratingCount: null,
    ratingLabel: null,
    hasGarden: null,
    venueKind: 'unknown',
    ...overrides,
  };
}

/**
 * Wire findNearestPub to walk an ordered list of pubs honoring excludeIds: it
 * returns the first pub in `order` whose id is not excluded, or null when all
 * are excluded. This reproduces the data layer's exclusion behavior so the
 * auto-skip / skip walk can be observed end to end.
 */
function wireNearestWalk(order: Pub[]) {
  (findNearestPub as jest.Mock).mockImplementation(
    ({
      excludeIds = [],
      excludeCacheKeys = [],
    }: { excludeIds?: string[]; excludeCacheKeys?: string[] }) => {
      const excluded = new Set(excludeIds);
      const excludedCells = new Set(excludeCacheKeys);
      return (
        order.find(
          (p) => !excluded.has(p.id) && !excludedCells.has(geohash8(p.lat, p.lng))
        ) ?? null
      );
    }
  );
}

/**
 * Wire fetchPubHours (called per single targeted pub) to resolve that pub's
 * hours from a lookup table keyed by pub id. Pubs absent from the table resolve
 * to an empty map (dormant / unknown to the backend).
 */
function wireHours(table: Record<string, PubHoursResult>) {
  (fetchPubHours as jest.Mock).mockImplementation(async (pubs: Pub[]) => {
    const out = new Map<string, PubHoursResult>();
    for (const p of pubs) {
      if (table[p.id]) out.set(p.id, table[p.id]);
    }
    return out;
  });
}

describe('useCompass — hours-aware selection (Skrýt zavřené hospody)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useDevicePosition as jest.Mock).mockReturnValue({
      position: { lat: 50.08, lng: 14.42, accuracyMeters: 8 },
    });
    useSettingsStore.setState({
      mode: 'nearest',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      preferRatedPubs: false,
      preferGardenPubs: false,
      surpriseSeed: 17,
    });
    usePubStore.setState({
      revealedPub: null,
      reportedPubIds: [],
      reportedCacheKeys: [],
      isDataLoaded: false,
    });
    (findRandomPubInRadius as jest.Mock).mockReturnValue(OPEN);
  });

  afterEach(() => {
    for (const cleanup of hookCleanups.splice(0)) cleanup();
  });

  it('auto-skips a known-closed pub and lands on the next nearest open pub', async () => {
    // Nearest order: CLOSED (isOpenNow=false) → OPEN. The closed one must be
    // walked past automatically once its hours resolve.
    wireNearestWalk([CLOSED, OPEN]);
    wireHours({
      [CLOSED.id]: hours({ isOpenNow: false, openingHours: null }),
      [OPEN.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();
    // Allow the auto-skip + re-selection + the new pub's hours fetch to settle.
    await flush();

    expect(hook.result.pub?.id).toBe(OPEN.id);
    expect(hook.result.pub?.isOpenNow).toBe(true);

    // CLOSED must have been excluded from the re-selection.
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toContain(CLOSED.id);
  });

  it('does not auto-skip a closed pub after the user has revealed it', async () => {
    wireNearestWalk([CLOSED, OPEN]);
    let resolveHours!: (m: Map<string, PubHoursResult>) => void;
    (fetchPubHours as jest.Mock).mockImplementation(
      () =>
        new Promise<Map<string, PubHoursResult>>((resolve) => {
          resolveHours = resolve;
        })
    );

    const hook = renderCompassHook();
    await flush();

    expect(hook.result.pub?.id).toBe(CLOSED.id);
    expect(hook.result.pub?.hoursStatus).toBe('loading');

    act(() => {
      hook.result.reveal();
    });

    await act(async () => {
      resolveHours(new Map([[CLOSED.id, hours({ isOpenNow: false })]]));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(hook.result.revealed).toBe(true);
    expect(hook.result.pub?.id).toBe(CLOSED.id);
    expect(hook.result.pub?.isOpenNow).toBe(false);
    const allExcludes = (findNearestPub as jest.Mock).mock.calls.flatMap(
      (c) => c[0]?.excludeIds ?? []
    );
    expect(allExcludes).not.toContain(CLOSED.id);
  });

  it('walks past multiple known-closed pubs until it finds an open one', async () => {
    wireNearestWalk([CLOSED, THIRD, OPEN]);
    wireHours({
      [CLOSED.id]: hours({ isOpenNow: false }),
      [THIRD.id]: hours({ isOpenNow: false }),
      [OPEN.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(OPEN.id);
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toEqual(expect.arrayContaining([CLOSED.id, THIRD.id]));
  });

  it('does NOT skip a pub whose hours are unknown (status unknown, isOpenNow null)', async () => {
    // The first nearest pub is genuinely unknown to the backend → stays put.
    wireNearestWalk([UNKNOWN, OPEN]);
    wireHours({
      [UNKNOWN.id]: hours({ isOpenNow: null, status: 'unknown', openingHours: null, nextChange: null }),
      [OPEN.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(UNKNOWN.id);
    // UNKNOWN was never added to excludeIds — no re-selection past it.
    const allExcludes = (findNearestPub as jest.Mock).mock.calls.flatMap(
      (c) => c[0]?.excludeIds ?? []
    );
    expect(allExcludes).not.toContain(UNKNOWN.id);
  });

  it('with hideClosedPubs OFF, keeps a known-closed pub (nothing is auto-skipped)', async () => {
    useSettingsStore.setState({ hideClosedPubs: false });
    wireNearestWalk([CLOSED, OPEN]);
    wireHours({
      [CLOSED.id]: hours({ isOpenNow: false }),
      [OPEN.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    // The closed pub is still the target; it just shows as closed.
    expect(hook.result.pub?.id).toBe(CLOSED.id);
    expect(hook.result.pub?.isOpenNow).toBe(false);
    const allExcludes = (findNearestPub as jest.Mock).mock.calls.flatMap(
      (c) => c[0]?.excludeIds ?? []
    );
    expect(allExcludes).not.toContain(CLOSED.id);
  });

  it('dormant backend (empty hours map) hides nothing — closed-looking pub stays', async () => {
    // hideClosedPubs is ON, but the backend never resolves hours, so isOpenNow
    // is never a definite false → the pub must NOT be auto-skipped.
    wireNearestWalk([CLOSED, OPEN]);
    (fetchPubHours as jest.Mock).mockResolvedValue(new Map());

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(CLOSED.id);
    expect(hook.result.pub?.isOpenNow).toBeUndefined();
    const allExcludes = (findNearestPub as jest.Mock).mock.calls.flatMap(
      (c) => c[0]?.excludeIds ?? []
    );
    expect(allExcludes).not.toContain(CLOSED.id);
  });

  it('skip() excludes the current pub and advances to the next nearest', async () => {
    // Both pubs are open; the user simply doesn't fancy the first one.
    wireNearestWalk([OPEN, THIRD]);
    wireHours({
      [OPEN.id]: hours({ isOpenNow: true }),
      [THIRD.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();
    expect(hook.result.pub?.id).toBe(OPEN.id);

    act(() => {
      hook.result.skip();
    });
    await flush();

    expect(hook.result.pub?.id).toBe(THIRD.id);
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toContain(OPEN.id);
  });

  it('skip() is a no-op when there is no current pub', async () => {
    (findNearestPub as jest.Mock).mockReturnValue(null);
    (findRandomPubInRadius as jest.Mock).mockReturnValue(null);

    const hook = renderCompassHook();
    await flush();
    expect(hook.result.pub).toBeNull();

    const callsBefore = (findNearestPub as jest.Mock).mock.calls.length;
    act(() => {
      hook.result.skip();
    });
    await flush();

    // No re-selection kicked off, still null.
    expect(hook.result.pub).toBeNull();
    expect((findNearestPub as jest.Mock).mock.calls.length).toBe(callsBefore);
  });

  it('resets the skip exclusion set on context change (mode switch)', async () => {
    wireNearestWalk([OPEN, THIRD]);
    wireHours({
      [OPEN.id]: hours({ isOpenNow: true }),
      [THIRD.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();

    // Skip OPEN → now targeting THIRD with OPEN excluded.
    act(() => {
      hook.result.skip();
    });
    await flush();
    expect(hook.result.pub?.id).toBe(THIRD.id);

    // Switch mode then back: a context change must clear accumulated skips, so a
    // fresh nearest selection has an EMPTY excludeIds and returns OPEN again.
    (findRandomPubInRadius as jest.Mock).mockReturnValue(OPEN);
    act(() => {
      hook.result.setMode('surprise');
    });
    await flush();
    act(() => {
      hook.result.setMode('nearest');
    });
    await flush();

    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toEqual([]);
    expect(hook.result.pub?.id).toBe(OPEN.id);
  });

  it('resets the auto-closed exclusion set on retrySearch', async () => {
    wireNearestWalk([CLOSED, OPEN]);
    wireHours({
      [CLOSED.id]: hours({ isOpenNow: false }),
      [OPEN.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();
    // Auto-skipped CLOSED → on OPEN now.
    expect(hook.result.pub?.id).toBe(OPEN.id);

    act(() => {
      hook.result.retrySearch();
    });
    await flush();
    await flush();

    // After retry the exclusions were cleared, so the walk starts over from
    // CLOSED — which gets auto-skipped again, landing back on OPEN. The point:
    // the FIRST post-retry nearest call has a clean (empty) excludeIds.
    const callsAfterRetry = (findNearestPub as jest.Mock).mock.calls;
    // Find the first call after the retry reset (its excludeIds is empty again).
    const sawEmptyAfterRetry = callsAfterRetry.some(
      (c) => (c[0]?.excludeIds ?? []).length === 0
    );
    expect(sawEmptyAfterRetry).toBe(true);
    expect(hook.result.pub?.id).toBe(OPEN.id);
  });

  it('persistent reported pubs are excluded from selection', async () => {
    usePubStore.setState({ reportedPubIds: [OPEN.id] });
    wireNearestWalk([OPEN, THIRD]);
    wireHours({
      [OPEN.id]: hours({ isOpenNow: true }),
      [THIRD.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();

    expect(hook.result.pub?.id).toBe(THIRD.id);
    const firstCall = (findNearestPub as jest.Mock).mock.calls[0]?.[0];
    expect(firstCall?.excludeIds).toContain(OPEN.id);
  });

  it('reportCurrentPub hides the current pub locally and queues the report', async () => {
    wireNearestWalk([OPEN, THIRD]);
    wireHours({
      [OPEN.id]: hours({ isOpenNow: true }),
      [THIRD.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();
    expect(hook.result.pub?.id).toBe(OPEN.id);

    let synced = false;
    await act(async () => {
      synced = await hook.result.reportCurrentPub('not_pub');
    });
    await flush();

    expect(synced).toBe(true);
    expect(usePubStore.getState().reportedPubIds).toContain(OPEN.id);
    expect(usePubStore.getState().reportedCacheKeys).toContain(
      geohash8(OPEN.lat, OPEN.lng)
    );
    expect(persistPubReport).toHaveBeenCalledWith(OPEN, 'not_pub');
    expect(hook.result.pub?.id).toBe(THIRD.id);
  });

  it('keeps the pub visible when the report cannot be persisted', async () => {
    (persistPubReport as jest.Mock).mockResolvedValueOnce(false);
    wireNearestWalk([OPEN, THIRD]);
    wireHours({
      [OPEN.id]: hours({ isOpenNow: true }),
      [THIRD.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();

    await expect(hook.result.reportCurrentPub('closed')).resolves.toBe(false);
    expect(usePubStore.getState().reportedPubIds).not.toContain(OPEN.id);
    expect(hook.result.pub?.id).toBe(OPEN.id);
  });

  it('a reported pub stays hidden when Mapy.cz returns it under a fresh id', async () => {
    // The user reported OPEN earlier; a later fetch re-ids the same physical
    // place. Id-based exclusion misses the fresh id — the persisted geohash-8
    // cell must still hide it from selection.
    const rebornOpen: Pub = { ...OPEN, id: 'mapy:fresh-id' };
    usePubStore.setState({
      reportedPubIds: [OPEN.id],
      reportedCacheKeys: [geohash8(OPEN.lat, OPEN.lng)],
    });
    wireNearestWalk([rebornOpen, THIRD]);
    wireHours({
      [rebornOpen.id]: hours({ isOpenNow: true }),
      [THIRD.id]: hours({ isOpenNow: true }),
    });

    const hook = renderCompassHook();
    await flush();

    expect(hook.result.pub?.id).toBe(THIRD.id);
    const firstCall = (findNearestPub as jest.Mock).mock.calls[0]?.[0];
    expect(firstCall?.excludeCacheKeys).toContain(geohash8(OPEN.lat, OPEN.lng));
  });
});

/**
 * Backend venueKind === 'not_pub' hides a place before it is revealed: the
 * compass walks past it to the next eligible pub, exactly like a known-closed
 * pub, but independent of the "hide closed" preference. Once the user is
 * already inspecting a revealed pub, the target stays stable.
 */
describe('useCompass — venueKind not_pub hiding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useDevicePosition as jest.Mock).mockReturnValue({
      position: { lat: 50.08, lng: 14.42, accuracyMeters: 8 },
    });
    useSettingsStore.setState({
      mode: 'nearest',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      surpriseSeed: 17,
    });
    usePubStore.setState({
      revealedPub: null,
      reportedPubIds: [],
      reportedCacheKeys: [],
      isDataLoaded: false,
    });
    (findRandomPubInRadius as jest.Mock).mockReturnValue(OPEN);
  });

  afterEach(() => {
    for (const cleanup of hookCleanups.splice(0)) cleanup();
  });

  it('auto-hides a not_pub place and lands on the next nearest pub', async () => {
    // NOT_PUB is open per hours but is not actually a pub → must be walked past.
    const NOT_PUB: Pub = { id: 'mapy:not_pub', name: 'Sushi Place', lat: 50.08, lng: 14.42 };
    wireNearestWalk([NOT_PUB, OPEN]);
    wireHours({
      [NOT_PUB.id]: hours({ isOpenNow: true, venueKind: 'not_pub' }),
      [OPEN.id]: hours({ isOpenNow: true, venueKind: 'pub' }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(OPEN.id);
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toContain(NOT_PUB.id);
  });

  it('hides a not_pub place EVEN WITH hideClosedPubs OFF (unconditional)', async () => {
    useSettingsStore.setState({ hideClosedPubs: false });
    const NOT_PUB: Pub = { id: 'mapy:not_pub', name: 'Sushi Place', lat: 50.08, lng: 14.42 };
    wireNearestWalk([NOT_PUB, OPEN]);
    wireHours({
      [NOT_PUB.id]: hours({ isOpenNow: true, venueKind: 'not_pub' }),
      [OPEN.id]: hours({ isOpenNow: true, venueKind: 'pub' }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(OPEN.id);
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toContain(NOT_PUB.id);
  });

  it('does not auto-hide a not_pub place after the user has revealed it', async () => {
    const NOT_PUB: Pub = { id: 'mapy:not_pub', name: 'Sushi Place', lat: 50.08, lng: 14.42 };
    wireNearestWalk([NOT_PUB, OPEN]);
    let resolveHours!: (m: Map<string, PubHoursResult>) => void;
    (fetchPubHours as jest.Mock).mockImplementation(
      () =>
        new Promise<Map<string, PubHoursResult>>((resolve) => {
          resolveHours = resolve;
        })
    );

    const hook = renderCompassHook();
    await flush();

    expect(hook.result.pub?.id).toBe(NOT_PUB.id);
    act(() => {
      hook.result.reveal();
    });

    await act(async () => {
      resolveHours(new Map([[NOT_PUB.id, hours({ isOpenNow: true, venueKind: 'not_pub' })]]));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(hook.result.revealed).toBe(true);
    expect(hook.result.pub?.id).toBe(NOT_PUB.id);
    expect(hook.result.pub?.venueKind).toBe('not_pub');
    const allExcludes = (findNearestPub as jest.Mock).mock.calls.flatMap(
      (c) => c[0]?.excludeIds ?? []
    );
    expect(allExcludes).not.toContain(NOT_PUB.id);
  });

  it('does NOT hide pub / maybe / unknown verdicts', async () => {
    const MAYBE: Pub = { id: 'mapy:maybe', name: 'Half Restaurant', lat: 50.08, lng: 14.42 };
    wireNearestWalk([MAYBE, OPEN]);
    wireHours({
      [MAYBE.id]: hours({ isOpenNow: true, venueKind: 'maybe' }),
      [OPEN.id]: hours({ isOpenNow: true, venueKind: 'pub' }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    // 'maybe' stays put — it is a candidate pub.
    expect(hook.result.pub?.id).toBe(MAYBE.id);
    const allExcludes = (findNearestPub as jest.Mock).mock.calls.flatMap(
      (c) => c[0]?.excludeIds ?? []
    );
    expect(allExcludes).not.toContain(MAYBE.id);
  });

  it('walks past multiple not_pub places until it finds a real pub', async () => {
    const NOT_A: Pub = { id: 'mapy:not_a', name: 'Sushi A', lat: 50.08, lng: 14.42 };
    const NOT_B: Pub = { id: 'mapy:not_b', name: 'Cafe B', lat: 50.081, lng: 14.421 };
    wireNearestWalk([NOT_A, NOT_B, OPEN]);
    wireHours({
      [NOT_A.id]: hours({ isOpenNow: true, venueKind: 'not_pub' }),
      [NOT_B.id]: hours({ isOpenNow: true, venueKind: 'not_pub' }),
      [OPEN.id]: hours({ isOpenNow: true, venueKind: 'pub' }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(OPEN.id);
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toEqual(expect.arrayContaining([NOT_A.id, NOT_B.id]));
  });

  it('dormant backend (empty hours map) hides nothing — missing verdict stays', async () => {
    const PLACE: Pub = { id: 'mapy:place', name: 'Some Place', lat: 50.08, lng: 14.42 };
    wireNearestWalk([PLACE, OPEN]);
    (fetchPubHours as jest.Mock).mockResolvedValue(new Map());

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(PLACE.id);
    const allExcludes = (findNearestPub as jest.Mock).mock.calls.flatMap(
      (c) => c[0]?.excludeIds ?? []
    );
    expect(allExcludes).not.toContain(PLACE.id);
  });
});

describe('useCompass — rating and garden preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useDevicePosition as jest.Mock).mockReturnValue({
      position: { lat: 50.08, lng: 14.42, accuracyMeters: 8 },
    });
    useSettingsStore.setState({
      mode: 'nearest',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      preferRatedPubs: false,
      preferGardenPubs: false,
      surpriseSeed: 17,
    });
    usePubStore.setState({
      revealedPub: null,
      reportedPubIds: [],
      reportedCacheKeys: [],
      isDataLoaded: false,
    });
    (findRandomPubInRadius as jest.Mock).mockReturnValue(OPEN);
  });

  afterEach(() => {
    for (const cleanup of hookCleanups.splice(0)) cleanup();
  });

  it('skips a known low-rated pub when the 4+ preference is enabled', async () => {
    useSettingsStore.setState({ preferRatedPubs: true });
    const LOW: Pub = { id: 'mapy:low', name: 'Slabší šenk', lat: 50.08, lng: 14.42 };
    wireNearestWalk([LOW, OPEN]);
    wireHours({
      [LOW.id]: hours({ rating: 3.7 }),
      [OPEN.id]: hours({ rating: 4.3 }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(OPEN.id);
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toContain(LOW.id);
  });

  it('keeps unknown ratings eligible under the 4+ preference', async () => {
    useSettingsStore.setState({ preferRatedPubs: true });
    const UNKNOWN_RATING: Pub = {
      id: 'mapy:unknown-rating',
      name: 'Bez hvězd',
      lat: 50.08,
      lng: 14.42,
    };
    wireNearestWalk([UNKNOWN_RATING, OPEN]);
    wireHours({
      [UNKNOWN_RATING.id]: hours({ rating: null }),
      [OPEN.id]: hours({ rating: 4.5 }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(UNKNOWN_RATING.id);
  });

  it('skips a known no-garden pub when the garden preference is enabled', async () => {
    useSettingsStore.setState({ preferGardenPubs: true });
    const INSIDE: Pub = { id: 'mapy:inside', name: 'Jen uvnitř', lat: 50.08, lng: 14.42 };
    wireNearestWalk([INSIDE, OPEN]);
    wireHours({
      [INSIDE.id]: hours({ hasGarden: false }),
      [OPEN.id]: hours({ hasGarden: true }),
    });

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.id).toBe(OPEN.id);
    const lastCall = (findNearestPub as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.excludeIds).toContain(INSIDE.id);
  });
});
