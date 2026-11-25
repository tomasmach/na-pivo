import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { Pub } from '@/data/pubs';
import { useTallyStore } from '@/stores/tallyStore';

const focusCallbacks: (() => void)[] = [];
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    focusCallbacks.push(cb);
  },
}));
const release = jest.fn();
jest.mock('@/counter/useNearbyPub', () => ({
  useNearbyPub: () => ({
    candidates: [],
    selected: null,
    selectPub: jest.fn(),
    permissionState: 'granted',
    requestPermission: jest.fn(),
    loading: false,
    retry: jest.fn(),
    setPicking: jest.fn(),
    release,
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/counter/countDrink', () => ({ liveOutsideContext: jest.fn(() => 'private') }));

import { useCountPlaceHost, useNvPlaceStore } from '../placeStore';

const PUB: Pub = { id: 'osm:a', name: 'Hospoda A', lat: 50.0876, lng: 14.4214 };
const EVENING = {
  clientId: 'session-a',
  pubKey: 'u2fkbnhu',
  pubName: PUB.name,
  startedAt: '2026-06-30T19:00:00.000Z',
  drinks: [{ id: 'drink-1', beerName: 'Plzeň', priceCzk: 62, at: '2026-06-30T19:05:00.000Z' }],
};

function Host() {
  useCountPlaceHost();
  return null;
}

const mounted: TestRenderer.ReactTestRenderer[] = [];
function mountHost() {
  act(() => {
    mounted.push(TestRenderer.create(<Host />));
  });
}

describe('place of the running evening', () => {
  beforeEach(() => {
    focusCallbacks.length = 0;
    release.mockClear();
    useNvPlaceStore.setState({ outside: null, picked: null });
    useTallyStore.setState({ current: null, history: [] });
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
  });

  it('comes back on focus when nothing was picked', () => {
    mountHost();
    act(() => focusCallbacks.at(-1)?.());
    expect(useNvPlaceStore.getState().outside).toBe('private');
  });

  it('does not overwrite outdoors picked during an evening at home', () => {
    mountHost();
    act(() => useNvPlaceStore.getState().setOutside('outdoors'));
    act(() => focusCallbacks.at(-1)?.());
    expect(useNvPlaceStore.getState().outside).toBe('outdoors');
  });

  it('forgets the pub when the evening ends, so the next pub is detected', () => {
    useTallyStore.setState({ current: EVENING, history: [] });
    mountHost();
    act(() => useNvPlaceStore.getState().pickPub(PUB));

    act(() => {
      useTallyStore.getState().undoLast();
    });
    expect(useNvPlaceStore.getState().picked).toBe(PUB);
    expect(release).not.toHaveBeenCalled();

    act(() => {
      useTallyStore.setState({ current: EVENING });
      useTallyStore.getState().archiveCurrent('manual');
    });
    expect(useNvPlaceStore.getState().picked).toBeNull();
    expect(useNvPlaceStore.getState().outside).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
