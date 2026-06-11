/**
 * Opening-hours integration coverage for useCompass.
 *
 * Verifies that when the targeted pub changes, the hook kicks off a
 * fetchPubHours lookup and merges the result onto the pub it returns
 * (pub.isOpenNow / pub.hoursStatus / pub.openingHours), and that a failed /
 * empty hours lookup is a non-blocking enrichment: the pub is still returned.
 *
 * Kept in a separate file from useCompass.test.ts so the hours client can be
 * mocked without affecting the existing selection-focused suite.
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

jest.mock('@/data/pubReportsClient', () => ({
  reportPubIssue: jest.fn(async () => true),
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

/** Flush microtasks (and any chained promise resolutions) inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const PUB: Pub = { id: 'mapy:49.2,16.6', name: 'Far Pub', lat: 49.2, lng: 16.6, city: 'Brno' };
const PUB_B: Pub = { id: 'mapy:50.1,14.5', name: 'Other Pub', lat: 50.1, lng: 14.5, city: 'Praha' };

function result(overrides: Partial<PubHoursResult> = {}): PubHoursResult {
  return {
    openingHours: 'Po–Ne 11:00–23:00',
    isOpenNow: true,
    nextChange: '2026-06-08T23:00:00+02:00',
    status: 'ok',
    source: null,
    communityHours: null,
    beers: [],
    ...overrides,
  };
}

describe('useCompass — opening hours enrichment', () => {
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
    (findNearestPub as jest.Mock).mockReturnValue(PUB);
    (findRandomPubInRadius as jest.Mock).mockReturnValue(PUB);
  });

  afterEach(() => {
    for (const cleanup of hookCleanups.splice(0)) cleanup();
  });

  it('looks up hours for the selected pub and merges them onto the returned pub', async () => {
    (fetchPubHours as jest.Mock).mockResolvedValue(new Map([[PUB.id, result()]]));

    const hook = renderCompassHook();
    await flush();

    // Only the single targeted pub is looked up — never the whole nearby set.
    expect(fetchPubHours).toHaveBeenCalledTimes(1);
    const [pubsArg] = (fetchPubHours as jest.Mock).mock.calls[0];
    expect(pubsArg).toEqual([PUB]);

    const enriched = hook.result.pub;
    expect(enriched).not.toBeNull();
    expect(enriched?.id).toBe(PUB.id);
    expect(enriched?.isOpenNow).toBe(true);
    expect(enriched?.hoursStatus).toBe('ok');
    expect(enriched?.openingHours).toBe('Po–Ne 11:00–23:00');
    expect(enriched?.nextChange).toBe('2026-06-08T23:00:00+02:00');
  });

  it('passes an AbortSignal so the previous lookup can be cancelled', async () => {
    (fetchPubHours as jest.Mock).mockResolvedValue(new Map([[PUB.id, result()]]));

    renderCompassHook();
    await flush();

    const [, signalArg] = (fetchPubHours as jest.Mock).mock.calls[0];
    expect(signalArg).toBeInstanceOf(AbortSignal);
  });

  it('reflects a closed pub when the backend reports isOpenNow=false', async () => {
    (fetchPubHours as jest.Mock).mockResolvedValue(
      new Map([[PUB.id, result({ isOpenNow: false, openingHours: null })]])
    );

    const hook = renderCompassHook();
    await flush();

    expect(hook.result.pub?.isOpenNow).toBe(false);
    expect(hook.result.pub?.hoursStatus).toBe('ok');
  });

  it('keeps returning the pub (unenriched) when the hours lookup resolves empty', async () => {
    // Dormant backend / failure inside fetchPubHours → empty Map (it never throws).
    (fetchPubHours as jest.Mock).mockResolvedValue(new Map());

    const hook = renderCompassHook();
    await flush();

    const pub = hook.result.pub;
    expect(pub).not.toBeNull();
    expect(pub?.id).toBe(PUB.id);
    // No hours fields leak through when the lookup yields nothing.
    expect(pub?.isOpenNow).toBeUndefined();
    expect(pub?.hoursStatus).toBeUndefined();
    expect(pub?.openingHours).toBeUndefined();
  });

  it('does not break the hook when the hours lookup rejects', async () => {
    // fetchPubHours is contractually non-throwing, but guard against a regression:
    // even a rejected promise must not tear down the compass.
    (fetchPubHours as jest.Mock).mockRejectedValue(new Error('boom'));

    const hook = renderCompassHook();
    await flush();

    const pub = hook.result.pub;
    expect(pub).not.toBeNull();
    expect(pub?.id).toBe(PUB.id);
    expect(pub?.isOpenNow).toBeUndefined();
    expect(pub?.hoursStatus).toBeUndefined();
    // The rest of the compass keeps working.
    expect(hook.result.isLoading).toBe(false);
    expect(hook.result.distanceMeters).toBe(750);
  });

  it('marks the pub as loading while the lookup is in flight', async () => {
    let resolveHours!: (m: Map<string, PubHoursResult>) => void;
    (fetchPubHours as jest.Mock).mockReturnValue(
      new Promise<Map<string, PubHoursResult>>((resolve) => {
        resolveHours = resolve;
      })
    );

    const hook = renderCompassHook();
    await flush();

    // In-flight: consumers see a neutral 'loading' status, pub still present.
    expect(hook.result.pub?.id).toBe(PUB.id);
    expect(hook.result.pub?.hoursStatus).toBe('loading');

    await act(async () => {
      resolveHours(new Map([[PUB.id, result()]]));
      await Promise.resolve();
    });

    expect(hook.result.pub?.hoursStatus).toBe('ok');
    expect(hook.result.pub?.isOpenNow).toBe(true);
  });

  it('does not refetch hours for the same pub on re-render', async () => {
    (fetchPubHours as jest.Mock).mockResolvedValue(new Map([[PUB.id, result()]]));

    const hook = renderCompassHook();
    await flush();
    expect(fetchPubHours).toHaveBeenCalledTimes(1);

    hook.rerender();
    await flush();

    expect(fetchPubHours).toHaveBeenCalledTimes(1);
  });

  // Regression: a nextChange more than ~24.85 days out (e.g. a seasonal closure)
  // overflows setTimeout's 32-bit delay and fires almost immediately. Without
  // the chunked re-arm guard the expiry timer would tight-loop delete→refetch.
  it('does not loop-refetch when nextChange is far in the future (setTimeout overflow guard)', async () => {
    (fetchPubHours as jest.Mock).mockResolvedValue(
      new Map([[PUB.id, result({ nextChange: '2099-01-01T12:00:00+02:00' })]])
    );

    const hook = renderCompassHook();
    await flush();
    await flush();

    expect(hook.result.pub?.hoursStatus).toBe('ok');
    const callsAfterResolve = (fetchPubHours as jest.Mock).mock.calls.length;
    expect(callsAfterResolve).toBe(1);

    // Advance real time well past the ~1ms an overflowed timer would fire at.
    // With the guard the expiry timer is ~24.85 days out and never fires here.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect((fetchPubHours as jest.Mock).mock.calls.length).toBe(callsAfterResolve);
  });

  // Regression: A→B→A reselection while A's hours lookup is still in flight.
  // The effect cleanup aborts A's request when selection switches to B. If the
  // aborted request leaves A's `{status:'loading'}` placeholder in the map, the
  // cache guard (`hoursByIdRef.current.has(id)`) makes a later reselection of A
  // a no-op, stranding A on 'loading' forever. The fix deletes the in-flight
  // placeholder on abort so a refetch can run when A is reselected.
  it('refetches and resolves hours when reselecting a pub whose first lookup was aborted in flight', async () => {
    // Per-call control: each fetchPubHours invocation gets its own pending
    // promise + resolver, so we can hold A's first request open across the switch.
    const resolvers: Array<(m: Map<string, PubHoursResult>) => void> = [];
    (fetchPubHours as jest.Mock).mockImplementation(
      () =>
        new Promise<Map<string, PubHoursResult>>((resolve) => {
          resolvers.push(resolve);
        })
    );

    // Start on pub A.
    (findNearestPub as jest.Mock).mockReturnValue(PUB);
    const hook = renderCompassHook();
    await flush();

    expect(fetchPubHours).toHaveBeenCalledTimes(1);
    expect((fetchPubHours as jest.Mock).mock.calls[0][0]).toEqual([PUB]);
    // A's lookup is in flight → 'loading'.
    expect(hook.result.pub?.id).toBe(PUB.id);
    expect(hook.result.pub?.hoursStatus).toBe('loading');

    // Switch selection A→B (bumping the seed re-runs the selection effect; the
    // changed findNearestPub return makes B the new target). A's request is
    // aborted by the effect cleanup, which must clear A's 'loading' placeholder.
    (findNearestPub as jest.Mock).mockReturnValue(PUB_B);
    await act(async () => {
      useSettingsStore.getState().bumpSurpriseSeed();
      await Promise.resolve();
    });
    await flush();

    expect(hook.result.pub?.id).toBe(PUB_B.id);
    expect(fetchPubHours).toHaveBeenCalledTimes(2);
    expect((fetchPubHours as jest.Mock).mock.calls[1][0]).toEqual([PUB_B]);

    // Switch back B→A. Because A's stale 'loading' entry was cleared on abort,
    // the cache guard does NOT block a fresh lookup for A.
    (findNearestPub as jest.Mock).mockReturnValue(PUB);
    await act(async () => {
      useSettingsStore.getState().bumpSurpriseSeed();
      await Promise.resolve();
    });
    await flush();

    expect(hook.result.pub?.id).toBe(PUB.id);
    expect(fetchPubHours).toHaveBeenCalledTimes(3);
    expect((fetchPubHours as jest.Mock).mock.calls[2][0]).toEqual([PUB]);

    // Resolve every outstanding fetch. A's reselection (3rd call) must land on
    // 'ok' — not be stranded on 'loading'.
    await act(async () => {
      for (const resolve of resolvers) {
        resolve(new Map([[PUB.id, result()], [PUB_B.id, result()]]));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.pub?.id).toBe(PUB.id);
    expect(hook.result.pub?.hoursStatus).toBe('ok');
    expect(hook.result.pub?.isOpenNow).toBe(true);
  });
});
