import React from 'react';
import { Pressable, Text } from 'react-native';

import InviteClaimScreen from '../parta/pozvanka';
import { claimInviteCode, clearPendingInviteCode } from '@/data/friendInviteLink';
import { resolveInviteCode } from '@/data/friendsClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;
const replace = jest.fn();
const back = jest.fn();
const showToast = jest.fn();
let params: { code?: string } = { code: 'invite-a' };
let canGoBack = false;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => params,
  useRouter: () => ({ back, canGoBack: () => canGoBack, replace }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: ({
    label,
    onPress,
    disabled,
    loading,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => React.createElement(
    Pressable,
    {
      accessibilityLabel: label,
      accessibilityState: { busy: Boolean(loading), disabled: Boolean(disabled) },
      disabled,
      onPress,
    },
    React.createElement(Text, null, loading ? 'loading' : label),
  ),
}));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
  UsersIcon: () => null,
}));
jest.mock('@/profile/Avatar', () => ({
  Avatar: ({ nickname }: { nickname?: string | null }) =>
    React.createElement(Text, null, nickname ? `avatar:${nickname}` : 'avatar'),
}));
jest.mock('@/data/friendsClient', () => ({
  resolveInviteCode: jest.fn(),
}));
jest.mock('@/data/friendInviteLink', () => {
  const actual = jest.requireActual('@/data/friendInviteLink');
  return {
    ...actual,
    claimInviteCode: jest.fn(),
    clearPendingInviteCode: jest.fn(),
  };
});
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: { session: { accountId: string }; profile: null }) => unknown) =>
    selector({ session: { accountId: 'my-account' }, profile: null }),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function inviter(id: string, nickname: string) {
  return {
    valid: true as const,
    expired: false,
    inviter: {
      id,
      nickname,
      displayName: nickname,
      avatarUrl: null,
      isPublic: true,
    },
  };
}

function textContent(renderer: ReturnType<typeof TestRenderer.create>): string {
  return renderer.root
    .findAllByType(Text)
    .map((node: { props: { children?: unknown } }) => String(node.props.children ?? ''))
    .join(' ');
}

describe('InviteClaimScreen account and code boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    params = { code: 'invite-a' };
    canGoBack = false;
    jest.mocked(clearPendingInviteCode).mockResolvedValue(undefined);
  });

  it('resets to loading immediately when a loaded A route becomes B and ignores late A', async () => {
    const a = deferred<ReturnType<typeof inviter>>();
    const b = deferred<ReturnType<typeof inviter>>();
    jest.mocked(resolveInviteCode).mockImplementation((code) =>
      code === 'invite-a' ? a.promise : b.promise,
    );
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(InviteClaimScreen));
    });

    await act(async () => {
      a.resolve(inviter('account-a', 'alice'));
      await Promise.resolve();
    });
    expect(textContent(renderer)).toContain('@alice tě zve do party');

    act(() => {
      params = { code: 'invite-b' };
      renderer.update(React.createElement(InviteClaimScreen));
    });
    expect(textContent(renderer)).toContain('Načítám pozvánku…');
    expect(textContent(renderer)).not.toContain('@alice');

    await act(async () => {
      b.resolve(inviter('account-b', 'bob'));
      await Promise.resolve();
    });
    expect(textContent(renderer)).toContain('@bob tě zve do party');
    expect(textContent(renderer)).not.toContain('@alice');
    act(() => renderer.unmount());
  });

  it('does not let a claim for A clear storage or navigate after the route becomes B', async () => {
    const a = deferred<ReturnType<typeof inviter>>();
    const b = deferred<ReturnType<typeof inviter>>();
    const claimA = deferred<{ ok: true }>();
    jest.mocked(resolveInviteCode).mockImplementation((code) =>
      code === 'invite-a' ? a.promise : b.promise,
    );
    jest.mocked(claimInviteCode).mockReturnValue(claimA.promise);
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(InviteClaimScreen));
    });
    await act(async () => {
      a.resolve(inviter('account-a', 'alice'));
      await Promise.resolve();
    });

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: 'Přidat do party' }).props.onPress();
    });
    const pendingCta = renderer.root.findByProps({ accessibilityLabel: 'Přidat do party' });
    expect(pendingCta.props.disabled).toBe(true);
    expect(pendingCta.props.accessibilityState).toEqual({ busy: true, disabled: true });
    expect(claimInviteCode).toHaveBeenCalledWith('invite-a');

    act(() => {
      params = { code: 'invite-b' };
      renderer.update(React.createElement(InviteClaimScreen));
    });
    await act(async () => {
      b.resolve(inviter('account-b', 'bob'));
      await Promise.resolve();
      claimA.resolve({ ok: true });
      await Promise.resolve();
    });

    expect(textContent(renderer)).toContain('@bob tě zve do party');
    expect(clearPendingInviteCode).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('ignores back and a second claim tap while the first claim owns terminal navigation', async () => {
    const resolution = deferred<ReturnType<typeof inviter>>();
    const claim = deferred<{ ok: true }>();
    jest.mocked(resolveInviteCode).mockReturnValue(resolution.promise);
    jest.mocked(claimInviteCode).mockReturnValue(claim.promise);
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(InviteClaimScreen));
    });
    await act(async () => {
      resolution.resolve(inviter('account-a', 'alice'));
      await Promise.resolve();
    });

    const claimButton = renderer.root.findByProps({ accessibilityLabel: 'Přidat do party' });
    const backButton = renderer.root.findByProps({ accessibilityLabel: 'Zpět' });
    act(() => {
      claimButton.props.onPress();
      claimButton.props.onPress();
      backButton.props.onPress();
    });

    expect(claimInviteCode).toHaveBeenCalledTimes(1);
    expect(clearPendingInviteCode).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      claim.resolve({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clearPendingInviteCode).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('handles a double back with one clear and one terminal navigation', async () => {
    const resolution = deferred<ReturnType<typeof inviter>>();
    const clear = deferred<void>();
    jest.mocked(resolveInviteCode).mockReturnValue(resolution.promise);
    jest.mocked(clearPendingInviteCode).mockReturnValue(clear.promise);
    canGoBack = true;
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(InviteClaimScreen));
    });
    await act(async () => {
      resolution.resolve(inviter('account-a', 'alice'));
      await Promise.resolve();
    });

    const backButton = renderer.root.findByProps({ accessibilityLabel: 'Zpět' });
    act(() => {
      backButton.props.onPress();
      backButton.props.onPress();
    });

    expect(clearPendingInviteCode).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();

    await act(async () => {
      clear.resolve();
      await Promise.resolve();
    });

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
