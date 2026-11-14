import React from 'react';
import { Linking } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { fetchFriendsDashboard, updateFriendSettings } from '@/data/friendsClient';
import { t } from '@/i18n';

import { usePartaStore } from '../../parta/partaStore';
import { useAccountStore } from '@/stores/accountStore';
import { PrihlaseniScreen, SpravaPartyScreen, ViditelnostScreen } from '../ProfilScreens';
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
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
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

describe('profile visibility after registration', () => {
  const byTestId = (renderer: any, id: string) => renderer.root.find((n: any) => n.props.testID === id && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function'));
  const profile = { emailVerified: true, created: true, nickname: null };

  beforeEach(() => jest.clearAllMocks());

  async function signIn(mode: 'login' | 'register') {
    const register = jest.fn(async () => ({ ok: true, profile }));
    const login = jest.fn(async () => ({ ok: true, profile: { ...profile, created: false, nickname: 'tomas' } }));
    useAccountStore.setState({ register, login } as any);
    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(<PrihlaseniScreen />);
    });
    if (mode === 'register') {
      const tabs = renderer.root.find((n: any) => Array.isArray(n.props.options) && typeof n.props.onChange === 'function');
      await act(async () => tabs.props.onChange('register'));
    }
    await act(async () => byTestId(renderer, 'auth-email').props.onChangeText('novy@example.com'));
    await act(async () => byTestId(renderer, 'auth-password').props.onChangeText('heslo12345'));
    await act(async () => byTestId(renderer, 'auth-submit').props.onPress());
    return { register, login };
  }

  it('sends a new account to the visibility question first', async () => {
    const { register } = await signIn('register');
    expect(register).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/nv/viditelnost');
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/nv/upravit-profil');
  });

  it('does not ask when logging in to an existing account', async () => {
    const { login } = await signIn('login');
    expect(login).toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/nv/viditelnost');
  });

  const backPress = jest.fn();
  beforeAll(() => {
    (jest.requireActual('react-native') as any).BackHandler = {
      addEventListener: (event: string, handler: () => boolean) => {
        backPress.mockImplementation(handler);
        return { remove: () => {} };
      },
    };
  });

  async function renderQuestion(updateProfile: jest.Mock) {
    useAccountStore.setState({ updateProfile } as any);
    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(<ViditelnostScreen />);
    });
    return renderer;
  }
  const choose = (renderer: any, title: string) => renderer.root.find((n: any) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function' && n.props.accessibilityLabel.startsWith(title));

  it('cannot go on without a choice and saves a private profile on the server before the profile edit', async () => {
    const updateProfile = jest.fn(async () => ({ ok: true }));
    const renderer = await renderQuestion(updateProfile);
    expect(byTestId(renderer, 'visibility-confirm').props.disabled).toBe(true);
    expect(renderer.root.findAll((n: any) => n.props.testID === 'visibility-skip')).toHaveLength(0);
    expect(backPress()).toBe(true);

    await act(async () => choose(renderer, t.profile.privacy.privateTitle).props.onPress());
    await act(async () => byTestId(renderer, 'visibility-confirm').props.onPress());

    expect(updateProfile).toHaveBeenCalledWith({ isPublic: false });
    expect(mockRouter.replace).toHaveBeenCalledWith('/nv/upravit-profil');
  });

  it('says a failed save failed, stays, and saves on retry', async () => {
    const updateProfile = jest.fn().mockResolvedValueOnce({ ok: false, code: 'network', detail: '' }).mockResolvedValueOnce({ ok: true });
    const renderer = await renderQuestion(updateProfile);
    await act(async () => choose(renderer, t.profile.privacy.publicTitle).props.onPress());
    await act(async () => byTestId(renderer, 'visibility-confirm').props.onPress());

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(renderer.root.findAll((n: any) => n.type === 'Text' && textOf(n) === t.profile.privacy.error).length).toBeGreaterThan(0);
    expect(byTestId(renderer, 'visibility-skip')).toBeTruthy();

    await act(async () => byTestId(renderer, 'visibility-confirm').props.onPress());
    expect(updateProfile).toHaveBeenLastCalledWith({ isPublic: true });
    expect(mockRouter.replace).toHaveBeenCalledWith('/nv/upravit-profil');
  });
});
