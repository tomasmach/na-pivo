import React from 'react';
import { t } from '@/i18n';
import type { TallySession } from '@/stores/tallyStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
// The lean mock lacks the layout-animation builders the new look's motion presets chain at import.
jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});

const mockParams: { current: Record<string, string> } = { current: {} };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/newlook/components/overlays', () => {
  const R = require('react');
  return { Sheet: ({ children, footer }: { children: unknown; footer?: unknown }) => R.createElement(R.Fragment, null, children, footer) };
});
jest.mock('@/data/nightsClient', () => ({
  publishNight: jest.fn(async () => ({ ok: true })),
  isRetriableNightError: () => false,
}));
jest.mock('@/data/nightsQueue', () => ({ enqueueNightOp: jest.fn() }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { publishNight } = require('@/data/nightsClient');
const { useTallyStore } = require('@/stores/tallyStore');
const { useVycepStore } = require('@/stores/vycepStore');
const { VyvesitSheet } = require('@/newlook/screens/vycep/VyvesitFlows');

const copy = t.nv.vycep;

function local(y: number, m: number, d: number, h: number): string {
  return new Date(y, m - 1, d, h).toISOString();
}

function session(clientId: string, at: string[]): TallySession {
  return {
    clientId,
    pubKey: 'u2fkbn12',
    pubName: 'Lokál Dlouhá',
    startedAt: at[0],
    drinks: at.map((when, i) => ({ id: `${clientId}-${i}`, at: when, beerName: 'Pilsner Urquell', priceCzk: 59 })),
  };
}

const older = session('older', [local(2026, 10, 20, 19), local(2026, 10, 20, 20)]);
const newer = session('newer', [local(2026, 10, 24, 19), local(2026, 10, 24, 20), local(2026, 10, 24, 21)]);

function texts(renderer: any): string[] {
  return renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

function pressText(renderer: any, label: string) {
  const node = renderer.root.find(
    (n: any) => typeof n.props.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [c.props.children].flat().join('') === label).length > 0,
  );
  return node.props.onPress();
}

let mounted: any = null;

async function renderSheet(): Promise<any> {
  await act(async () => {
    mounted = TestRenderer.create(React.createElement(VyvesitSheet));
  });
  return mounted;
}

afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
});

beforeEach(() => {
  jest.clearAllMocks();
  useTallyStore.setState({ current: null, history: [newer, older] });
  useVycepStore.setState({ published: {}, nightAutopublish: 'friends', shareDefault: 'friends' });
});

it('hangs up the night the user opened, not the newest one', async () => {
  mockParams.current = { day: '2026-10-20' };
  const renderer = await renderSheet();

  await act(async () => pressText(renderer, copy.publishParta));

  expect(publishNight).toHaveBeenCalledTimes(1);
  expect(publishNight.mock.calls[0][0]).toMatchObject({ clientId: 'night-2026-10-20', drinkingDay: '2026-10-20', beerCount: 2, visibility: 'friends' });
  expect(useVycepStore.getState().published['night-2026-10-20']).toBeDefined();
  expect(useVycepStore.getState().published['night-2026-10-24']).toBeUndefined();
});

it('says a night is already up and does not post it twice', async () => {
  mockParams.current = { day: '2026-10-20' };
  useVycepStore.setState({ published: { 'night-2026-10-20': { clientId: 'night-2026-10-20', visibility: 'public', publishedAt: local(2026, 10, 21, 9) } } });
  const renderer = await renderSheet();

  expect(texts(renderer)).toEqual(expect.arrayContaining([copy.alreadyTitle, copy.alreadyWorld]));
  expect(texts(renderer)).not.toContain(copy.publishParta);
  expect(texts(renderer)).not.toContain(copy.publishWorld);
  expect(publishNight).not.toHaveBeenCalled();
});

it('without a day still offers the newest night not on the Výčep yet', async () => {
  mockParams.current = {};
  useVycepStore.setState({ published: { 'night-2026-10-24': { clientId: 'night-2026-10-24', visibility: 'friends', publishedAt: local(2026, 10, 25, 9) } } });
  const renderer = await renderSheet();

  await act(async () => pressText(renderer, copy.publishParta));

  expect(publishNight.mock.calls[0][0]).toMatchObject({ clientId: 'night-2026-10-20' });
});
