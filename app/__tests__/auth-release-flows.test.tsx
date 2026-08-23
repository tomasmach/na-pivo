import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { cs } from '@/i18n/cs';

import AuthScreen from '../auth/index';
import ResetPasswordScreen from '../auth/reset';
import VerifyEmailScreen from '../auth/verify';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
let mockSearchParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: (props: Record<string, unknown>) => React.createElement('GlowButton', props),
}));

jest.mock('@/components/shared/KeyboardAwareScrollView', () => ({
  KeyboardAwareScrollView: (props: { children?: React.ReactNode }) =>
    React.createElement('KeyboardAwareScrollView', props, props.children),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
}));

jest.mock('@/components/shared/BrandIcon', () => ({
  AppleIcon: () => null,
  GoogleIcon: () => null,
}));

jest.mock('@/profile/NicknameField', () => ({
  NicknameField: (props: Record<string, unknown>) =>
    React.createElement('NicknameField', props),
}));

jest.mock('@/data/socialAuth', () => ({
  isAppleSignInSupported: () => false,
  isGoogleSignInConfigured: () => true,
}));

jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));

const accountState = {
  status: 'ready',
  register: jest.fn(),
  login: jest.fn(),
  signInGoogle: jest.fn(),
  signInApple: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  verifyEmail: jest.fn(),
  updateProfile: jest.fn(),
};

jest.mock('@/stores/accountStore', () => ({
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

function glowButton(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
): TestRenderer.ReactTestInstance {
  return renderer.root
    .findAllByType('GlowButton' as never)
    .find((node) => node.props.label === label)!;
}

describe('authentication release flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
    accountState.status = 'ready';
    accountState.updateProfile.mockResolvedValue({ ok: true, profile: {} });
    mockCanGoBack.mockReturnValue(true);
  });

  it('sends one password-reset request when the user taps twice quickly', async () => {
    const pending = deferred<{ ok: true }>();
    accountState.requestPasswordReset.mockReturnValue(pending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AuthScreen />);
    });

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.authTabLogin }).props.onPress();
    });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.authForgotPassword }).props.onPress();
    });
    act(() => {
      renderer.root
        .findByProps({ accessibilityLabel: cs.a11y.authResetEmailInput })
        .props.onChangeText('pivar@example.cz');
    });

    const send = glowButton(renderer, cs.account.resetSend);
    act(() => {
      void send.props.onPress();
      void send.props.onPress();
    });

    expect(accountState.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(send.props.loading).toBe(true);

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
  });

  it('starts one e-mail login when the primary button is double-tapped', async () => {
    const pending = deferred<{ ok: true; profile: Record<string, unknown> }>();
    accountState.login.mockReturnValue(pending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AuthScreen />);
    });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.authTabLogin }).props.onPress();
      renderer.root
        .findByProps({ accessibilityLabel: cs.a11y.authEmailInput })
        .props.onChangeText('pivar@example.cz');
      renderer.root
        .findByProps({ accessibilityLabel: cs.a11y.authPasswordInput })
        .props.onChangeText('osmznaku');
    });

    const submit = glowButton(renderer, cs.account.submitLogin);
    act(() => {
      void submit.props.onPress();
      void submit.props.onPress();
    });

    expect(accountState.login).toHaveBeenCalledTimes(1);
    expect(submit.props.loading).toBe(true);

    await act(async () => {
      pending.resolve({ ok: true, profile: {} });
      await pending.promise;
    });
  });

  it('starts one reset-password mutation when the deep-link CTA is double-tapped', async () => {
    mockSearchParams = { token: 'one-time-token' };
    const pending = deferred<{ ok: true; profile: Record<string, unknown> }>();
    accountState.resetPassword.mockReturnValue(pending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ResetPasswordScreen />);
    });
    act(() => {
      renderer.root
        .findByProps({ accessibilityLabel: cs.a11y.authNewPasswordInput })
        .props.onChangeText('osmznaku');
    });

    const submit = glowButton(renderer, cs.account.resetSubmit);
    act(() => {
      void submit.props.onPress();
      void submit.props.onPress();
    });

    expect(accountState.resetPassword).toHaveBeenCalledTimes(1);
    expect(submit.props.loading).toBe(true);

    await act(async () => {
      pending.resolve({ ok: true, profile: {} });
      await pending.promise;
    });
  });

  it('verifies a new token when another verification link replaces the current params', async () => {
    mockSearchParams = { token: 'first-token' };
    accountState.verifyEmail.mockResolvedValue({ ok: true });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<VerifyEmailScreen />);
      await Promise.resolve();
    });
    expect(accountState.verifyEmail).toHaveBeenCalledWith('first-token');

    mockSearchParams = { token: 'second-token' };
    await act(async () => {
      renderer.update(<VerifyEmailScreen />);
      await Promise.resolve();
    });

    expect(accountState.verifyEmail).toHaveBeenCalledWith('second-token');
  });

  it('keeps observing an in-flight verification when the effect is restarted', async () => {
    mockSearchParams = { token: 'one-token' };
    const pending = deferred<{ ok: true }>();
    const firstVerify = jest.fn(() => pending.promise);
    accountState.verifyEmail = firstVerify;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<VerifyEmailScreen />);
    });

    accountState.verifyEmail = jest.fn(() => pending.promise);
    await act(async () => {
      renderer.update(<VerifyEmailScreen />);
    });

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });

    expect(firstVerify).toHaveBeenCalledTimes(1);
    expect(accountState.verifyEmail).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ children: cs.account.verifySuccessTitle })).toBeTruthy();
  });

  it('leaves a cold-start auth deep link without dispatching an invalid back action', async () => {
    mockCanGoBack.mockReturnValue(false);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AuthScreen />);
    });

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.backButton }).props.onPress();
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });
});
