import React from 'react';

import { fetchFriendDuel, type Duel } from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { en } from '@/i18n/en';
import { useAccountStore } from '@/stores/accountStore';
import SoubojScreen from '@/friends/SoubojScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRoute = { accountId: 'friend-A' };

jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text',
  View: 'View', RefreshControl: 'RefreshControl',
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockRoute,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 132 }));
jest.mock('@/data/friendsClient', () => ({ fetchFriendDuel: jest.fn() }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: jest.requireActual('zustand').create(() => ({ session: null, profile: null })),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (select: (state: { priceCurrency: string }) => unknown) => select({ priceCurrency: 'CZK' }),
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@/friends/DuelChart', () => ({ DuelChart: 'DuelChart' }));
jest.mock('@/friends/FriendMini', () => ({ friendDisplayName: (p: { displayName: string }) => p.displayName }));
jest.mock('@/friends/OfflineBanner', () => ({ __esModule: true, default: 'OfflineBanner' }));
jest.mock('@/friends/PartaScreenHeader', () => ({ PartaScreenHeader: 'PartaScreenHeader' }));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: 'SkeletonBlock' }));
jest.mock('@/leaderboards/PeriodChips', () => ({ __esModule: true, default: 'PeriodChips' }));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;
let view: ReturnType<typeof TestRenderer.create>;
const fetchDuel = jest.mocked(fetchFriendDuel);

const DUEL: Duel = {
  friend: { id: 'friend-A', displayName: 'Private Friend A', nickname: null, avatarUrl: null, isPublic: true },
  window: '180d', available: true, unavailableReason: null,
  spendAvailable: true, spendBlockedByMe: false,
  me: { beers: 10, evenings: 3, pubs: 2, beersPerEvening: 3.3, spendCzk: 50, pricedBeers: 1 },
  them: { beers: 10, evenings: 2, pubs: 2, beersPerEvening: 5, spendCzk: 500, pricedBeers: 10 },
  series: [],
};

function setAccount(id: string | null) {
  useAccountStore.setState({
    session: id ? { accountId: id, deviceId: 'device', token: 'test', authenticated: true } : null,
    profile: id ? {
      id, deviceId: 'device', displayName: id, nickname: null, avatarUrl: null, isPublic: true,
      email: '', emailVerified: false, providers: [], isAnonymous: false, status: 'active',
    } : null,
  });
}

function deferred() {
  let resolve!: (value: Duel | null) => void;
  const promise = new Promise<Duel | null>((done) => { resolve = done; });
  return { promise, resolve };
}

async function render() {
  await act(async () => { view = TestRenderer.create(<SoubojScreen />); });
}

function text() {
  return view.root.findAllByType('Text').map((node: { props: { children: string } }) => node.props.children).join(' | ');
}

function spendRow() {
  return view.root.findAllByType('View').find((node: { props: { accessibilityLabel?: string } }) =>
    node.props.accessibilityLabel?.startsWith(cs.souboj.rowSpend),
  );
}

beforeEach(() => {
  fetchDuel.mockReset().mockResolvedValue(DUEL);
  mockRoute.accountId = 'friend-A';
  setAccount('owner-A');
});

afterEach(async () => {
  if (view) await act(async () => view.unmount());
});

test('clears the old account before a failed request for the new account', async () => {
  await render();
  expect(text()).toContain('Private Friend A');
  const next = deferred();
  fetchDuel.mockReturnValueOnce(next.promise);
  await act(async () => setAccount('owner-B'));
  expect(text()).not.toContain('Private Friend A');
  expect(fetchDuel).toHaveBeenCalledTimes(2);
  await act(async () => next.resolve(null));
  expect(text()).not.toContain('Private Friend A');
  expect(text()).toContain(cs.souboj.errorTitle);
});

test('ignores an old in-flight response after an account switch', async () => {
  const old = deferred();
  fetchDuel.mockReturnValueOnce(old.promise).mockResolvedValueOnce(null);
  await render();
  await act(async () => setAccount('owner-B'));
  await act(async () => old.resolve(DUEL));
  expect(text()).not.toContain('Private Friend A');
  expect(text()).toContain(cs.souboj.errorTitle);
});

test('clears private data on sign-out without creating an anonymous account', async () => {
  await render();
  await act(async () => setAccount(null));
  expect(text()).not.toContain('Private Friend A');
  expect(fetchDuel).toHaveBeenCalledTimes(1);
});

test('keeps data across a token refresh for the same account', async () => {
  await render();
  await act(async () => useAccountStore.setState({
    session: { ...useAccountStore.getState().session!, token: 'new-token' },
  }));
  expect(text()).toContain('Private Friend A');
  expect(fetchDuel).toHaveBeenCalledTimes(1);
});

test('does not reuse a different friend’s data when the route changes and fetch fails', async () => {
  await render();
  fetchDuel.mockResolvedValueOnce(null);
  mockRoute.accountId = 'friend-B';
  await act(async () => view.update(<SoubojScreen />));
  expect(text()).not.toContain('Private Friend A');
});

test('preserves the same account’s last result when an offline refresh fails', async () => {
  await render();
  fetchDuel.mockResolvedValueOnce(null);
  await act(async () => {
    view.root.findByType('ScrollView').props.refreshControl.props.onRefresh();
  });
  expect(text()).toContain('Private Friend A');
  expect(view.root.findAllByType('OfflineBanner')).toHaveLength(1);
});

test('shows price coverage and no comparison bar for incomplete spend', async () => {
  await render();
  const row = spendRow();
  expect(text()).toContain(cs.souboj.spendCoverage(1, 10, 'Private Friend A', 10, 10));
  expect(row.props.accessibilityLabel).toContain(cs.souboj.spendCoverage(1, 10, 'Private Friend A', 10, 10));
  // Only the value/label row remains; the comparison track and fills are absent.
  expect(row.findAllByType('View')).toHaveLength(2);
});

test('shows missing prices as a dash, including a period with no beers', async () => {
  fetchDuel.mockResolvedValueOnce({
    ...DUEL, me: { ...DUEL.me!, beers: 0, pricedBeers: 0, spendCzk: 0 },
  });
  await render();
  expect(spendRow().props.accessibilityLabel).toContain('ty —');
  expect(spendRow().props.accessibilityLabel).not.toContain('ty 0 Kč');
});

test('compares spend when all beers on both sides have prices', async () => {
  fetchDuel.mockResolvedValueOnce({ ...DUEL, me: { ...DUEL.me!, pricedBeers: 10 } });
  await render();
  expect(text()).not.toContain('cena u');
  expect(spendRow().findAllByType('View')).toHaveLength(5);
});

test('does not display amounts or coverage when spend sharing is off', async () => {
  fetchDuel.mockResolvedValueOnce({ ...DUEL, spendAvailable: false });
  await render();
  expect(spendRow()).toBeUndefined();
  expect(text()).not.toContain('500 Kč');
});

test('describes a single unpriced beer correctly in both languages', () => {
  expect(cs.souboj.spendCoverage(0, 1, 'Pepa', 0, 1)).toBe('Ty: cena u 0 z 1 piva. Pepa: cena u 0 z 1 piva.');
  expect(en.souboj.spendCoverage(0, 1, 'Pepa', 0, 1)).toBe('You: 0 of 1 beer priced. Pepa: 0 of 1 beer priced.');
});
