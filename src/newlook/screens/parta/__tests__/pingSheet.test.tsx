import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { shareFriendPubActivity, updateFriendSettings } from '@/data/friendsClient';
import { enqueueFriendOp } from '@/data/friendsQueue';
import { t } from '@/i18n';
import { toast } from '@/newlook/ui/store';

import { PingSheet } from '../PingSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
let mockParams: { friend?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/components/overlays', () => ({
  Sheet: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/newlook/ui/store', () => ({ toast: jest.fn() }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/data/account', () => ({ generateUuidV4: () => 'client-1' }));
jest.mock('@/data/pubSearchClient', () => ({ searchPubNames: jest.fn(), resolvePubSearchResult: jest.fn() }));
jest.mock('@/data/friendsClient', () => ({ shareFriendPubActivity: jest.fn(), updateFriendSettings: jest.fn() }));
jest.mock('@/data/friendsQueue', () => ({
  enqueueFriendOp: jest.fn(async () => undefined),
  isRetriableFriendError: (result: { code: string }) => result.code === 'network',
}));

const pinkasy = { id: 'osm-1', name: 'U Pinkasů', lat: 50.08, lng: 14.42, city: 'Praha' };
const friends = [
  { id: 'kuba', nickname: 'kuba', displayName: 'Kuba', avatarUrl: null },
  { id: 'bara', nickname: 'bara', displayName: 'Bára', avatarUrl: null },
];
let mockParty: { friends: typeof friends; ghost: boolean } | null | undefined = { friends, ghost: false };
let mockPlace: { kind: 'pub'; pub: typeof pinkasy } | null = { kind: 'pub', pub: pinkasy };
jest.mock('../../tour/TourRunScreens', () => ({ useParty: () => mockParty, CheckRow: () => null }));
jest.mock('../NovaPozvanka', () => ({ PickerRow: () => null }));
jest.mock('../../stamgast/placeStore', () => ({
  currentCountPlace: () => mockPlace,
  useNvPlaceStore: (select: (st: { candidates: never[] }) => unknown) => select({ candidates: [] }),
}));
let mockStoreGhost: boolean | undefined;
jest.mock('../partaStore', () => {
  const state = () => ({
    dashboard: mockStoreGhost === undefined ? null : { settings: { ghostMode: mockStoreGhost } },
    reload: jest.fn(async () => undefined),
    setDashboard: jest.fn(),
  });
  return { usePartaStore: Object.assign((select: (st: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }) };
});

const share = shareFriendPubActivity as jest.Mock;

async function sendFrom(label: string) {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PingSheet />);
  });
  const button = tree.root.find((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function');
  await act(async () => {
    button.props.onPress();
  });
  return button;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParty = { friends, ghost: false };
  mockPlace = { kind: 'pub', pub: pinkasy };
  mockStoreGhost = undefined;
  mockParams = {};
});

test('pings the whole party from the pub the counter counts in', async () => {
  share.mockResolvedValue({ ok: true });
  await sendFrom(t.nv.parta.pingPartyShort);
  expect(share).toHaveBeenCalledWith(pinkasy, '', 'client-1', undefined, expect.any(String), undefined, false);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: t.nv.parta.pingedToast, sub: t.nv.parta.pingSentSub('U Pinkasů') }));
});

test('without signal the ping waits in the queue under the same client id', async () => {
  share.mockResolvedValue({ ok: false, code: 'network', detail: 'offline' });
  await sendFrom(t.nv.parta.pingPartyShort);
  expect(enqueueFriendOp).toHaveBeenCalledWith({
    op: 'activity',
    clientId: 'client-1',
    payload: { pub: pinkasy, message: '', recipientIds: undefined, startedAt: expect.any(String) },
  });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: t.nv.parta.pingQueued }));
});

test('invisible mode turns off before the ping goes out', async () => {
  mockParty = { friends, ghost: true };
  (updateFriendSettings as jest.Mock).mockResolvedValue({ ok: true });
  share.mockResolvedValue({ ok: true });
  await sendFrom(t.nv.parta.pingGhostSend);
  expect(updateFriendSettings).toHaveBeenCalledWith({ ghostMode: false });
  expect(share).toHaveBeenCalled();
});

test('a failed switch out of invisible mode sends nothing', async () => {
  mockParty = { friends, ghost: true };
  (updateFriendSettings as jest.Mock).mockResolvedValue({ ok: false, code: 'network', detail: 'offline' });
  await sendFrom(t.nv.parta.pingGhostSend);
  expect(share).not.toHaveBeenCalled();
  expect(enqueueFriendOp).not.toHaveBeenCalled();
});

test('without a pub there is nothing to send', async () => {
  mockPlace = null;
  const button = await sendFrom(t.nv.parta.pingPartyShort);
  expect(share).not.toHaveBeenCalled();
  expect(button.props.disabled).toBe(true);
});

test('invisible mode switched on in Profil counts even when the saved party is older', async () => {
  mockStoreGhost = true;
  (updateFriendSettings as jest.Mock).mockResolvedValue({ ok: false, code: 'network', detail: 'offline' });
  await sendFrom(t.nv.parta.pingGhostSend);
  expect(updateFriendSettings).toHaveBeenCalledWith({ ghostMode: false });
  expect(share).not.toHaveBeenCalled();
  expect(enqueueFriendOp).not.toHaveBeenCalled();
});

test('a ping to one kámoš joins my live ping and goes only to them', async () => {
  mockParams = { friend: 'bara' };
  share.mockResolvedValue({ ok: true, notified: 1 });
  await sendFrom(t.nv.parta.pingPartyShort);
  expect(share).toHaveBeenCalledWith(pinkasy, '', 'client-1', ['bara'], expect.any(String), undefined, true);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: t.nv.parta.pingedToast, sub: t.nv.parta.pingSentSub('U Pinkasů', 'Bára') }));
});

test('a kámoš who already has my ping hears nothing new and I am told so', async () => {
  mockParams = { friend: 'bara' };
  share.mockResolvedValue({ ok: true, notified: 0 });
  await sendFrom(t.nv.parta.pingPartyShort);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: t.nv.parta.pingAlreadyKnown('Bára') }));
});

test('a queued ping to one kámoš keeps the join flag for the retry', async () => {
  mockParams = { friend: 'bara' };
  share.mockResolvedValue({ ok: false, code: 'network', detail: 'offline' });
  await sendFrom(t.nv.parta.pingPartyShort);
  expect(enqueueFriendOp).toHaveBeenCalledWith({
    op: 'activity',
    clientId: 'client-1',
    payload: { pub: pinkasy, message: '', recipientIds: ['bara'], startedAt: expect.any(String), addRecipients: true },
  });
});
