import React from 'react';
import { Share } from 'react-native';
import { t } from '@/i18n';

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

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'plan-1' }),
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-calendar/legacy', () => ({}));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/partaPlansClient', () => ({
  ...jest.requireActual('@/data/partaPlansClient'),
  fetchPlanDetail: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { fetchPlanDetail, parsePlanDetail } = require('@/data/partaPlansClient');
const { usePartaStore } = require('@/newlook/screens/parta/partaStore');
const { PlanScreen } = require('@/newlook/screens/parta/PartaFlows');

const URL = 'https://na-pivo.cz/pozvanka/aJNOBD4FlXUlg55trYBHIc8o';

function payload(isMine: boolean) {
  return {
    id: 'plan-1',
    account: { id: 'm', nickname: 'marek', display_name: 'Marek', avatar_url: null, is_public: true },
    cache_key: 'u2fkbn1z',
    name: 'Lokál Dlouhááá',
    city: 'Praha 1',
    kind: 'plan',
    scheduled_for: '2026-11-06T18:00:00Z',
    started_at: '2026-11-06T18:00:00Z',
    expires_at: '2026-11-06T22:00:00Z',
    responses: { going: 1, maybe: 0, cant: 0, going_profiles: [] },
    my_response: isMine ? null : 'going',
    place_kind: 'pub',
    lat: 50.09,
    lng: 14.42,
    is_mine: isMine,
    invite_url: isMine ? URL : null,
    people: {
      going: [{ id: 'j', nickname: 'jana', display_name: 'Jana' }],
      maybe: [],
      cant: [],
      silent: [],
      maybe_count: 0,
      cant_count: 0,
      guests: isMine
        ? [{ id: 'g1', name: 'Ondra', response: 'going' }, { id: 'g2', name: 'Lucka', response: 'maybe' }]
        : [{ id: 'g1', name: 'Ondra', response: 'going' }],
    },
    home: null,
  };
}

function texts(renderer: any): string[] {
  return renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

async function render(isMine: boolean): Promise<any> {
  (fetchPlanDetail as jest.Mock).mockResolvedValue(parsePlanDetail(payload(isMine)));
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PlanScreen));
  });
  return renderer;
}

beforeEach(() => {
  usePartaStore.setState({ plans: null });
  (Share.share as jest.Mock).mockClear();
});

describe('plan guest link', () => {
  it('reads the link and guests from the plan detail', () => {
    const detail = parsePlanDetail(payload(true));
    expect(detail.plan.inviteUrl).toBe(URL);
    expect(detail.people.guests).toEqual([
      { id: 'g1', name: 'Ondra', response: 'going' },
      { id: 'g2', name: 'Lucka', response: 'maybe' },
    ]);
    const released = parsePlanDetail({ ...payload(false), invite_url: undefined, people: { going: [] } });
    expect(released.plan.inviteUrl).toBeNull();
    expect(released.people.guests).toEqual([]);
    expect(parsePlanDetail({ ...payload(true), invite_url: 'javascript:alert(1)' }).plan.inviteUrl).toBeNull();
  });

  it('lets the host share the link and shows guests among who goes', async () => {
    const renderer = await render(true);
    const share = renderer.root.find((n: any) => n.props.label === t.nv.parta.shareInvite && typeof n.props.onPress === 'function');
    await act(async () => share.props.onPress());
    expect(Share.share).toHaveBeenCalledWith({ message: t.nv.parta.inviteMessage('Lokál Dlouhááá', URL) });
    const all = texts(renderer).join('\n');
    expect(all).toContain(t.nv.parta.guestsLabel);
    expect(all).toContain(`Ondra, ${t.nv.parta.guestMaybe('Lucka')}`);
  });

  it('keeps the sticker share for invitees and counts going guests', async () => {
    const renderer = await render(false);
    expect(renderer.root.findAll((n: any) => n.props.label === t.nv.parta.shareInvite)).toHaveLength(0);
    const all = texts(renderer);
    expect(all).toContain('Ondra');
    expect(all).toContain('3');
  });
});
