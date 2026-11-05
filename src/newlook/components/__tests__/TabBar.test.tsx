import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { t } from '@/i18n';
import { usePartaSignalStore } from '@/stores/partaSignalStore';

import { TabBar, partaBadge } from '../TabBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/components/chrome', () => {
  const { View } = jest.requireActual('react-native');
  return { Glass: View, tabBarBottom: () => 0 };
});
jest.mock('@/tours/activeRun', () => ({ useActiveTourRun: () => null }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));

const routes = ['kompas', 'vycep', 'stamgast', 'piva', 'parta'].map((name) => ({ key: `${name}-key`, name }));
const props = { state: { index: 0, routes }, navigateToTab: jest.fn() };

function partaTab(renderer: any) {
  return renderer.root.find(
    (n: any) => n.props.accessibilityRole === 'tab' && n.props.onPress && String(n.props.accessibilityLabel).startsWith(t.nv.common.tabParta),
  );
}

function badgeText(renderer: any): string | null {
  const found = renderer.root.findAll((n: any) => n.props.testID === 'tab-parta-badge');
  if (!found.length) return null;
  return found[0]
    .findAll((n: any) => n.type === 'Text')
    .map((n: any) => [n.props.children].flat().join(''))
    .join('');
}

const dots = (renderer: any) => renderer.root.findAll((n: any) => n.props.testID === 'tab-parta-dot' && typeof n.type === 'string');

describe('partaBadge', () => {
  it.each([
    [0, 0, false, null],
    [0, 2, false, ''],
    [0, 0, true, ''],
    [3, 0, true, '3'],
    [9, 0, false, '9'],
    [12, 0, false, '9+'],
  ])('requests %i, unread %i, live %s gives %p', (pending, unread, live, expected) => {
    expect(partaBadge(pending, unread, live)).toBe(expected);
  });
});

describe('TabBar Parta badge', () => {
  afterEach(() => {
    act(() => usePartaSignalStore.getState().setSignal({ pendingRequests: 0, unread: 0, liveNow: false }));
  });

  it('shows waiting requests on the tab and in its label, and drops them once handled', () => {
    act(() => usePartaSignalStore.getState().setSignal({ pendingRequests: 2, unread: 0, liveNow: true }));
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<TabBar {...(props as any)} />);
    });
    expect(badgeText(renderer)).toBe('2');
    expect(partaTab(renderer).props.accessibilityLabel).toBe(t.nv.parta.tabBadgeA11y(2));

    act(() => usePartaSignalStore.getState().setSignal({ pendingRequests: 0, unread: 0, liveNow: true }));
    expect(badgeText(renderer)).toBeNull();
    expect(dots(renderer)).toHaveLength(1);
    expect(partaTab(renderer).props.accessibilityLabel).toBe(t.nv.common.tabParta);

    act(() => usePartaSignalStore.getState().setSignal({ pendingRequests: 0, unread: 0, liveNow: false }));
    expect(dots(renderer)).toHaveLength(0);
  });
});
