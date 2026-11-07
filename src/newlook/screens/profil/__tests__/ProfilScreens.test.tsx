import React from 'react';
import { Linking } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { fetchFriendsDashboard, updateFriendSettings } from '@/data/friendsClient';
import { t } from '@/i18n';

import { usePartaStore } from '../../parta/partaStore';
import { PrihlaseniScreen, SpravaPartyScreen } from '../ProfilScreens';
import { legalUrl } from '../profilModel';

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
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (run: () => void) => jest.requireActual('react').useEffect(run, [run]),
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/components/chrome', () => {
  const { View } = jest.requireActual('react-native');
  const Screen = ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <View>
      {children}
      {footer}
    </View>
  );
  return { Screen, BackHeader: () => null };
});
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/socialAuth', () => ({ isAppleSignInSupported: () => true, isGoogleSignInConfigured: () => true }));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-clipboard', () => ({}));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-calendar/legacy', () => ({}));
jest.mock('@/data/feedbackAttachmentPicker', () => ({}));
jest.mock('@/profile/avatarPicker', () => ({}));
jest.mock('expo-updates', () => ({}));
jest.mock('@/notifications/pubReminderNotifications', () => ({}));
jest.mock('@/notifications/friendPush', () => ({}));
jest.mock('@/notifications/homeTransitReminder', () => ({}));
jest.mock('@/notifications/tourReminder', () => ({}));
jest.mock('../profilModel', () => ({
  ...jest.requireActual('../profilModel'),
  useMe: () => ({ isSignedIn: true, profile: { nickname: 'tomas' }, nick: 'tomas' }),
}));
jest.mock('@/data/friendsSnapshot', () => ({
  ...jest.requireActual('@/data/friendsSnapshot'),
  loadFriendsDashboardSnapshot: jest.fn(async () => null),
}));
jest.mock('@/data/friendsClient', () => ({
  ...jest.requireActual('@/data/friendsClient'),
  fetchFriendsDashboard: jest.fn(),
  fetchBlockedAccounts: jest.fn(async () => []),
  fetchFriendInviteCode: jest.fn(async () => null),
  updateFriendSettings: jest.fn(),
}));

const textOf = (node: any): string => [node.props.children].flat().map((c: any) => (typeof c === 'string' ? c : '')).join('');

describe('sign-in terms notice', () => {
  it('shows the consent with links to the terms and the privacy policy before any sign-in', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<PrihlaseniScreen />);
    });
    const links = renderer.root.findAll((n: any) => n.type === 'Text' && n.props.accessibilityRole === 'link');
    expect(links.map(textOf)).toEqual([t.nv.profil.signIn.termsLink, t.nv.profil.signIn.privacyLink]);

    links[0].props.onPress();
    links[1].props.onPress();
    expect(open.mock.calls).toEqual([
      ['https://na-pivo.cz/podminky'],
      ['https://na-pivo.cz/ochrana-soukromi'],
    ]);
    open.mockRestore();
  });


  it.each([
    ['cs', 'terms', 'https://na-pivo.cz/podminky'],
    ['cs', 'privacy', 'https://na-pivo.cz/ochrana-soukromi'],
    ['en', 'terms', 'https://na-pivo.cz/en/terms'],
    ['en', 'privacy', 'https://na-pivo.cz/en/privacy'],
  ] as const)('opens the %s %s page', (lang, page, url) => {
    expect(legalUrl(page, lang)).toBe(url);
  });
});

describe('ghost mode in Správa party', () => {
  const dashboard = (ghostMode: boolean) => ({
    friends: [],
    outgoingRequests: [],
    settings: { ghostMode, quietHoursEnabled: true, quietHoursStart: 23, quietHoursEnd: 9, shareDrinksWithParta: true },
  });
  const ghostToggle = (renderer: any) => {
    const row = renderer.root.find((n: any) => n.props.title === t.nv.profil.parta.ghostTitle && n.props.trailing);
    return row.props.trailing;
  };

  async function render(ghostMode: boolean) {
    (fetchFriendsDashboard as jest.Mock).mockResolvedValue(dashboard(ghostMode));
    usePartaStore.setState({ dashboard: dashboard(ghostMode) as any });
    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(<SpravaPartyScreen />);
    });
    return renderer;
  }

  it('turns invisible mode on and back off, and Parta sees the same setting', async () => {
    (updateFriendSettings as jest.Mock).mockResolvedValue({ ok: true });
    const renderer = await render(false);
    expect(ghostToggle(renderer).props.value).toBe(false);

    await act(async () => ghostToggle(renderer).props.onChange(true));
    expect(updateFriendSettings).toHaveBeenLastCalledWith({ ghostMode: true });
    expect(ghostToggle(renderer).props.value).toBe(true);
    expect(usePartaStore.getState().dashboard?.settings.ghostMode).toBe(true);

    await act(async () => ghostToggle(renderer).props.onChange(false));
    expect(updateFriendSettings).toHaveBeenLastCalledWith({ ghostMode: false });
    expect(ghostToggle(renderer).props.value).toBe(false);
    expect(usePartaStore.getState().dashboard?.settings.ghostMode).toBe(false);
  });

  it('puts the switch back when the server refuses', async () => {
    (updateFriendSettings as jest.Mock).mockResolvedValue({ ok: false, code: 'network', detail: 'Bez signálu' });
    const renderer = await render(false);
    await act(async () => ghostToggle(renderer).props.onChange(true));
    expect(ghostToggle(renderer).props.value).toBe(false);
    expect(usePartaStore.getState().dashboard?.settings.ghostMode).toBe(false);
  });
});
