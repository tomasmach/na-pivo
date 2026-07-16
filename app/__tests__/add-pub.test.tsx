import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { cs } from '@/i18n/cs';
import AddPubScreen from '../add-pub';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockSearchParams: Record<string, string> = {};
const mockBack: jest.Mock = jest.fn();
const mockBumpCatalogRevision: jest.Mock = jest.fn();
const mockShowToast: jest.Mock = jest.fn();
const mockEnsureLocationPermission: jest.Mock = jest.fn(async () => 'granted');
const mockOpenSystemSettings: jest.Mock = jest.fn(async () => undefined);
const mockGetCurrentPositionAsync: jest.Mock = jest.fn(async () => ({
  coords: { latitude: 48.1486, longitude: 17.1077 },
}));
const mockEnqueueAddedPub: jest.Mock = jest.fn(async () => true);
const mockClearPubsSnapshot: jest.Mock = jest.fn(async () => undefined);
const mockPubIdForCoords: jest.Mock = jest.fn((lat: number, lng: number) => `local:${lat}:${lng}`);
const mockUpsertLocalPub: jest.Mock = jest.fn();
const mockFireSuccessHaptic: jest.Mock = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    back: mockBack,
  })),
  useLocalSearchParams: jest.fn(() => mockSearchParams),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })),
}));

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  getCurrentPositionAsync: (options: unknown) => mockGetCurrentPositionAsync(options),
}));

jest.mock('@/compass/permissions', () => ({
  ensureLocationPermission: () => mockEnsureLocationPermission(),
  openSystemSettings: () => mockOpenSystemSettings(),
}));

jest.mock('@/components/shared/GlowButton', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    GlowButton: jest.fn(
      ({
        label,
        onPress,
        accessibilityLabel,
      }: {
        label: string;
        onPress: () => void;
        accessibilityLabel?: string;
      }) =>
        React.createElement(
          'Pressable',
          { accessibilityRole: 'button', accessibilityLabel, onPress },
          React.createElement('Text', null, label),
        ),
    ),
  };
});

jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: jest.fn(() => null),
  ChevronLeftIcon: jest.fn(() => null),
  MapPinIcon: jest.fn(() => null),
  TargetIcon: jest.fn(() => null),
}));

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: {
      extrabold: 'display-extrabold',
    },
    ui: {
      regular: 'ui-regular',
      medium: 'ui-medium',
      semibold: 'ui-semibold',
      bold: 'ui-bold',
    },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock('@/data/account', () => ({
  generateUuidV4: jest.fn(() => 'uuid-fixed'),
}));

jest.mock('@/data/addedPubsQueue', () => ({
  enqueueAddedPub: (entry: unknown) => mockEnqueueAddedPub(entry),
}));

jest.mock('@/data/pubs', () => ({
  clearPubsSnapshot: () => mockClearPubsSnapshot(),
  pubIdForCoords: (...args: [number, number]) => mockPubIdForCoords(...args),
  upsertLocalPub: (pub: unknown) => mockUpsertLocalPub(pub),
}));

jest.mock('@/stores/pubStore', () => ({
  usePubStore: (selector: (state: { bumpCatalogRevision: () => void }) => unknown) =>
    selector({ bumpCatalogRevision: mockBumpCatalogRevision }),
}));

jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: mockShowToast }),
}));

jest.mock('@/utils/haptics', () => ({
  fireSuccessHaptic: () => mockFireSuccessHaptic(),
}));

describe('AddPubScreen', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {
      lat: '50.087',
      lng: '14.421',
      city: 'Praha',
    };
    mockEnsureLocationPermission.mockResolvedValue('granted');
    mockOpenSystemSettings.mockResolvedValue(undefined);
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 48.1486, longitude: 17.1077 },
    });
  });

  afterEach(() => {
    if (!renderer) return;

    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
  });

  function renderScreen() {
    act(() => {
      renderer = TestRenderer.create(<AddPubScreen />);
    });
    return renderer!;
  }

  async function submit() {
    const saveButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubSaveButton,
    });

    await act(async () => {
      saveButton.props.onPress();
      await Promise.resolve();
    });
  }

  it('saves with current GPS coordinates when the user explicitly selects current location', async () => {
    renderScreen();

    const currentLocationButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubUseCurrentLocationButton,
    });
    const nameInput = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubNameInput,
    });

    act(() => {
      currentLocationButton.props.onPress();
      nameInput.props.onChangeText('Hospoda Bez Mapy');
    });
    await submit();

    expect(mockEnsureLocationPermission).not.toHaveBeenCalled();
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockUpsertLocalPub).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'local:50.087:14.421',
        name: 'Hospoda Bez Mapy',
        lat: 50.087,
        lng: 14.421,
        city: 'Praha',
      }),
    );
    expect(mockEnqueueAddedPub).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'uuid-fixed',
        name: 'Hospoda Bez Mapy',
        lat: 50.087,
        lng: 14.421,
        city: 'Praha',
      }),
    );
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('lets the user clear the current location selection', () => {
    renderScreen();

    const currentLocationButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubUseCurrentLocationButton,
    });

    act(() => {
      currentLocationButton.props.onPress();
    });

    const selectedCurrentLocationButton = renderer!.root
      .findAllByProps({
        accessibilityLabel: cs.a11y.addPubCurrentLocationSelected,
      })
      .find((node) => typeof node.props.onPress === 'function');

    expect(selectedCurrentLocationButton).toBeDefined();

    act(() => {
      selectedCurrentLocationButton!.props.onPress();
    });

    expect(
      renderer!.root.findAllByProps({
        accessibilityLabel: cs.a11y.addPubCurrentLocationSelected,
      }),
    ).toHaveLength(0);
    expect(
      renderer!.root.findAllByProps({
        accessibilityLabel: cs.a11y.addPubUseCurrentLocationButton,
      }).filter((node) => typeof node.props.onPress === 'function').length,
    ).toBeGreaterThan(0);
  });

  it('gets a fresh GPS fix when opened without route coordinates', async () => {
    mockSearchParams = {};
    renderScreen();

    const currentLocationButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubUseCurrentLocationButton,
    });
    const nameInput = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubNameInput,
    });

    await act(async () => {
      await currentLocationButton.props.onPress();
      nameInput.props.onChangeText('Hospoda Bez Geokódu');
    });
    await submit();

    expect(mockEnsureLocationPermission).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 4 });
    expect(mockUpsertLocalPub).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Hospoda Bez Geokódu',
        lat: 48.1486,
        lng: 17.1077,
      }),
    );
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('does not treat a typed address as a location without GPS confirmation', async () => {
    renderScreen();

    const nameInput = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubNameInput,
    });
    const addressInput = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubAddressInput,
    });

    act(() => {
      nameInput.props.onChangeText('Hospoda Bez Polohy');
      addressInput.props.onChangeText('Neznámá 123');
    });
    await submit();

    expect(mockUpsertLocalPub).not.toHaveBeenCalled();
    expect(mockEnqueueAddedPub).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('opens settings when location permission is denied', async () => {
    mockSearchParams = {};
    mockEnsureLocationPermission.mockResolvedValue('denied');
    renderScreen();

    const currentLocationButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.addPubUseCurrentLocationButton,
    });

    await act(async () => {
      await currentLocationButton.props.onPress();
    });

    expect(mockOpenSystemSettings).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(cs.addPub.locationPermissionDenied);
  });
});
