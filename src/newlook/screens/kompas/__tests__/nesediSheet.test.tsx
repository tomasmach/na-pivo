import React from 'react';
import { t } from '@/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/newlook/components/overlays', () => {
  const R = require('react');
  return { Sheet: ({ children }: { children: unknown }) => R.createElement(R.Fragment, null, children) };
});
const mockParamPub = jest.fn();
jest.mock('@/newlook/screens/kompas/usePubPage', () => ({ useParamPub: () => mockParamPub() }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { NesediSheet } = require('@/newlook/screens/kompas/ReportSheets');

function offersNotPub(pub: object): boolean {
  mockParamPub.mockReturnValue({ key: 'u2fkbnhu', pub });
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(React.createElement(NesediSheet));
  });
  const label = t.nv.kompas.reportNotPub;
  return renderer.root.findAll((n: any) => n.type === 'Text' && [n.props.children].flat().join('') === label).length > 0;
}

describe('NesediSheet not-a-pub report', () => {
  const place = { name: 'U Lípy', lat: 50.087, lng: 14.4208 };

  it('offers it for a catalogue pub', () => {
    expect(offersNotPub({ ...place, id: 'local:1' })).toBe(true);
  });

  it('hides it for a restaurant that pours beer', () => {
    expect(offersNotPub({ ...place, id: 'local:1', placeKind: 'restaurant' })).toBe(false);
  });

  it('hides it for a place from a bare link the catalogue has not classified', () => {
    expect(offersNotPub({ ...place, id: '' })).toBe(false);
  });
});
