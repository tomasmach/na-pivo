import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: mockReplace })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: jest.fn(() => null),
}));

jest.mock('@/components/shared/IconGlyph', () => {
  const ReactModule = require('react');
  const Native = require('react-native');
  const Icon = () => ReactModule.createElement(Native.View);
  return {
    CheckIcon: Icon,
    EyeIcon: Icon,
    LockKeyholeIcon: Icon,
    ShieldIcon: Icon,
  };
});

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { bold: 'display-bold', extrabold: 'display-extrabold' },
    ui: { regular: 'ui-regular', medium: 'ui-medium', semibold: 'ui-semibold' },
  },
  FontScaleCap: { heading: 1.2, body: 1.3 },
}));

import { GlowButton } from '@/components/shared/GlowButton';
import { useAccountStore } from '@/stores/accountStore';
import ProfilePrivacyScreen from '../profile/privacy';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const mockGlowButton = GlowButton as unknown as jest.Mock;

function primaryProps(): { onPress: () => Promise<void>; label: string } {
  const calls = mockGlowButton.mock.calls;
  return calls[calls.length - 1][0];
}

describe('ProfilePrivacyScreen', () => {
  let renderer: { unmount: () => void; root: any } | undefined;
  const updateProfile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    updateProfile.mockResolvedValue({ ok: true, profile: {} });
    useAccountStore.setState({
      profile: {
        id: 'account-1',
        deviceId: 'device-1',
        nickname: null,
        displayName: 'Pepa',
        avatarUrl: null,
        isPublic: true,
        email: 'pepa@example.com',
        emailVerified: true,
        providers: ['email'],
        isAnonymous: false,
        status: 'active',
      },
      updateProfile,
    });
  });

  afterEach(() => {
    if (!renderer) return;
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  async function render() {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ProfilePrivacyScreen));
      await Promise.resolve();
    });
  }

  async function choosePrivate() {
    const privateChoice = renderer!.root.findAll(
      (node: { props: Record<string, unknown> }) =>
        node.props.accessibilityRole === 'radio' &&
        String(node.props.accessibilityLabel).startsWith('Jen pro partu.'),
    )[0];
    await act(async () => {
      privateChoice.props.onPress();
      await Promise.resolve();
    });
  }

  it('continues immediately when the current public setting is kept', async () => {
    await render();

    await act(async () => {
      await primaryProps().onPress();
    });

    expect(updateProfile).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('saves a private choice before entering the app', async () => {
    await render();
    await choosePrivate();

    await act(async () => {
      await primaryProps().onPress();
    });

    expect(updateProfile).toHaveBeenCalledWith({ isPublic: false });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('offers an explicit exit after a failed save instead of trapping the user', async () => {
    updateProfile.mockResolvedValueOnce({
      ok: false,
      code: 'network',
      detail: 'Nepodařilo se spojit se serverem.',
    });
    await render();
    await choosePrivate();

    await act(async () => {
      await primaryProps().onPress();
    });

    expect(mockReplace).not.toHaveBeenCalled();
    const continueWithoutChange = renderer!.root.findAll(
      (node: { props: Record<string, unknown> }) =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Pokračovat beze změny',
    )[0];

    await act(async () => {
      continueWithoutChange.props.onPress();
      await Promise.resolve();
    });

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });
});
