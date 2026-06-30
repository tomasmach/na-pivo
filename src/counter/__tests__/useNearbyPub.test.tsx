import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useDevicePosition } from '@/compass/useDevicePosition';
import { geohash8 } from '@/data/geohash';
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

function renderNearbyHook() {
  let latestResult: ReturnType<typeof useNearbyPub> | undefined;
  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };

  function Harness() {
    latestResult = useNearbyPub();
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
  currentPosition = null;
  currentNearby = [];
  useTallyStore.setState({ current: null, history: [] });
  (useDevicePosition as jest.Mock).mockImplementation((enabled: boolean) => ({
    position: enabled ? currentPosition : null,
  }));
  (findNearbyPubs as jest.Mock).mockImplementation(() => currentNearby);
});

describe('useNearbyPub', () => {
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

  it('fetches candidates around the current GPS position', async () => {
    setNearby(PUB_A);
    const hook = renderNearbyHook();

    await waitForExpectation(() => expect(fetchPubsNear).toHaveBeenCalled());
    expect(fetchPubsNear).toHaveBeenCalledWith(PUB_A.lat, PUB_A.lng, undefined, { radiusKm: 3 });
    hook.unmount();
  });
});
