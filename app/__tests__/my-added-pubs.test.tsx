import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { RefreshControl, ScrollView, Text } from 'react-native';
import type { AddedPubSubmission } from '@/data/addedPubsQueue';
import { MoreSheet } from '@/components/shared/MoreSheet';
import { t } from '@/i18n';
import MyAddedPubsScreen from '../my-added-pubs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockPush = jest.fn();
const mockBump = jest.fn();
const mockLoad = jest.fn();
const mockSync = jest.fn();
const mockRetry = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/components/shared/MoreSheet', () => ({ MoreSheet: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null, ChevronRightIcon: () => null, PencilIcon: () => null, RefreshCwIcon: () => null,
}));
jest.mock('@/data/addedPubsQueue', () => ({
  loadAddedPubSubmissions: () => mockLoad(), syncOwnAddedPubs: () => mockSync(), retryAddedPub: (id: string) => mockRetry(id),
}));
jest.mock('@/stores/pubStore', () => ({ usePubStore: (selector: (s: unknown) => unknown) => selector({ bumpCatalogRevision: mockBump }) }));

const pub = (id: string, state: AddedPubSubmission['syncState'], minute: number): AddedPubSubmission => ({
  client_id: id, name: id, address: 'Dlouhá ulice 17', city: 'Brno', lat: 49.2, lng: 16.6,
  syncState: state, pendingOperation: state === 'synced' ? null : 'create', updatedAt: `2026-09-22T12:0${minute}:00Z`,
});
let renderer: TestRenderer.ReactTestRenderer;
const row = (name: string) => renderer.root.findAll((node) =>
  node.props.accessibilityRole === 'button' && String(node.props.accessibilityLabel).includes(name)
)[0];
const text = () => renderer.root.findAllByType(Text).map((node) => node.props.children).filter((value) => typeof value === 'string');
async function mount() { await act(async () => { renderer = TestRenderer.create(<MyAddedPubsScreen />); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  mockSync.mockResolvedValue(true); mockLoad.mockResolvedValue([]); mockRetry.mockResolvedValue('synced');
});
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });

it('keeps chronology and opens an unresolved location with its saved identity and address', async () => {
  mockLoad.mockResolvedValue([
    { ...pub('U Lípy', 'failed', 2), failureReason: 'location-not-found' },
    { ...pub('U Orla', 'pending', 1), pendingOperation: 'edit' },
    pub('Na Růžku', 'synced', 3),
  ]);
  await mount();
  const names = text().filter((value) => ['Na Růžku', 'U Lípy', 'U Orla'].includes(value));
  expect(names).toEqual(['Na Růžku', 'U Lípy', 'U Orla']);
  expect(text()).toContain(t.addPub.statusPendingEdit);
  expect(text()).not.toContain(t.addPub.statusSynced);
  act(() => row('U Lípy').props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/add-pub', params: {
    clientId: 'U Lípy', name: 'U Lípy', address: 'Dlouhá ulice 17', city: 'Brno', lat: '49.2', lng: '16.6', needsLocation: '1',
  } });
});

it('keeps per-pub retry in the sheet and refreshes the resulting state', async () => {
  mockLoad.mockResolvedValue([pub('U Mostu', 'failed', 1)]);
  await mount();
  act(() => row('U Mostu').props.onPress());
  const sheet = renderer.root.findByType(MoreSheet);
  expect(sheet.props.rows.map((value: { key: string }) => value.key)).toEqual(['edit', 'retry']);
  mockLoad.mockResolvedValue([pub('U Mostu', 'synced', 2)]);
  act(() => sheet.props.rows[1].onPress());
  await act(async () => { await jest.advanceTimersByTimeAsync(260); });
  expect(mockRetry).toHaveBeenCalledWith('U Mostu');
  expect(mockBump).toHaveBeenCalled();
  expect(text()).not.toContain(t.addPub.retry);
});

it('keeps local rows on a failed refresh and exposes a retry without claiming an empty list', async () => {
  mockSync.mockResolvedValue(false);
  mockLoad.mockResolvedValue([pub('Offline hospoda', 'pending', 1)]);
  await mount();
  expect(text()).toContain('Offline hospoda');
  expect(text()).toContain(t.addPub.statusPendingCreate);
  expect(text()).toContain(t.addPub.loadFailed);
  expect(text()).not.toContain(t.addPub.emptyTitle);
  const control = renderer.root.findByType(ScrollView).props.refreshControl;
  expect(control.type).toBe(RefreshControl);
  mockSync.mockResolvedValue(true);
  await act(async () => { await control.props.onRefresh(); });
  expect(text()).not.toContain(t.addPub.loadFailed);
});

it('shows one add action and a plain empty state', async () => {
  await mount();
  expect(text()).toContain(t.addPub.emptyTitle);
  expect(text()).not.toContain(t.addPub.emptyBody);
  const add = row(t.addPub.addCta);
  act(() => { add.props.onPress(); add.props.onPress(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/add-pub');
});


it.each([true, false])('does not claim an empty list while the first remote load is pending (cached=%s)', async (cached) => {
  let finish!: (result: boolean) => void;
  mockSync.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
  mockLoad.mockResolvedValue(cached ? [pub('Uložená hospoda', 'pending', 1)] : []);
  await mount();
  expect(text()).not.toContain(t.addPub.emptyTitle);
  expect(text()).toContain(cached ? 'Uložená hospoda' : t.addPub.loading);
  await act(async () => { finish(false); });
  expect(text()).toContain(t.addPub.loadFailed);
  expect(text()).not.toContain(t.addPub.emptyTitle);
});
