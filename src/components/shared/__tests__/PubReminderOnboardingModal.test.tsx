import React from 'react';

import {
  PubReminderBackgroundLocationDisclosure,
  PubReminderOnboardingModal,
  pubReminderNeedsBackgroundDisclosure,
} from '../PubReminderOnboardingModal';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEnable = jest.fn();
const mockSetPubReminderEnabled = jest.fn();
const mockGetBackgroundPermissions = jest.fn();

jest.mock('expo-location', () => ({
  getBackgroundPermissionsAsync: (...args: unknown[]) =>
    mockGetBackgroundPermissions(...args),
}));

jest.mock('@/components/shared/BottomSheetModal', () => {
  const ReactModule = jest.requireActual('react');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? ReactModule.createElement('SheetSurface', null, children) : null,
  };
});

jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => {
  const icon = () => null;
  return { BellRingIcon: icon, MapPinIcon: icon, ShieldIcon: icon };
});
jest.mock('@/data/releaseNotesClient', () => ({
  getCurrentAppVersion: () => '3.0.0',
}));
jest.mock('@/notifications/pubReminderEnableFailure', () => ({
  showPubReminderEnableFailure: jest.fn(),
}));
jest.mock('@/notifications/pubReminderNotifications', () => ({
  enablePubReminderNotifications: (...args: unknown[]) => mockEnable(...args),
}));
jest.mock('@/notifications/pubReminderOnboarding', () => ({
  getSeenPubReminderOnboardingVersion: jest.fn(async () => null),
  markPubReminderOnboardingSeen: jest.fn(async () => undefined),
  shouldShowPubReminderOnboarding: jest.fn(() => true),
}));
jest.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: (selector: (state: { firstLaunchSession: boolean }) => unknown) =>
    selector({ firstLaunchSession: false }),
}));
jest.mock('@/stores/releaseStore', () => ({
  useReleaseStore: (selector: (state: { checkSettled: boolean; pendingNote: unknown }) => unknown) =>
    selector({ checkSettled: true, pendingNote: null }),
}));
jest.mock('@/stores/settingsStore', () => {
  const mockState = {
    pubReminderEnabled: false,
    // Deferred so the factory can run before the test body initializes mocks.
    setPubReminderEnabled: (...args: unknown[]) => mockSetPubReminderEnabled(...args),
  };
  const useSettingsStore = Object.assign(
    (selector: (state: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState },
  );
  return {
    useSettingsStore,
    waitForSettingsHydration: jest.fn(async () => undefined),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

// The modal delays its own appearance by a real 600 ms timer so it never
// flashes on launch. Fake timers drive that real delay deterministically.
const settleModal = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    jest.advanceTimersByTime(600);
  });
};

describe('background-location prominent disclosure', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEnable.mockReset().mockResolvedValue({ ok: true });
    mockSetPubReminderEnabled.mockReset();
    mockGetBackgroundPermissions.mockReset().mockResolvedValue({ status: 'undetermined' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('states location, closed-app access and the reminder purpose in the copy', () => {
    const body = cs.pubReminderOnboarding.backgroundDisclosureBody;
    expect(body).toMatch(/poloh/i);
    expect(body).toMatch(/zavřená|nepoužíváš/i);
    expect(body).toMatch(/připomínk/i);
    expect(body).toMatch(/hospod/i);
    expect(cs.pubReminderOnboarding.backgroundDisclosureConfirm).not.toBe('');
  });

  it('renders the disclosure with allow and deny actions', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <PubReminderBackgroundLocationDisclosure
          visible
          onAllow={jest.fn()}
          onDeny={jest.fn()}
        />,
      );
    });

    const texts = renderer.root
      .findAllByType('Text')
      .map((node: { props: { children?: unknown } }) => node.props.children);
    expect(texts).toContain(cs.pubReminderOnboarding.backgroundDisclosureTitle);
    expect(texts).toContain(cs.pubReminderOnboarding.backgroundDisclosureBody);
    expect(
      renderer!.root.findByProps({
        accessibilityLabel: cs.pubReminderOnboarding.backgroundDisclosureConfirm,
      }),
    ).toBeTruthy();
    expect(
      renderer!.root.findByProps({
        accessibilityLabel: cs.pubReminderOnboarding.backgroundDisclosureDeny,
      }),
    ).toBeTruthy();
  });

  it('shows the disclosure BEFORE the permission flow when the prompt will appear', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<PubReminderOnboardingModal />);
      await Promise.resolve();
    });
    await settleModal();

    const cta = renderer!.root.findByProps({ accessibilityLabel: cs.pubReminderOnboarding.cta });
    expect(mockGetBackgroundPermissions).not.toHaveBeenCalled();

    await act(async () => {
      void cta.props.onPress();
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    // Disclosure gate ran first; no native permission flow started.
    expect(mockGetBackgroundPermissions).toHaveBeenCalledTimes(1);
    expect(mockEnable).not.toHaveBeenCalled();

    // The reasons sheet hides while the disclosure is up — never two sheets
    // stacked at once.
    const surfaces = renderer!.root.findAllByType('SheetSurface');
    expect(surfaces).toHaveLength(1);

    const confirm = renderer!.root.findByProps({
      accessibilityLabel: cs.pubReminderOnboarding.backgroundDisclosureConfirm,
    });
    await act(async () => {
      confirm.props.onPress();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    expect(mockEnable).toHaveBeenCalledTimes(1);
    expect(mockSetPubReminderEnabled).toHaveBeenCalledWith(true);

    // Call-order proof: the permission-status gate strictly precedes anything
    // that can reach requestBackgroundPermissionsAsync inside enable.
    expect(mockGetBackgroundPermissions.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnable.mock.invocationCallOrder[0],
    );
  });

  it('enables directly when background permission is already granted', async () => {
    mockGetBackgroundPermissions.mockResolvedValue({ status: 'granted' });
    expect(await pubReminderNeedsBackgroundDisclosure()).toBe(false);

    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<PubReminderOnboardingModal />);
      await Promise.resolve();
    });
    await settleModal();
    const cta = renderer!.root.findByProps({ accessibilityLabel: cs.pubReminderOnboarding.cta });
    await act(async () => {
      void cta.props.onPress();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    expect(mockEnable).toHaveBeenCalledTimes(1);
  });
});
