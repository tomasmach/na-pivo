import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { endFriendPubActivity, fetchFriendsDashboard, parseActivity, respondToActivity, type RawFriendActivity } from '@/data/friendsClient';
import { enqueueFriendOp } from '@/data/friendsQueue';
import { savePartaPlansSnapshot } from '@/data/friendsSnapshot';
import { fetchPartaPlans, fetchPlanDetail, parsePlanDetail } from '@/data/partaPlansClient';
import { t } from '@/i18n';
import { nvBack } from '@/newlook/navigation';
import { dialog } from '@/newlook/ui/store';

import { livePingPlans } from '../partaModel';
import { PlanScreen } from '../PartaFlows';
import { usePartaStore } from '../partaStore';

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
const mockParams = { id: 'ping-mine' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-calendar/legacy', () => ({}));
jest.mock('../PartaPhotos', () => ({ FriendPhotosSection: () => null, PartaPhotoStrip: () => null }));
jest.mock('../../stamgast/placeStore', () => ({ useNvPlaceStore: { getState: () => ({ setOutside: jest.fn() }) } }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/friendsSnapshot', () => ({
  loadFriendsDashboardSnapshot: jest.fn(async () => null),
  loadPartaPlansSnapshot: jest.fn(async () => null),
  savePartaPlansSnapshot: jest.fn(async () => undefined),
  snapshotGeneration: () => 0,
}));
jest.mock('@/data/friendsQueue', () => ({
  enqueueFriendOp: jest.fn(async () => undefined),
  isRetriableFriendError: (result: { code: string }) => result.code === 'network',
}));
jest.mock('@/data/friendsClient', () => ({
  ...jest.requireActual('@/data/friendsClient'),
  fetchFriendsDashboard: jest.fn(),
  markFriendNotificationsRead: jest.fn(),
  respondToActivity: jest.fn(),
  endFriendPubActivity: jest.fn(),
}));
jest.mock('@/data/partaPlansClient', () => ({
  ...jest.requireActual('@/data/partaPlansClient'),
  fetchPartaPlans: jest.fn(),
  fetchPlanDetail: jest.fn(),
}));

const HOUR = 60 * 60 * 1000;

function raw(id: string, owner: string, extra: Partial<RawFriendActivity> = {}): RawFriendActivity {
  return {
    id,
    account: { id: owner, nickname: owner, display_name: owner === 'me' ? 'Tomáš' : 'Marek', avatar_url: null, is_public: true },
    cache_key: 'u2fkbn1z',
    name: 'Lokál Dlouhááá',
    city: 'Praha 1',
    external_id: '',
    message: '',
    started_at: new Date(Date.now() - HOUR).toISOString(),
    expires_at: new Date(Date.now() + 3 * HOUR).toISOString(),
    active: true,
    kind: 'live',
    responses: { going: 1, maybe: 0, cant: 0, going_profiles: [{ id: 'j', nickname: 'jana', display_name: 'Jana', avatar_url: null, is_public: true }] },
    my_response: null,
    ...extra,
  } as RawFriendActivity;
}

const minePing = parseActivity(raw('ping-mine', 'me'));
const friendPing = parseActivity(raw('ping-friend', 'marek'));
const newLookNow = parseActivity(raw('plan-now', 'marek'));

function texts(renderer: any): string[] {
  return renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

async function loadParta() {
  (fetchFriendsDashboard as jest.Mock).mockResolvedValue({
    activeFriends: [friendPing, newLookNow],
    myActiveActivity: minePing,
    incomingRequests: [],
    notifications: [],
    presence: [],
    friends: [],
  });
  (fetchPartaPlans as jest.Mock).mockResolvedValue([{ ...newLookNow, placeKind: 'pub', address: '', lat: 50, lng: 14, isMine: false, inviteeCount: null, inviteUrl: null }]);
  await usePartaStore.getState().load();
}

async function renderPlan(id: string, isMine: boolean) {
  mockParams.id = id;
  (fetchPlanDetail as jest.Mock).mockResolvedValue(
    parsePlanDetail({
      ...raw(id, isMine ? 'me' : 'marek'),
      place_kind: 'pub',
      lat: 50.09,
      lng: 14.42,
      is_mine: isMine,
      people: { going: [{ id: 'j', nickname: 'jana', display_name: 'Jana' }], maybe: [], cant: [], silent: [] },
      home: null,
    }),
  );
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(<PlanScreen />);
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  usePartaStore.setState({ plans: null, pingIds: [], dashboard: null });
});

describe('live pub pings in Parta', () => {
  it('turns dashboard pings into plan rows, skipping ones already in plans and expired ones', () => {
    const expired = parseActivity(raw('old', 'marek', { expires_at: new Date(Date.now() - 1000).toISOString() }));
    const rows = livePingPlans({ activeFriends: [friendPing, newLookNow, expired], myActiveActivity: minePing }, [{ id: 'plan-now' }]);
    expect(rows.map((row) => [row.id, row.isMine, row.placeKind])).toEqual([
      ['ping-mine', true, 'pub'],
      ['ping-friend', false, 'pub'],
    ]);
  });

  it('shows pings next to the plans after a load', async () => {
    await loadParta();
    const state = usePartaStore.getState();
    expect(state.plans?.map((plan) => plan.id).sort()).toEqual(['ping-friend', 'ping-mine', 'plan-now']);
    expect(state.pingIds.sort()).toEqual(['ping-friend', 'ping-mine']);
    const saved = (savePartaPlansSnapshot as jest.Mock).mock.calls.at(-1)?.[0] as { id: string }[];
    expect(saved.map((plan) => plan.id)).toEqual(['plan-now']);
  });

  it("answers a friend's ping with Jdu and keeps the answer offline", async () => {
    await loadParta();
    (respondToActivity as jest.Mock).mockResolvedValue({ ok: false, code: 'network', detail: '' });
    const renderer = await renderPlan('ping-friend', false);
    const all = texts(renderer);
    expect(all).toEqual(expect.arrayContaining([t.nv.parta.rsvpGoing, t.nv.parta.rsvpMaybe, 'Jana']));

    const going = renderer.root.find((n: any) => typeof n.props.onPress === 'function' && texts({ root: n }).includes(t.nv.parta.rsvpGoing));
    await act(async () => going.props.onPress());
    expect(respondToActivity).toHaveBeenCalledWith('ping-friend', 'going');
    expect(enqueueFriendOp).toHaveBeenCalledWith({ op: 'rsvp', activityId: 'ping-friend', response: 'going' });
    expect(usePartaStore.getState().plans?.find((plan) => plan.id === 'ping-friend')?.myResponse).toBe('going');
  });

  it('lets me end my own ping without signal, and does not offer to edit it', async () => {
    await loadParta();
    (endFriendPubActivity as jest.Mock).mockResolvedValue({ ok: false, code: 'network', detail: '' });
    const renderer = await renderPlan('ping-mine', true);
    const all = texts(renderer);
    expect(all).toContain(t.nv.parta.yourPing.toUpperCase());
    expect(all).toContain(t.nv.parta.goingCount(1));
    expect(all).not.toContain(t.nv.parta.editPlan);
    expect(all).not.toContain(t.nv.parta.cancelPlan);

    const end = renderer.root.find((n: any) => n.props.accessibilityLabel === t.nv.parta.endPingA11y && typeof n.props.onPress === 'function');
    act(() => end.props.onPress());
    const confirm = (dialog as jest.Mock).mock.calls[0][0].actions[1];
    expect(confirm.label).toBe(t.nv.parta.endPingConfirm);
    await act(async () => confirm.onPress());

    expect(endFriendPubActivity).toHaveBeenCalledWith('ping-mine');
    expect(enqueueFriendOp).toHaveBeenCalledWith({ op: 'end', clientId: 'ping-mine', activityId: 'ping-mine' });
    expect(usePartaStore.getState().plans?.some((plan) => plan.id === 'ping-mine')).toBe(false);
    expect(usePartaStore.getState().pingIds).not.toContain('ping-mine');
    expect(nvBack).toHaveBeenCalled();
  });
});
