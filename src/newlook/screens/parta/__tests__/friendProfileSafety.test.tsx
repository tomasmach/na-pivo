import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { reportProfileContent } from '@/data/auth';
import { blockFriend, fetchFriendProfile, type FriendProfileDetail } from '@/data/friendsClient';
import { t } from '@/i18n';
import { dialog, toast } from '@/newlook/ui/store';
import { useAccountStore } from '@/stores/accountStore';

import { KamosScreen } from '../PartaFlows';

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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'marek' }),
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-calendar/legacy', () => ({}));
jest.mock('../PartaPhotos', () => ({ FriendPhotosSection: () => null, PartaPhotoStrip: () => null }));
jest.mock('../../stamgast/placeStore', () => ({ useNvPlaceStore: { getState: () => ({ setOutside: jest.fn() }) } }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/auth', () => ({ ...jest.requireActual('@/data/auth'), reportProfileContent: jest.fn() }));
jest.mock('@/data/friendsClient', () => ({
  ...jest.requireActual('@/data/friendsClient'),
  fetchFriendProfile: jest.fn(),
  blockFriend: jest.fn(),
}));
jest.mock('@/data/partaPlansClient', () => ({
  ...jest.requireActual('@/data/partaPlansClient'),
  fetchFriendDuel: jest.fn(async () => null),
}));

function detail(id: string): FriendProfileDetail {
  return {
    profile: { id, nickname: 'marek', displayName: 'Marek', avatarUrl: null, isPublic: true },
    isFriend: true,
    friendshipId: 'f1',
    recentTogether: [],
    publicStats: null,
    badgeProgress: null,
  } as unknown as FriendProfileDetail;
}

function texts(root: any): string[] {
  return root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

function rowWith(renderer: any, label: string) {
  return renderer.root.find((n: any) => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button' && texts(n).includes(label));
}

async function renderProfile(id: string) {
  (fetchFriendProfile as jest.Mock).mockResolvedValue(detail(id));
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(<KamosScreen />);
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAccountStore.setState({ profile: { id: 'me' } as never });
});

describe('a person’s profile', () => {
  it('reports the person with the payload 2.3.0 sent', async () => {
    (reportProfileContent as jest.Mock).mockResolvedValue({ ok: true });
    const renderer = await renderProfile('marek');
    act(() => rowWith(renderer, t.nv.parta.report).props.onPress());

    const asked = (dialog as jest.Mock).mock.calls[0][0];
    expect(asked.title).toBe(t.nv.parta.reportPersonTitle('@marek'));
    expect(reportProfileContent).not.toHaveBeenCalled();
    await act(async () => asked.actions[1].onPress());

    expect(reportProfileContent).toHaveBeenCalledWith({ targetAccountId: 'marek', reason: 'other', comment: '@marek' });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'saved', title: t.nv.parta.reported }));
  });

  it('says so when the report did not go through', async () => {
    (reportProfileContent as jest.Mock).mockResolvedValue({ ok: false, detail: 'offline' });
    const renderer = await renderProfile('marek');
    act(() => rowWith(renderer, t.nv.parta.report).props.onPress());
    await act(async () => (dialog as jest.Mock).mock.calls[0][0].actions[1].onPress());

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', title: t.nv.parta.reportPersonError }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: t.nv.parta.reported }));
  });

  it('blocks only after the dialog is confirmed', async () => {
    (blockFriend as jest.Mock).mockResolvedValue({ ok: true });
    const renderer = await renderProfile('marek');
    act(() => rowWith(renderer, t.nv.parta.block).props.onPress());

    expect(blockFriend).not.toHaveBeenCalled();
    const asked = (dialog as jest.Mock).mock.calls[0][0];
    expect(asked.title).toBe(t.nv.parta.blockTitle('@marek'));
    expect(asked.body).toBe(t.nv.parta.blockBody);
    expect(asked.actions[0].onPress).toBeUndefined();

    await act(async () => asked.actions[1].onPress());
    expect(blockFriend).toHaveBeenCalledWith('marek');
  });

  it('offers no report or block on my own profile', async () => {
    const renderer = await renderProfile('me');
    const all = texts(renderer.root);
    expect(all).not.toContain(t.nv.parta.report);
    expect(all).not.toContain(t.nv.parta.block);
    expect(all).not.toContain(t.nv.parta.removeFromParty);
  });
});
