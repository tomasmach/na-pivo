import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable } from 'react-native';

import { ReportPubModal } from '@/components/compass/ReportPubModal';
import { cs } from '@/i18n/cs';

const showAppDialog = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({
  showAppDialog: (options: unknown) => showAppDialog(options),
}));
jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: (props: React.ComponentProps<typeof Pressable>) => <Pressable {...props} />,
}));
jest.mock('@/components/shared/IconGlyph', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Icon = (props: Record<string, unknown>) => React.createElement(View, props);
  return { FlagIcon: Icon, MapPinPlusIcon: Icon, PencilIcon: Icon, Trash2Icon: Icon };
});

describe('ReportPubModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    showAppDialog.mockClear();
  });

  afterEach(() => jest.useRealTimers());

  it('requires confirmation before sending a global removal report', () => {
    const onReportReason = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ReportPubModal
          visible
          pubName="U Testu"
          onClose={jest.fn()}
          onAddPub={jest.fn()}
          onRename={jest.fn()}
          onReportReason={onReportReason}
        />,
      );
    });

    const remove = renderer.root.findByProps({ children: cs.compass.reportNotPub });
    act(() => {
      remove.parent?.props.onPress();
      jest.advanceTimersByTime(260);
    });

    expect(onReportReason).not.toHaveBeenCalled();
    const dialog = showAppDialog.mock.calls.at(-1)?.[0] as {
      title: string;
      buttons: { style?: string; onPress?: () => void }[];
    };
    expect(dialog.title).toBe('Nahlásit „U Testu“?');
    act(() => dialog.buttons.find((button) => button.style === 'destructive')?.onPress?.());
    expect(onReportReason).toHaveBeenCalledWith('not_pub');

    act(() => renderer.unmount());
  });
});
