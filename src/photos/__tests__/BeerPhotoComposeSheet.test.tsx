

import React from 'react';

import { BeerPhotoComposeSheet } from '@/photos/BeerPhotoComposeSheet';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEnqueueBeerPhoto = jest.fn();
const mockPersistBeerPhotoLocally = jest.fn(
  async (_pickedUri: string, _clientId: string) => 'file:///docs/beer-photos/client-1.jpg',
);
const mockDeleteBeerPhotoLocalFile = jest.fn((_clientId: string) => undefined);
const mockResolveBeerPhotoPartyAssociation: jest.Mock<
  Promise<boolean>,
  [string, string | null]
> = jest.fn(async (_pendingCode: string, _confirmedCode: string | null) => true);
const mockShowToast = jest.fn();

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));

jest.mock('@/data/beerPhotosQueue', () => ({
  enqueueBeerPhoto: (...args: unknown[]) => mockEnqueueBeerPhoto(...args),
  persistBeerPhotoLocally: (...args: unknown[]) =>
    mockPersistBeerPhotoLocally(...(args as [string, string])),
  deleteBeerPhotoLocalFile: (...args: unknown[]) =>
    mockDeleteBeerPhotoLocalFile(...(args as [string])),
  resolveBeerPhotoPartyAssociation: (...args: unknown[]) =>
    mockResolveBeerPhotoPartyAssociation(...(args as [string, string | null])),
}));
jest.mock('@/data/account', () => ({ generateUuidV4: () => 'client-1' }));
jest.mock('@/data/geohash', () => ({ geohash8: () => 'u2fkbn9x' }));
jest.mock('@/components/shared/GlowButton', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    GlowButton: (props: Record<string, unknown>) => ReactModule.createElement('GlowButton', props),
  };
});
jest.mock('@/components/shared/IconGlyph', () => ({
  EyeOffIcon: () => null,
  InfoIcon: () => null,
  MapPinIcon: () => null,
  TrophyIcon: () => null,
  UsersIcon: () => null,
  XIcon: () => null,
}));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    KeyboardAwareScrollView: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement('KeyboardAwareScrollView', null, children),
  };
});
jest.mock('@/counter/PubPickerModal', () => ({ PubPickerModal: () => null }));
jest.mock('@/counter/useNearbyPub', () => ({
  useNearbyPub: () => ({
    candidates: [],
    selected: null,
    permissionState: 'granted',
    requestPermission: jest.fn(),
  }),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ hapticEnabled: false }) },
}));
jest.mock('@/stores/tallyStore', () => ({
  useTallyStore: { getState: () => ({ current: null }) },
}));
const mockPartyState: {
  evening: { joinCode: string } | null;
  confirmedIdentity: { joinCode: string } | null;
  pendingJoinCode: string | null;
} = {
  evening: null,
  confirmedIdentity: null,
  pendingJoinCode: 'PIVOXY',
};
jest.mock('@/stores/partyEveningStore', () => ({
  usePartyEveningStore: { getState: () => mockPartyState },
  selectConfirmedPartyJoinCode: (state: typeof mockPartyState) =>
    state.evening?.joinCode ?? state.confirmedIdentity?.joinCode ?? null,
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));
jest.mock('@/utils/haptics', () => ({ fireSuccessHaptic: jest.fn() }));
jest.mock('@/utils/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

describe('BeerPhotoComposeSheet durable save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnqueueBeerPhoto.mockResolvedValue({
      persisted: false,
      completion: Promise.resolve(),
    });
  });

  it('uses the canonical glow-free primary action', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(
        <BeerPhotoComposeSheet
          pickedUri="file:///cache/picked.jpg"
          onClose={jest.fn()}
          onSaved={jest.fn()}
        />,
      );
    });

    expect(renderer!.root.findByType('GlowButton').props.glow).toBe('none');
  });

  it('stays open and does not confirm a photo whose queue write failed', async () => {
    const onClose = jest.fn();
    const onSaved = jest.fn();
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(
        <BeerPhotoComposeSheet
          pickedUri="file:///cache/picked.jpg"
          onClose={onClose}
          onSaved={onSaved}
          partyDrinkingDay="2026-08-05"
        />,
      );
    });

    await act(async () => {
      renderer!.root.findByType('GlowButton').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockEnqueueBeerPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        partyDrinkingDay: '2026-08-05',
      }),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockDeleteBeerPhotoLocalFile).toHaveBeenCalledWith('client-1');
    expect(mockShowToast).toHaveBeenCalledWith(cs.photoDiary.errorSave, expect.any(Object));
    expect(renderer!.root.findByType('GlowButton')).toBeTruthy();
  });

  it('durably defers party association while the table create is still pending', async () => {
    mockEnqueueBeerPhoto.mockResolvedValueOnce({
      persisted: true,
      completion: Promise.resolve(),
    });
    const onSaved = jest.fn();
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(
        <BeerPhotoComposeSheet
          pickedUri="file:///cache/picked.jpg"
          onClose={jest.fn()}
          onSaved={onSaved}
          partyCode={null}
          pendingPartyCode="PIVOXY"
          partyDrinkingDay="2026-08-05"
        />,
      );
    });

    await act(async () => {
      renderer!.root.findByType('GlowButton').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockEnqueueBeerPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        partyCode: undefined,
        pendingPartyCode: 'PIVOXY',
      }),
    );
    expect(mockResolveBeerPhotoPartyAssociation).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
