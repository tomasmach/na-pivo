import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { cs } from '@/i18n/cs';

import AccountScreen from '../account';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
  MenuIcon: () => null,
  Share2Icon: () => null,
  Trash2Icon: () => null,
}));

jest.mock('@/components/shared/MoreSheet', () => ({
  MoreSheet: (props: Record<string, unknown>) => React.createElement('MoreSheet', props),
}));

jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
const mockShowAppDialog = jest.requireMock('@/components/shared/AppDialog')
  .showAppDialog as jest.Mock;
jest.mock('@/components/shared/BrandIcon', () => ({ AppleIcon: () => null, GoogleIcon: () => null }));
jest.mock('@/account/LoginMethodsSheet', () => ({
  LoginMethodsSheet: (props: Record<string, unknown>) =>
    React.createElement('LoginMethodsSheet', props),
}));
jest.mock('@/account/PasswordSheet', () => ({
  PasswordSheet: (props: Record<string, unknown>) => React.createElement('PasswordSheet', props),
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/counter/NudgeSlot', () => ({ NudgeSlot: () => null }));
jest.mock('@/counter/CounterCta', () => ({
  CounterCta: (props: Record<string, unknown>) => React.createElement('CounterCta', props),
}));
// The secondary action is the shared quiet pill now (DESIGN §6.2), not the 2.x
// amber outline.
jest.mock('@/components/shared/QuietPill', () => ({
  QuietPill: (props: Record<string, unknown>) => React.createElement('QuietPill', props),
}));
jest.mock('@/data/socialAuth', () => ({ isAppleSignInSupported: () => false }));

const accountState = {
  session: {
    accountId: 'account-a',
    token: 'token-a',
    authenticated: true,
  },
  profile: null as null | Record<string, unknown>,
  refreshProfile: jest.fn(),
  linkGoogle: jest.fn(),
  linkApple: jest.fn(),
  unlink: jest.fn(),
  setPassword: jest.fn(),
  logout: jest.fn(),
  deleteAccount: jest.fn(),
  exportAccountData: jest.fn(),
  requestEmailVerification: jest.fn(),
};

jest.mock('@/stores/accountStore', () => ({
  selectNickname: (state: typeof accountState) => state.profile?.nickname ?? null,
  selectAvatarUrl: (state: typeof accountState) => state.profile?.avatarUrl ?? null,
  selectIsSignedIn: (state: typeof accountState) => state.session?.authenticated === true,
  useAccountStore: (selector: (state: typeof accountState) => unknown) => selector(accountState),
}));

const mockShowToast = jest.fn();
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('account release flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(true);
    accountState.session.authenticated = true;
    accountState.profile = null;
    accountState.refreshProfile.mockResolvedValue(undefined);
    accountState.logout.mockResolvedValue({ ok: true });
  });

  it('keeps retry and offline logout available when a signed-in profile did not load', async () => {
    const pending = deferred<void>();
    accountState.refreshProfile.mockReturnValue(pending.promise);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    const retry = renderer.root.findByProps({ accessibilityLabel: 'Znovu načíst účet' });
    expect(retry).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: cs.a11y.accountLogout })).toBeTruthy();

    act(() => {
      void retry.props.onPress();
      void retry.props.onPress();
    });
    expect(accountState.refreshProfile).toHaveBeenCalledTimes(1);

    const loadingRetry = renderer.root.findByProps({ accessibilityLabel: cs.account.loading });
    expect(loadingRetry.props.disabled).toBe(true);
    expect(renderer.root.findByProps({ accessibilityLabel: cs.a11y.accountLogout })).toBeTruthy();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
  });

  it('shows retry and an exit when an anonymous profile did not load', async () => {
    accountState.session.authenticated = false;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    expect(renderer.root.findByProps({ accessibilityLabel: cs.a11y.accountRetry })).toBeTruthy();
    const exit = renderer.root.findByType('QuietPill' as never);
    expect(exit.props.accessibilityLabel).toBe(cs.a11y.backButton);
    expect(exit.props.label).toBe(cs.account.resetInvalidCta);

    act(() => {
      exit.props.onPress();
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(accountState.logout).not.toHaveBeenCalled();
  });

  it('can log out while a profile retry is still waiting for the network', async () => {
    const retryPending = deferred<void>();
    const logoutPending = deferred<{ ok: true }>();
    accountState.refreshProfile.mockReturnValue(retryPending.promise);
    accountState.logout.mockReturnValue(logoutPending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    act(() => {
      void renderer.root.findByProps({ accessibilityLabel: cs.a11y.accountRetry }).props.onPress();
    });
    act(() => {
      void renderer.root.findByProps({ accessibilityLabel: cs.a11y.accountLogout }).props.onPress();
    });

    expect(accountState.refreshProfile).toHaveBeenCalledTimes(1);
    expect(accountState.logout).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType('CounterCta' as never).props.disabled).toBe(true);
    expect(renderer.root.findByType('QuietPill' as never).props).toEqual(
      expect.objectContaining({
        label: cs.account.loading,
        accessibilityLabel: cs.account.loading,
      }),
    );

    await act(async () => {
      logoutPending.resolve({ ok: true });
      await logoutPending.promise;
    });
    expect(mockBack).toHaveBeenCalledTimes(1);

    await act(async () => {
      retryPending.resolve();
      await retryPending.promise;
    });
  });

  it('logs out once when the offline fallback is double-tapped', async () => {
    const pending = deferred<{ ok: true }>();
    accountState.logout.mockReturnValue(pending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    const logout = renderer.root.findByProps({ accessibilityLabel: cs.a11y.accountLogout });
    act(() => {
      void logout.props.onPress();
      void logout.props.onPress();
    });
    expect(accountState.logout).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('keeps logout locked when the store clears the signed-in session mid-request', async () => {
    const pending = deferred<{ ok: true }>();
    accountState.logout.mockReturnValue(pending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    act(() => {
      void renderer.root.findByProps({ accessibilityLabel: cs.a11y.accountLogout }).props.onPress();
    });
    expect(accountState.logout).toHaveBeenCalledTimes(1);

    accountState.session.authenticated = false;
    act(() => {
      renderer.update(<AccountScreen />);
    });

    const lockedLogout = renderer.root.findByType('QuietPill' as never);
    expect(lockedLogout.props).toEqual(
      expect.objectContaining({
        label: cs.account.loading,
        accessibilityLabel: cs.account.loading,
        disabled: true,
      }),
    );
    act(() => {
      lockedLogout.props.onPress();
    });
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('opens one export share flow when the export row is double-tapped', async () => {
    accountState.profile = {
      id: 'account-a',
      deviceId: 'device-a',
      nickname: 'pivar',
      displayName: 'Pivař',
      avatarUrl: null,
      isPublic: true,
      email: 'pivar@example.cz',
      emailVerified: true,
      providers: ['email'],
      isAnonymous: false,
      status: 'active',
    };
    const pending = deferred<{ ok: true }>();
    accountState.exportAccountData.mockReturnValue(pending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    const exportRow = renderer.root.findByType('MoreSheet' as never).props.rows.find(
      (row: { key: string }) => row.key === 'export',
    );
    act(() => {
      void exportRow.onPress();
      void exportRow.onPress();
    });

    expect(accountState.exportAccountData).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
  });

  it('does not promise login recovery when deleting an anonymous account', async () => {
    jest.useFakeTimers();
    accountState.profile = {
      id: 'account-a',
      deviceId: 'device-a',
      nickname: null,
      displayName: '',
      avatarUrl: null,
      isPublic: true,
      email: '',
      emailVerified: false,
      providers: [],
      isAnonymous: true,
      status: 'active',
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    const deleteRow = renderer.root.findByType('MoreSheet' as never).props.rows.find(
      (row: { key: string }) => row.key === 'delete',
    );
    act(() => {
      deleteRow.onPress();
      jest.runAllTimers();
    });

    expect(mockShowAppDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: cs.account.deleteAnonymousConfirmBody }),
    );
    jest.useRealTimers();
  });

  it('accurately says deletion removes own pub contributions', () => {
    expect(cs.account.deleteConfirmBody).toContain('tvoje příspěvky k hospodám');
    expect(cs.account.deleteAnonymousConfirmBody).toContain('tvoje příspěvky k hospodám');
    expect(cs.account.deleteConfirmBody).toContain('anonymizovaný kontext společných her');
    expect(cs.account.deleteConfirmBody).not.toContain('mohou zůstat anonymně');
  });

  it('leaves a cold-start account deep link without dispatching an invalid back action', async () => {
    mockCanGoBack.mockReturnValue(false);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AccountScreen />);
    });

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.backButton }).props.onPress();
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });
});
