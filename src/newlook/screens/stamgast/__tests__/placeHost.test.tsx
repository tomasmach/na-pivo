import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const focusCallbacks: (() => void)[] = [];
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    focusCallbacks.push(cb);
  },
}));
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
  }),
}));
jest.mock('@/counter/countDrink', () => ({ liveOutsideContext: jest.fn(() => 'private') }));

import { useCountPlaceHost, useNvPlaceStore } from '../placeStore';

function Host() {
  useCountPlaceHost();
  return null;
}

describe('place of the running evening', () => {
  beforeEach(() => {
    focusCallbacks.length = 0;
    useNvPlaceStore.setState({ outside: null, picked: null });
  });

  it('comes back on focus when nothing was picked', () => {
    act(() => {
      TestRenderer.create(<Host />);
    });
    act(() => focusCallbacks.at(-1)?.());
    expect(useNvPlaceStore.getState().outside).toBe('private');
  });

  it('does not overwrite outdoors picked during an evening at home', () => {
    act(() => {
      TestRenderer.create(<Host />);
    });
    act(() => useNvPlaceStore.getState().setOutside('outdoors'));
    act(() => focusCallbacks.at(-1)?.());
    expect(useNvPlaceStore.getState().outside).toBe('outdoors');
  });
});
