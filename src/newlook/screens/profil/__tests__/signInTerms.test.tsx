import React from 'react';
import { Linking } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { t } from '@/i18n';

import { PrihlaseniScreen } from '../ProfilScreens';
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
  useFocusEffect: jest.fn(),
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
      ['https://tomasmach.github.io/na-pivo/terms.html'],
      ['https://tomasmach.github.io/na-pivo/privacy.html'],
    ]);
    open.mockRestore();
  });


  it.each([
    ['cs', 'terms', 'https://tomasmach.github.io/na-pivo/terms.html'],
    ['cs', 'privacy', 'https://tomasmach.github.io/na-pivo/privacy.html'],
    ['en', 'terms', 'https://tomasmach.github.io/na-pivo/en/terms.html'],
    ['en', 'privacy', 'https://tomasmach.github.io/na-pivo/en/privacy.html'],
  ] as const)('opens the %s %s page', (lang, page, url) => {
    expect(legalUrl(page, lang)).toBe(url);
  });
});
