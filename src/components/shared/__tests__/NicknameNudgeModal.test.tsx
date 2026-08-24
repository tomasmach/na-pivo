import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { cs } from '@/i18n/cs';
import { NicknameNudgeModal } from '@/components/shared/NicknameNudgeModal';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { markNicknameNudgeSeen } from '@/profile/nicknameNudge';

const mockUpdateProfile = jest.fn();
const mockShowToast = jest.fn();

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return { ...actual, ScrollView: 'ScrollView' };
});
jest.mock('@/components/shared/BottomSheetModal', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    BottomSheetModal: jest.fn(({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    ),
  };
});
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/profile/NicknameField', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { TextInput } = jest.requireMock('react-native') as typeof import('react-native');
  return {
    NicknameField: ({
      value,
      onChangeText,
      onReadyChange,
    }: {
      value: string;
      onChangeText: (value: string) => void;
      onReadyChange: (ready: boolean) => void;
    }) => {
      React.useEffect(() => onReadyChange(value.length > 0), [onReadyChange, value]);
      return React.createElement(TextInput, { testID: 'nickname', value, onChangeText });
    },
  };
});
jest.mock('@/profile/nicknameNudge', () => ({
  getSeenNicknameNudgeVersion: jest.fn(async () => null),
  markNicknameNudgeSeen: jest.fn(async () => undefined),
  shouldShowNicknameNudge: jest.fn(() => true),
}));
jest.mock('@/data/releaseNotesClient', () => ({ getCurrentAppVersion: () => '3.0.0' }));
jest.mock('@/stores/accountStore', () => ({
  selectNeedsNickname: () => true,
  useAccountStore: (selector: (state: { updateProfile: typeof mockUpdateProfile }) => unknown) =>
    selector({ updateProfile: mockUpdateProfile }),
}));
jest.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: (selector: (state: { firstLaunchSession: boolean }) => unknown) =>
    selector({ firstLaunchSession: false }),
}));
jest.mock('@/stores/releaseStore', () => ({
  useReleaseStore: (selector: (state: { checkSettled: boolean; pendingNote: null }) => unknown) =>
    selector({ checkSettled: true, pendingNote: null }),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockedBottomSheet = BottomSheetModal as jest.Mock;
const mockedMarkSeen = markNicknameNudgeSeen as jest.Mock;

function latestSheetProps() {
  return mockedBottomSheet.mock.calls.at(-1)?.[0];
}

describe('NicknameNudgeModal save lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('cannot be marked seen or hidden while a save is in flight', async () => {
    let resolveUpdate!: (value: { ok: false; detail: string }) => void;
    mockUpdateProfile.mockImplementation(
      () => new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const screen = render(<NicknameNudgeModal />);
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(600));
    expect(latestSheetProps().visible).toBe(true);

    fireEvent.changeText(screen.getByTestId('nickname'), 'pepa');
    fireEvent.press(screen.getByLabelText(cs.nicknameNudge.cta));
    act(() => latestSheetProps().onClose());

    expect(mockedMarkSeen).not.toHaveBeenCalled();
    expect(latestSheetProps().visible).toBe(true);

    await act(async () => resolveUpdate({ ok: false, detail: 'Přezdívka je zabraná.' }));
    expect(screen.getByText('Přezdívka je zabraná.')).toBeTruthy();
    expect(latestSheetProps().visible).toBe(true);

    act(() => latestSheetProps().onClose());
    expect(mockedMarkSeen).toHaveBeenCalledWith('3.0.0');
    expect(latestSheetProps().visible).toBe(false);
  });
});
