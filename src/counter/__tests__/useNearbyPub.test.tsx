import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { useDevicePosition } from '@/compass/useDevicePosition';
import { checkLocationPermission } from '@/compass/permissions';
import { decodeGeohash8, geohash8 } from '@/data/geohash';
import { fetchPubsNear, findNearbyPubs, type Pub } from '@/data/pubs';
import { useTallyStore } from '@/stores/tallyStore';
import { useNearbyPub } from '../useNearbyPub';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactActual.useEffect(() => cb(), [cb]);
    },
  };
});

jest.mock('@/compass/permissions', () => ({
  checkLocationPermission: jest.fn(async () => 'granted'),
  ensureLocationPermission: jest.fn(async () => 'granted'),
  openSystemSettings: jest.fn(async () => undefined),
}));

jest.mock('@/compass/useDevicePosition', () => ({
  useDevicePosition: jest.fn(),
}));

jest.mock('@/data/pubs', () => ({
  fetchPubsNear: jest.fn(async () => undefined),
  findNearbyPubs: jest.fn(),
}));

jest.mock('@/data/walkingTelemetry', () => ({
  recordWalkingSample: jest.fn(),
}));

const PUB_A: Pub = { id: 'osm:a', name: 'Hospoda A', lat: 50.0876, lng: 14.4214 };
const PUB_B: Pub = { id: 'osm:b', name: 'Hospoda B', lat: 50.0886, lng: 14.4224 };
const PUB_C: Pub = { id: 'osm:c', name: 'Hospoda C', lat: 50.0896, lng: 14.4234 };

type Position = { lat: number; lng: number; accuracyMeters: number };
type NearbyResult = { pub: Pub; distanceMeters: number };

let currentPosition: Position | null = null;
let currentNearby: NearbyResult[] = [];
let appStateHandler: ((state: string) => void) | null = null;

function renderNearbyHook(options: Parameters<typeof useNearbyPub>[0] = {}) {
  let latestResult: ReturnType<typeof useNearbyPub> | undefined;
  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };

  function Harness() {
    latestResult = useNearbyPub(options);
    return null;
  }

  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness));
  });

  return {
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
}

async function waitForExpectation(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
  throw lastError;
}

function setNearby(pub: Pub, distanceMeters = 20): void {
  currentPosition = { lat: pub.lat, lng: pub.lng, accuracyMeters: 8 };
  currentNearby = [{ pub, distanceMeters }];
}

beforeEach(() => {
  jest.clearAllMocks();
  appStateHandler = null;
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, handler) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  });
  (checkLocationPermission as jest.Mock).mockResolvedValue('granted');
  currentPosition = null;
  currentNearby = [];
  useTallyStore.setState({ current: null, history: [] });
  (useDevicePosition as jest.Mock).mockImplementation((enabled: boolean) => ({
    position: enabled ? currentPosition : null,
  }));
  (findNearbyPubs as jest.Mock).mockImplementation(() => currentNearby);
});

describe('useNearbyPub', () => {
  it('pauses GPS once a pub is pinned and resumes it on retry', async () => {
    setNearby(PUB_A);
    const hook = renderNearbyHook({ pauseWhenPinned: true });
    await waitForExpectation(() => expect(hook.result.selected?.id).toBe(PUB_A.id));

    const lastCall = () => (useDevicePosition as jest.Mock).mock.calls.at(-1);
    expect(lastCall()).toEqual([true, 'counter']);

    act(() => {
      hook.result.selectPub(PUB_A);
    });
    expect(lastCall()).toEqual([false, 'counter']);

    act(() => {
      hook.result.retry();
    });
    expect(lastCall()).toEqual([true, 'counter']);
    hook.unmount();
  });

  it('keeps GPS live while the picker is open so distances stay current', async () => {
    setNearby(PUB_A);
    const hook = renderNearbyHook({ pauseWhenPinned: true });
    await waitForExpectation(() => expect(hook.result.selected?.id).toBe(PUB_A.id));
    const lastCall = () => (useDevicePosition as jest.Mock).mock.calls.at(-1);

    act(() => {
      hook.result.selectPub(PUB_A);
    });
    expect(lastCall()).toEqual([false, 'counter']);

    act(() => {
      hook.result.setPicking(true);
    });
    expect(lastCall()).toEqual([true, 'counter']);

    // Walking to another pub with the picker open refreshes its list and does
    // not pause GPS behind the user's back.
    setNearby(PUB_B, 15);
    hook.rerender();
    await waitForExpectation(() => expect(hook.result.candidates[0]?.pub.id).toBe(PUB_B.id));
    expect(lastCall()).toEqual([true, 'counter']);

    act(() => {
      hook.result.setPicking(false);
    });
    expect(lastCall()).toEqual([false, 'counter']);
    hook.unmount();
  });

  it('waits for a fresh fix after a retry before pausing GPS again', async () => {
    // The real watcher keeps its last fix while paused; the retry must not pin
    // the evening pub from that old fix and switch GPS straight back off.
    (useDevicePosition as jest.Mock).mockImplementation(() => ({ position: currentPosition }));
    useTallyStore.setState({
      current: {
        clientId: 'session-a',
        pubKey: geohash8(PUB_A.lat, PUB_A.lng),
        pubName: PUB_A.name,
        startedAt: '2026-06-30T19:00:00.000Z',
        drinks: [{ id: 'drink-1', beerName: 'Plzeň', priceCzk: 62, at: '2026-06-30T19:05:00.000Z' }],
      },
      history: [],
    });
    setNearby(PUB_A);
    const hook = renderNearbyHook({ pauseWhenPinned: true });
    const lastCall = () => (useDevicePosition as jest.Mock).mock.calls.at(-1);
    await waitForExpectation(() => expect(lastCall()).toEqual([false, 'counter']));

    act(() => {
      hook.result.retry();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastCall()).toEqual([true, 'counter']);

    setNearby(PUB_A, 10);
    hook.rerender();
    await waitForExpectation(() => expect(lastCall()).toEqual([false, 'counter']));
    hook.unmount();
  });

  it('keeps GPS live for callers that do not opt into pausing', async () => {
    setNearby(PUB_A);
    const hook = renderNearbyHook();
    await waitForExpectation(() => expect(hook.result.selected?.id).toBe(PUB_A.id));

    act(() => {
      hook.result.selectPub(PUB_A);
    });
    expect((useDevicePosition as jest.Mock).mock.calls.at(-1)).toEqual([true, 'counter']);
    hook.unmount();
  });

  it('pauses on a fresh fix with unchanged coordinates without re-ranking', async () => {
    (useDevicePosition as jest.Mock).mockImplementation(() => ({ position: currentPosition }));
    setNearby(PUB_A);
    const hook = renderNearbyHook({ pauseWhenPinned: true });
    await waitForExpectation(() => expect(hook.result.selected?.id).toBe(PUB_A.id));
    act(() => {
      hook.result.selectPub(PUB_A);
    });
    const lastCall = () => (useDevicePosition as jest.Mock).mock.calls.at(-1);
    expect(lastCall()).toEqual([false, 'counter']);

    // Unlock resumes GPS on the retained fix; the first live sample at the same
    // spot pauses it again and does not search for pubs again.
    await act(async () => {
      appStateHandler?.('active');
      await Promise.resolve();
    });
    expect(lastCall()).toEqual([true, 'counter']);
    const searches = (findNearbyPubs as jest.Mock).mock.calls.length;

    currentPosition = { ...currentPosition! };
    hook.rerender();
    await waitForExpectation(() => expect(lastCall()).toEqual([false, 'counter']));
    expect((findNearbyPubs as jest.Mock).mock.calls.length).toBe(searches);
    hook.unmount();
  });

  it('refreshes location permission after returning from system settings', async () => {
    (checkLocationPermission as jest.Mock)
      .mockResolvedValueOnce('denied')
      .mockResolvedValueOnce('granted');
    const hook = renderNearbyHook();

    await waitForExpectation(() => expect(hook.result.permissionState).toBe('denied'));

    await act(async () => {
      appStateHandler?.('active');
      await Promise.resolve();
    });

    expect(hook.result.permissionState).toBe('granted');
    expect(checkLocationPermission).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('does not make auto-detection sticky before a session, then pins the active evening pub', async () => {
    setNearby(PUB_A);
    const hook = renderNearbyHook();

    await waitForExpectation(() => expect(hook.result.selected?.id).toBe(PUB_A.id));

    setNearby(PUB_B);
    hook.rerender();
    await waitForExpectation(() => expect(hook.result.selected?.id).toBe(PUB_B.id));

    act(() => {
      useTallyStore.setState({
        current: {
          clientId: 'session-b',
          pubKey: geohash8(PUB_B.lat, PUB_B.lng),
          pubName: PUB_B.name,
          startedAt: '2026-06-30T19:00:00.000Z',
          drinks: [{ id: 'drink-1', beerName: 'Plzeň', priceCzk: 62, at: '2026-06-30T19:05:00.000Z' }],
        },
        history: [],
      });
    });

    setNearby(PUB_C);
    hook.rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.selected?.id).toBe(PUB_B.id);
    hook.unmount();
  });

  it('reflects the active session pub even when it is absent from nearby candidates', async () => {
    // An evening is already under way at PUB_C (e.g. resumed / hydrated on
    // launch), but the user's GPS now only sees PUB_A nearby — the session pub
    // is NOT among the candidates. The counter must still show the session pub,
    // not the stale nearby neighbour.
    act(() => {
      useTallyStore.setState({
        current: {
          clientId: 'session-c',
          pubKey: geohash8(PUB_C.lat, PUB_C.lng),
          pubName: PUB_C.name,
          startedAt: '2026-06-30T19:00:00.000Z',
          drinks: [{ id: 'drink-1', beerName: 'Plzeň', priceCzk: 62, at: '2026-06-30T19:05:00.000Z' }],
        },
        history: [],
      });
    });

    setNearby(PUB_A);
    const hook = renderNearbyHook();

    await waitForExpectation(() => {
      const selected = hook.result.selected;
      expect(selected).not.toBeNull();
      // Same geohash cell as the session pub → counting stays on the right pub.
      expect(geohash8(selected!.lat, selected!.lng)).toBe(geohash8(PUB_C.lat, PUB_C.lng));
      expect(selected?.name).toBe(PUB_C.name);
    });
    // Crucially, it is NOT the stale nearby pub.
    expect(hook.result.selected?.id).not.toBe(PUB_A.id);
    hook.unmount();
  });

  it('keeps a manual selection sticky while moving without an active session', async () => {
    setNearby(PUB_A);
    const hook = renderNearbyHook();
    await waitForExpectation(() => expect(hook.result.selected?.id).toBe(PUB_A.id));

    act(() => {
      hook.result.selectPub(PUB_A);
    });

    setNearby(PUB_B);
    hook.rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.selected?.id).toBe(PUB_A.id);
    hook.unmount();
  });

  it('dedupes candidates that share a geohash cell, keeping the nearest', async () => {
    // Two distinct venues inside the same geohash-8 cell (~38×19 m — common in
    // a city block). The cell IS the durable pub identity, so surfacing both
    // yields duplicate pubKeys (and duplicate React keys downstream).
    const cellCentre = decodeGeohash8(geohash8(PUB_A.lat, PUB_A.lng));
    const twin: Pub = { id: 'osm:a-twin', name: 'Hospoda A Twin', lat: cellCentre.lat, lng: cellCentre.lng };
    expect(geohash8(twin.lat, twin.lng)).toBe(geohash8(PUB_A.lat, PUB_A.lng));

    currentPosition = { lat: PUB_A.lat, lng: PUB_A.lng, accuracyMeters: 8 };
    currentNearby = [
      { pub: PUB_A, distanceMeters: 20 },
      { pub: twin, distanceMeters: 25 },
      { pub: PUB_B, distanceMeters: 140 },
    ];
    const hook = renderNearbyHook();

    await waitForExpectation(() => expect(hook.result.candidates.length).toBe(2));
    const keys = hook.result.candidates.map((c) => c.pubKey);
    expect(new Set(keys).size).toBe(keys.length);
    // The nearest venue in the shared cell wins.
    expect(hook.result.candidates[0].pub.id).toBe(PUB_A.id);
    expect(hook.result.candidates[1].pub.id).toBe(PUB_B.id);
    hook.unmount();
  });

  it('fetches candidates around the current GPS position', async () => {
    setNearby(PUB_A);
    const hook = renderNearbyHook();

    await waitForExpectation(() => expect(fetchPubsNear).toHaveBeenCalled());
    expect(fetchPubsNear).toHaveBeenCalledWith(PUB_A.lat, PUB_A.lng, undefined, { force: false, radiusKm: 3 });
    hook.unmount();
  });
});
