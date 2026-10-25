/**
 * Expo Router reuses the invite screen when a second invite link arrives while
 * the first one is open. The second inviter must not borrow the first one's name.
 */

import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockParams: { code: string } = { code: 'AAAA' };
const mockRouter = { replace: jest.fn(), dismissTo: jest.fn() };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/GlowButton', () => ({ GlowButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
  UsersIcon: () => null,
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/theme/fonts', () => ({
  Fonts: { display: { extrabold: 'd' }, ui: { medium: 'm' } },
  FontScaleCap: { heading: 1.2, body: 1.3 },
}));
jest.mock('@/data/friendInviteLink', () => ({ claimInviteCode: jest.fn() }));
jest.mock('@/data/friendsClient', () => ({ resolveInviteCode: jest.fn() }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (select: (s: { profile: null }) => unknown) => select({ profile: null }),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (select: (s: { show: () => void }) => unknown) => select({ show: jest.fn() }),
}));

import { resolveInviteCode } from '@/data/friendsClient';
import { t } from '@/i18n';
import InviteClaimScreen from '../parta/pozvanka';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function texts(root: { findAll: (match: (node: { type: unknown }) => boolean) => { children: unknown[] }[] }) {
  return root
    .findAll((node) => node.type === 'Text')
    .flatMap((node) => node.children)
    .join(' ');
}

it('shows the second invite as loading instead of the first inviter', async () => {
  (resolveInviteCode as jest.Mock)
    .mockResolvedValueOnce({
      valid: true,
      inviter: { id: 'alice-id', nickname: 'alice', displayName: 'Alice', avatarUrl: null },
    })
    .mockReturnValueOnce(new Promise(() => undefined));

  let renderer: { root: Parameters<typeof texts>[0]; update: (el: React.ReactElement) => void } | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<InviteClaimScreen />);
  });
  expect(texts(renderer!.root)).toContain('@alice');

  mockParams = { code: 'BBBB' };
  await act(async () => {
    renderer!.update(<InviteClaimScreen />);
  });

  expect(resolveInviteCode).toHaveBeenLastCalledWith('BBBB');
  expect(texts(renderer!.root)).not.toContain('@alice');
});

it('returns to the existing Parta tab instead of stacking a second tab bar', async () => {
  mockParams = { code: 'CCCC' };
  (resolveInviteCode as jest.Mock).mockResolvedValue({
    valid: true,
    inviter: { id: 'bob-id', nickname: 'bob', displayName: 'Bob', avatarUrl: null },
  });
  let renderer: { root: any } | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<InviteClaimScreen />);
  });
  const back = renderer!.root.find(
    (node: { props: Record<string, unknown> }) =>
      node.props.accessibilityLabel === t.friends.claimBack && typeof node.props.onPress === 'function',
  );
  await act(async () => back.props.onPress());
  expect(mockRouter.dismissTo).toHaveBeenLastCalledWith('/friends');
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
