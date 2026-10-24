import React from 'react';
import { useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';

import { trackScreenViewed } from '@/data/productTelemetry';
import { ProductTelemetryTracker } from '@/navigation/ProductTelemetryTracker';
import { useBookStore, type PageEntry } from '@/stores/bookStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router', () => ({ usePathname: jest.fn(() => '/') }));
jest.mock('@/data/telemetryClient', () => ({ trackClientEvent: jest.fn(async () => undefined) }));
jest.mock('@/data/productTelemetry', () => ({
  ...jest.requireActual('@/data/productTelemetry'),
  trackScreenViewed: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const pub: PageEntry = {
  kind: 'pub',
  params: { key: 'u2fkbnpq', name: 'U Tygra', lat: '50.08', lng: '14.42' },
};
const friend: PageEntry = { kind: 'friend', id: 'acc-1' };

function setWindow(width: number, height: number) {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

let renderer: any;
function show(pathname: string, enabled = true) {
  (usePathname as jest.Mock).mockReturnValue(pathname);
  act(() => {
    if (renderer) renderer.update(<ProductTelemetryTracker enabled={enabled} />);
    else renderer = TestRenderer.create(<ProductTelemetryTracker enabled={enabled} />);
  });
}

const views = () => (trackScreenViewed as jest.Mock).mock.calls;

describe('ProductTelemetryTracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBookStore.setState(useBookStore.getInitialState(), true);
    setWindow(951, 669);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  afterAll(() => setWindow(390, 844));

  it('counts a right-half page like a pushed one, going back included', () => {
    show('/');
    act(() => useBookStore.getState().show('kompas', pub));
    act(() => useBookStore.getState().push('kompas', friend));
    act(() => useBookStore.getState().back('kompas'));
    act(() => useBookStore.getState().back('kompas'));
    expect(views()).toEqual([
      ['compass', undefined],
      ['pub_page', 'compass'],
      ['friend_profile', 'pub_page'],
      ['pub_page', 'friend_profile'],
      ['compass', 'pub_page'],
    ]);
  });

  it('counts nothing when a pushed page moves into the right half', () => {
    show('/');
    show('/pub');
    // PaneRouteMigrator: the page goes into the half, then the stack returns to the tab.
    act(() => useBookStore.getState().setPages('kompas', [pub]));
    show('/');
    expect(views()).toEqual([
      ['compass', undefined],
      ['pub_page', 'compass'],
    ]);
  });

  it('waits for account hydration like the routes do', () => {
    show('/', false);
    act(() => useBookStore.getState().show('kompas', pub));
    expect(views()).toEqual([]);
    show('/', true);
    expect(views()).toEqual([['pub_page', undefined]]);
  });

  it('ignores the pages a folded phone keeps for later', () => {
    act(() => useBookStore.getState().show('kompas', pub));
    setWindow(466, 678);
    show('/');
    expect(views()).toEqual([['compass', undefined]]);
  });
});
