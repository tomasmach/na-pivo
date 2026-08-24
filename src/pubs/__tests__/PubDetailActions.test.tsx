import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, ScrollView } from 'react-native';

import { MoreSheet } from '@/components/shared/MoreSheet';
import { persistPubReport } from '@/data/pubReportQueue';
import type { Pub } from '@/data/pubs';
import { cs } from '@/i18n/cs';
import { PubDetailActions } from '@/pubs/PubDetailActions';

const mockPush = jest.fn();
const mockAddReportedPub = jest.fn();
const mockBumpCatalogRevision = jest.fn();
const mockShowToast = jest.fn();
const mockShowAppDialog = jest.fn();
let mockSignedIn = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));

jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: (props: React.ComponentProps<typeof Pressable>) => <Pressable {...props} />,
}));

jest.mock('@/components/shared/GlassIconButton', () => ({
  GlassIconButton: ({ children, ...props }: React.ComponentProps<typeof Pressable>) => (
    <Pressable {...props}>{children}</Pressable>
  ),
}));

jest.mock('@/components/shared/KeyboardAwareScrollView', () => ({
  KeyboardAwareScrollView: ({ children, ...props }: React.ComponentProps<typeof ScrollView>) => (
    <ScrollView {...props}>{children}</ScrollView>
  ),
}));

jest.mock('@/components/shared/MoreSheet', () => ({ MoreSheet: jest.fn(() => null) }));

jest.mock('@/components/shared/AppDialog', () => ({
  showAppDialog: (options: unknown) => mockShowAppDialog(options),
}));

jest.mock('@/components/shared/IconGlyph', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Icon = (props: Record<string, unknown>) => React.createElement(View, props);
  return {
    ClockIcon: Icon,
    EllipsisIcon: Icon,
    FlagIcon: Icon,
    PencilIcon: Icon,
    TriangleAlertIcon: Icon,
  };
});

jest.mock('@/stores/accountStore', () => ({
  selectIsSignedIn: (state: { signedIn: boolean }) => state.signedIn,
  useAccountStore: (selector: (state: { signedIn: boolean }) => unknown) =>
    selector({ signedIn: mockSignedIn }),
}));

jest.mock('@/stores/pubStore', () => ({
  usePubStore: Object.assign(
    (selector: (state: { addReportedPub: typeof mockAddReportedPub }) => unknown) =>
      selector({ addReportedPub: mockAddReportedPub }),
    { getState: () => ({ bumpCatalogRevision: mockBumpCatalogRevision }) },
  ),
}));

jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));

jest.mock('@/data/pubs', () => ({
  clearPubsSnapshot: jest.fn(async () => undefined),
  renameLocalPub: jest.fn(),
}));

jest.mock('@/data/pubNameCorrectionsClient', () => ({
  buildPubNameCorrectionEntry: jest.fn(() => ({ client_id: 'correction-1' })),
}));

jest.mock('@/data/pubNameCorrectionsQueue', () => ({
  persistPubNameCorrection: jest.fn(async () => ({
    persisted: true,
    sync: Promise.resolve('synced'),
  })),
}));

jest.mock('@/data/pubReportQueue', () => ({ persistPubReport: jest.fn(async () => true) }));

const mockedMoreSheet = MoreSheet as jest.MockedFunction<typeof MoreSheet>;
const mockedPersistPubReport = persistPubReport as jest.MockedFunction<typeof persistPubReport>;

const PUB = {
  id: 'pub-1',
  name: 'U Testu',
  lat: 50.087,
  lng: 14.421,
  city: 'Praha',
  address: 'Testovací 1',
};

function latestMoreSheetProps() {
  return mockedMoreSheet.mock.calls.at(-1)?.[0];
}

describe('PubDetailActions', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSignedIn = true;
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = undefined;
    }
    jest.useRealTimers();
  });

  function render(pub: Pub = PUB, onReported = jest.fn()) {
    act(() => {
      renderer = TestRenderer.create(
        <PubDetailActions
          pub={pub}
          displayName={pub.name}
          onRenamed={jest.fn()}
          onReported={onReported}
        />,
      );
    });
    return { renderer: renderer!, onReported };
  }

  it('offers rename for a catalog pub and edit for an owned pub', () => {
    render();
    expect(latestMoreSheetProps()?.rows.map((row) => row.label)).toEqual([
      cs.pubDetail.eventSuggest,
      cs.pubDetail.renameAction,
      cs.pubDetail.reportAction,
    ]);

    act(() => renderer?.unmount());
    renderer = undefined;
    render({ ...PUB, userAddedClientId: 'mine-1' });
    expect(latestMoreSheetProps()?.rows.map((row) => row.label)).toContain(
      cs.pubDetail.editOwnedAction,
    );
  });

  it('routes a signed-out event suggestion to login', () => {
    mockSignedIn = false;
    render();

    act(() => {
      latestMoreSheetProps()?.rows[0]?.onPress();
      jest.advanceTimersByTime(240);
    });

    expect(mockPush).toHaveBeenCalledWith('/auth');
  });

  it('hides a reported pub only after its report was persisted', async () => {
    let resolveReport!: (synced: boolean) => void;
    mockedPersistPubReport.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveReport = resolve;
      }),
    );
    const onReported = jest.fn();
    render(PUB, onReported);

    act(() => {
      latestMoreSheetProps()?.rows.find((row) => row.key === 'report')?.onPress();
      jest.advanceTimersByTime(240);
    });
    const closedReason = renderer!.root.findByProps({ children: cs.pubDetail.reportClosed });
    act(() => {
      closedReason.parent?.props.onPress();
      jest.advanceTimersByTime(240);
    });

    expect(mockedPersistPubReport).not.toHaveBeenCalled();
    const dialog = mockShowAppDialog.mock.calls.at(-1)?.[0] as {
      buttons: { style?: string; onPress?: () => void }[];
    };
    act(() => dialog.buttons.find((button) => button.style === 'destructive')?.onPress?.());

    expect(mockedPersistPubReport).toHaveBeenCalledWith(PUB, 'closed');
    expect(mockAddReportedPub).not.toHaveBeenCalled();
    expect(onReported).not.toHaveBeenCalled();

    await act(async () => {
      resolveReport(true);
      await Promise.resolve();
    });

    expect(mockAddReportedPub).toHaveBeenCalledWith(PUB.id, expect.any(String));
    expect(onReported).toHaveBeenCalledTimes(1);
  });
});
