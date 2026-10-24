import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useRootNavigationState, useRouter } from 'expo-router';

import { PaneRouteMigrator } from '@/layout/PaneRouteMigrator';
import { OUTSIDE_TABS, useBookStore } from '@/stores/bookStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useRootNavigationState: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const router = { dismissAll: jest.fn(), replace: jest.fn() };
const evening = { name: 'evening', params: { startedAt: 's1' } };
const tabs = { name: '(tabs)', state: { index: 1, routes: [{ name: 'index' }, { name: 'beer' }] } };

const mounted: { unmount: () => void }[] = [];

function run(width: number, height: number, routes: object[]) {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width, height, scale: 3, fontScale: 1 });
  // The shape Expo Router reports: the app's stack sits inside a single `__root` route.
  (useRootNavigationState as jest.Mock).mockReturnValue({ routes: [{ name: '__root', state: { routes } }] });
  act(() => {
    mounted.push(TestRenderer.create(<PaneRouteMigrator />));
  });
}

describe('PaneRouteMigrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(router);
    useBookStore.setState(useBookStore.getInitialState(), true);
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
  });

  afterAll(() => {
    (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  });

  it('moves an evening opened on the phone into the right half when the phone opens', () => {
    run(951, 669, [tabs, evening]);
    expect(useBookStore.getState().pages.stamgast).toEqual([{ kind: 'evening', startedAt: 's1' }]);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it('replaces a cold-start stack without tabs with the compass tab', () => {
    run(669, 951, [{ name: 'parta/[id]', params: { id: 'acc-1' } }]);
    expect(useBookStore.getState().pages.kompas).toEqual([{ kind: 'friend', id: 'acc-1' }]);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('leaves the stack alone on a phone or under a full-window screen', () => {
    run(466, 678, [tabs, evening]);
    run(951, 669, [tabs, { name: 'leaderboards' }, evening]);
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(useBookStore.getState().pages).toEqual(useBookStore.getInitialState().pages);
  });

  it('leaves a pushed page with an open sheet alone until the sheet closes', () => {
    // Adding a drink on a pushed evening when the phone opens: moving it would remount the form.
    act(() => useBookStore.getState().modalOpened(OUTSIDE_TABS));
    run(951, 669, [tabs, evening]);
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(useBookStore.getState().pages.stamgast).toEqual([]);

    act(() => useBookStore.getState().modalClosed(OUTSIDE_TABS));
    expect(useBookStore.getState().pages.stamgast).toEqual([{ kind: 'evening', startedAt: 's1' }]);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });
});
