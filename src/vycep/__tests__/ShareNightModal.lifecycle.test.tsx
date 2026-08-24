import React from 'react';
import { Modal } from 'react-native';
import { act, cleanup, render, screen } from '@testing-library/react-native';

import { ShareNightModal } from '@/vycep/ShareNightModal';
import { cs } from '@/i18n/cs';
import { MODAL_DISMISS_MS, useLaunchModalMutex } from '@/stores/launchModalMutex';
import type { NightSummary } from '@/vycep/nightModel';

const mockCaptureRef = jest.fn();
const mockSetImageAsync = jest.fn();
const mockIsSharingAvailable = jest.fn();
const mockShareAsync = jest.fn();
const mockToastShow = jest.fn();

jest.mock('react-native-view-shot', () => ({
  captureRef: (...args: unknown[]) => mockCaptureRef(...args),
}));

jest.mock('expo-clipboard', () => ({
  setImageAsync: (...args: unknown[]) => mockSetImageAsync(...args),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...args: unknown[]) => mockIsSharingAvailable(...args),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: () => null,
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  CopyIcon: () => null,
  Share2Icon: () => null,
}));

jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: mockToastShow }),
}));

jest.mock('@/vycep/NightStoryCard', () => ({
  STICKER_WIDTH: 360,
  stickerHeight: () => 420,
  NightStoryCard: () => null,
}));

const NIGHT: NightSummary = {
  clientKey: '2026-08-20',
  drinkingDay: '2026-08-20',
  startedAt: '2026-08-20T18:00:00.000Z',
  endedAt: '2026-08-20T22:00:00.000Z',
  beerCount: 4,
  wineCount: 0,
  softDrinkCount: 0,
  shotCount: 0,
  pubNames: ['U Zlatého tygra'],
  city: 'Praha',
  durationMinutes: 240,
};

describe('ShareNightModal presentation lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockIsSharingAvailable.mockResolvedValue(true);
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) useLaunchModalMutex.getState().release(holder);
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) act(() => useLaunchModalMutex.getState().release(holder));
    jest.useRealTimers();
  });

  it('holds the global slot until native dismissal and the full safety delay', () => {
    const onClose = jest.fn();
    const view = render(<ShareNightModal visible night={NIGHT} onClose={onClose} />);
    const modal = view.UNSAFE_getByType(Modal);
    const completeNativeDismiss = modal.props.onDismiss as () => void;
    const holder = useLaunchModalMutex.getState().holder;

    expect(holder).not.toBeNull();
    expect(modal.props.visible).toBe(true);

    view.rerender(<ShareNightModal visible={false} night={NIGHT} onClose={onClose} />);
    expect(view.UNSAFE_getByType(Modal).props.visible).toBe(false);
    expect(useLaunchModalMutex.getState().holder).toBe(holder);

    act(() => completeNativeDismiss());
    act(() => jest.advanceTimersByTime(MODAL_DISMISS_MS - 1));
    expect(useLaunchModalMutex.getState().holder).toBe(holder);

    act(() => jest.advanceTimersByTime(1));
    expect(useLaunchModalMutex.getState().holder).toBeNull();
  });

  it('shows export progress and ignores a second tap from the same frame', async () => {
    let finishCapture!: (value: string) => void;
    mockCaptureRef.mockReturnValue(
      new Promise<string>((resolve) => {
        finishCapture = resolve;
      }),
    );
    mockSetImageAsync.mockResolvedValue(undefined);
    render(<ShareNightModal visible night={NIGHT} onClose={jest.fn()} />);

    const copy = screen.getByLabelText(cs.vycep.storyCopyCta);
    act(() => {
      copy.props.onPress();
      copy.props.onPress();
    });

    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    expect(screen.getByText(cs.vycep.storyPreparing)).toBeTruthy();
    expect(screen.getByLabelText(cs.a11y.shareNightButton).props.accessibilityState)
      .toEqual({ disabled: true, busy: false });

    await act(async () => {
      finishCapture('base64-image');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetImageAsync).toHaveBeenCalledWith('base64-image');
    expect(screen.getByText(cs.vycep.storyCopyCta)).toBeTruthy();
  });

  it('invalidates a pending clipboard export when the modal is dismissed', async () => {
    let finishCapture!: (value: string) => void;
    mockCaptureRef.mockReturnValue(
      new Promise<string>((resolve) => {
        finishCapture = resolve;
      }),
    );
    const view = render(<ShareNightModal visible night={NIGHT} onClose={jest.fn()} />);

    act(() => screen.getByLabelText(cs.vycep.storyCopyCta).props.onPress());
    view.rerender(<ShareNightModal visible={false} night={NIGHT} onClose={jest.fn()} />);

    await act(async () => {
      finishCapture('base64-image');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetImageAsync).not.toHaveBeenCalled();
  });

  it('invalidates a pending system share when the modal is dismissed', async () => {
    let finishCapture!: (value: string) => void;
    mockCaptureRef.mockReturnValue(
      new Promise<string>((resolve) => {
        finishCapture = resolve;
      }),
    );
    const view = render(<ShareNightModal visible night={NIGHT} onClose={jest.fn()} />);

    act(() => screen.getByLabelText(cs.a11y.shareNightButton).props.onPress());
    view.rerender(<ShareNightModal visible={false} night={NIGHT} onClose={jest.fn()} />);

    await act(async () => {
      finishCapture('/tmp/night.png');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockIsSharingAvailable).not.toHaveBeenCalled();
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('does not open sharing when dismissal happens during the availability check', async () => {
    let finishAvailability!: (value: boolean) => void;
    mockCaptureRef.mockResolvedValue('/tmp/night.png');
    mockIsSharingAvailable.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishAvailability = resolve;
      }),
    );
    const view = render(<ShareNightModal visible night={NIGHT} onClose={jest.fn()} />);

    act(() => screen.getByLabelText(cs.a11y.shareNightButton).props.onPress());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockIsSharingAvailable).toHaveBeenCalledTimes(1);

    view.rerender(<ShareNightModal visible={false} night={NIGHT} onClose={jest.fn()} />);
    await act(async () => {
      finishAvailability(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('closes while a capture hangs and never lets it copy or toast afterwards', async () => {
    // The capture NEVER resolves — the worst-case hung export. Closing must
    // still work, and the late resolution must stay inert.
    let finishCapture!: (value: string) => void;
    mockCaptureRef.mockReturnValue(
      new Promise<string>((resolve) => {
        finishCapture = resolve;
      }),
    );
    mockSetImageAsync.mockResolvedValue(undefined);
    const onClose = jest.fn();
    const view = render(<ShareNightModal visible night={NIGHT} onClose={onClose} />);

    act(() => screen.getByLabelText(cs.vycep.storyCopyCta).props.onPress());
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);

    act(() => view.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCapture('base64-image');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetImageAsync).not.toHaveBeenCalled();
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it('lets the native close action close a settled export immediately', async () => {
    mockCaptureRef.mockResolvedValue('base64-image');
    mockSetImageAsync.mockResolvedValue(undefined);
    const onClose = jest.fn();
    const view = render(<ShareNightModal visible night={NIGHT} onClose={onClose} />);

    await act(async () => {
      screen.getByLabelText(cs.vycep.storyCopyCta).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => view.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
