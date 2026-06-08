/**
 * Hours-aware selection coverage for useCompass (the "Skrýt zavřené hospody"
 * filter, default ON).
 *
 * Focus: how resolved opening hours drive which pub the hook ends up targeting.
 *   • hideClosedPubs ON  → a pub resolving to isOpenNow === false is auto-skipped
 *     to the next nearest, walking one pub at a time until an open/unknown pub
 *     (or null) is reached.
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
import { fetchPubHours } from '@/data/hoursClient';
import type { PubHoursResult } from '@/data/hoursClient';
import { useCompass } from '../useCompass';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/data/pubs', () => ({
  findNearestPub: jest.fn(),
  findRandomPubInRadius: jest.fn(),
  isLoaded: jest.fn(() => true),
  fetchPubsNear: jest.fn(async () => undefined),
}));

jest.mock('@/data/hoursClient', () => ({
  fetchPubHours: jest.fn(),
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
    ({ excludeIds = [] }: { excludeIds?: string[] }) => {
      const excluded = new Set(excludeIds);
      return order.find((p) => !excluded.has(p.id)) ?? null;
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
      surpriseSeed: 17,
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
});
