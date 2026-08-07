import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { InviteSheet } from '@/party/InviteSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null, CopyIcon: () => null }));
jest.mock('@/data/friendsClient', () => ({
  fetchFriendsDashboard: jest.fn(async () => null),
}));
jest.mock('@/data/friendsSnapshot', () => ({
  loadFriendsDashboardSnapshot: jest.fn(async () => null),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));
jest.mock('react-native-qrcode-svg', () => () => null);

const baseProps = {
  visible: true,
  presentIds: [],
  code: null,
  link: null,
  creationError: null,
  onRetry: jest.fn(),
  onClose: jest.fn(),
};

describe('InviteSheet evening creation', () => {
  it('shows progress only while creation is actually running', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<InviteSheet {...baseProps} creating />);
    });

    expect(renderer!.root.findByProps({ children: 'Kód se zakládá. Chvilku.' })).toBeTruthy();
    expect(
      renderer!.root.findAllByProps({ accessibilityLabel: 'Zkusit založit kód znovu' }),
    ).toHaveLength(0);
  });

  it('shows an offline-safe failure and retries creation', async () => {
    const onRetry = jest.fn();
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(
        <InviteSheet
          {...baseProps}
          creating={false}
          creationError="Síť se netváří. Zkus to za chvíli."
          onRetry={onRetry}
        />,
      );
    });

    expect(
      renderer!.root.findByProps({
        children: 'Na kód potřebuješ signál. Pivo si dál zapisuješ i bez něj.',
      }),
    ).toBeTruthy();
    const retry = renderer!.root.findByProps({
      accessibilityLabel: 'Zkusit založit kód znovu',
    });
    await act(async () => retry.props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
