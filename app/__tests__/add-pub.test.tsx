import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { t } from '@/i18n';
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
const mockEnqueueAddedPubEdit: jest.Mock = jest.fn(async () => 'synced');
const mockClearPubsSnapshot: jest.Mock = jest.fn(async () => undefined);
const mockPubIdForCoords: jest.Mock = jest.fn((lat: number, lng: number) => `local:${lat}:${lng}`);
const mockUpsertLocalPub: jest.Mock = jest.fn();
const mockFireSuccessHaptic: jest.Mock = jest.fn(async () => undefined);
const mockLookupAddedPubLocation: jest.Mock = jest.fn();
const mockResetBeerMapLayerForAddedPub: jest.Mock = jest.fn();

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
  enqueueAddedPubEdit: (entry: unknown) => mockEnqueueAddedPubEdit(entry),
}));

jest.mock('@/data/pubs', () => ({
  clearPubsSnapshot: () => mockClearPubsSnapshot(),
  pubIdForCoords: (...args: [number, number]) => mockPubIdForCoords(...args),
  upsertLocalPub: (pub: unknown) => mockUpsertLocalPub(pub),
}));

jest.mock('@/map/BeerMapScreen', () => ({
  resetBeerMapLayerForAddedPub: () => mockResetBeerMapLayerForAddedPub(),
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

jest.mock('@/data/addedPubLocationClient', () => ({
  lookupAddedPubLocation: (...args: unknown[]) => mockLookupAddedPubLocation(...args),
}));

jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));

const resolvedAddress = { lat: 49.1951, lng: 16.6068, city: 'Brno', address: 'Česká 12' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('AddPubScreen location confirmation', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = { lat: '50.087', lng: '14.421', city: 'Praha' };
    mockEnsureLocationPermission.mockResolvedValue('granted');
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 48.1486, longitude: 17.1077 },
    });
    mockLookupAddedPubLocation.mockResolvedValue(resolvedAddress);
    mockEnqueueAddedPub.mockResolvedValue('queued');
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  function renderScreen() {
    act(() => { renderer = TestRenderer.create(<AddPubScreen />); });
  }

  function button(label: string) {
    return renderer!.root.findAllByProps({ accessibilityLabel: label })
      .find((node) => typeof node.props.onPress === 'function')!;
  }

  function change(label: string, value: string) {
    act(() => renderer!.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value));
  }

  async function press(label: string) {
    await act(async () => {
      button(label).props.onPress();
      await Promise.resolve();
    });
  }

  const confirmLabel = `${t.addPub.confirmAddress}: ${resolvedAddress.address}, ${resolvedAddress.city}`;
  const submit = () => press(t.a11y.addPubSaveButton);

  function fillAddress() {
    change(t.a11y.addPubNameInput, 'Hospoda U Testu');
    change(t.a11y.addPubCityInput, 'Brno');
    change(t.a11y.addPubAddressInput, 'Česká 12');
  }

  function expectNoWrite() {
    expect(mockEnqueueAddedPub).not.toHaveBeenCalled();
    expect(mockEnqueueAddedPubEdit).not.toHaveBeenCalled();
    expect(mockUpsertLocalPub).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  }

  it('saves the explicitly confirmed address instead of route GPS in a different city', async () => {
    renderScreen();
    fillAddress();
    await press(t.addPub.findAddress);
    expect(mockLookupAddedPubLocation).toHaveBeenCalledWith(
      { address: 'Česká 12', city: 'Brno' }, expect.any(AbortSignal),
    );
    await submit();
    expectNoWrite();
    await press(confirmLabel);
    await submit();
    expect(mockEnqueueAddedPub).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'uuid-fixed', name: 'Hospoda U Testu', ...resolvedAddress,
    }));
    expect(mockUpsertLocalPub).toHaveBeenCalledWith(expect.objectContaining({
      ...resolvedAddress, userAddedClientId: 'uuid-fixed',
    }));
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('takes a fresh GPS fix and requires confirmation of its reverse-geocoded address', async () => {
    renderScreen();
    fillAddress();
    await press(t.a11y.addPubUseCurrentLocationButton);
    expect(mockEnsureLocationPermission).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 4 });
    expect(mockLookupAddedPubLocation).toHaveBeenCalledWith(
      { lat: 48.1486, lng: 17.1077 }, expect.any(AbortSignal),
    );
    await submit();
    expectNoWrite();
    await press(confirmLabel);
    await submit();
    expect(mockEnqueueAddedPub).toHaveBeenCalledWith(expect.objectContaining(resolvedAddress));
  });

  it.each(['address', 'GPS'])('does not save or insert GPS after a failed/offline %s lookup', async (source) => {
    mockLookupAddedPubLocation.mockResolvedValue(null);
    renderScreen();
    fillAddress();
    await press(source === 'address' ? t.addPub.findAddress : t.a11y.addPubUseCurrentLocationButton);
    await submit();
    expectNoWrite();
    expect(JSON.stringify(renderer!.toJSON())).toContain(t.addPub.addressLookupFailed);
  });

  it('does not save typed text without looking up and confirming the address', async () => {
    renderScreen();
    fillAddress();
    await submit();
    expectNoWrite();
  });

  it.each([t.a11y.addPubAddressInput, t.a11y.addPubCityInput])(
    'invalidates confirmation after changing %s', async (field) => {
      renderScreen();
      fillAddress();
      await press(t.addPub.findAddress);
      await press(confirmLabel);
      change(field, 'Jiná adresa');
      await submit();
      expectNoWrite();
    },
  );

  it('discards an in-flight lookup when its address changes, even if the service resolves late', async () => {
    const pending = deferred<typeof resolvedAddress>();
    mockLookupAddedPubLocation.mockReturnValue(pending.promise);
    renderScreen();
    fillAddress();
    await press(t.addPub.findAddress);
    const signal = mockLookupAddedPubLocation.mock.calls[0][1] as AbortSignal;
    change(t.a11y.addPubAddressInput, 'Jiná 9');
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(resolvedAddress); });
    expect(button(confirmLabel)).toBeUndefined();
    await submit();
    expectNoWrite();
  });

  it('preserves an explicitly aimed map pin while offline and marks its origin', async () => {
    mockSearchParams = { lat: '50.087', lng: '14.421', source: 'map' };
    mockLookupAddedPubLocation.mockResolvedValue(null);
    renderScreen();
    fillAddress();
    await submit();
    expect(mockEnqueueAddedPub).toHaveBeenCalledWith(expect.objectContaining({
      lat: 50.087, lng: 14.421, location_source: 'map_pin', address: 'Česká 12', city: 'Brno',
    }));
    expect(mockLookupAddedPubLocation).not.toHaveBeenCalled();
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockResetBeerMapLayerForAddedPub).toHaveBeenCalledTimes(1);
  });

  it('lets the user deselect a map pin and blocks saving', async () => {
    mockSearchParams = { lat: '50.087', lng: '14.421', source: 'map' };
    renderScreen();
    fillAddress();
    await press(t.a11y.addPubMapPinSelected);
    await submit();
    expectNoWrite();
  });

  it.each<Record<string, string>>([{ lng: '14.421' }, { lat: '50.087' }])(
    'does not turn a missing map coordinate into zero (%j)', async (coordinates) => {
      mockSearchParams = { ...coordinates, source: 'map' };
      renderScreen();
      fillAddress();
      await submit();
      expectNoWrite();
      expect(button(t.a11y.addPubMapPinSelected)).toBeUndefined();
    },
  );

  it('sends a name-only edit without asking for location again', async () => {
    mockSearchParams = {
      clientId: 'existing-client-id', name: 'Původní jméno', city: 'Praha',
      address: 'Stará 1', lat: '50.087', lng: '14.421',
    };
    renderScreen();
    change(t.a11y.addPubNameInput, 'Nové jméno');
    await submit();
    expect(mockEnqueueAddedPubEdit).toHaveBeenCalledWith({
      client_id: 'existing-client-id', name: 'Nové jméno',
    });
    expect(mockLookupAddedPubLocation).not.toHaveBeenCalled();
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockUpsertLocalPub).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Nové jméno', lat: 50.087, lng: 14.421, city: 'Praha', address: 'Stará 1',
    }));
  });

  it('blocks an edit with changed name and address until the new location is confirmed', async () => {
    mockSearchParams = {
      clientId: 'existing-client-id', name: 'Původní jméno', city: 'Praha',
      address: 'Stará 1', lat: '50.087', lng: '14.421',
    };
    renderScreen();
    fillAddress();
    await submit();
    expectNoWrite();
    await press(t.addPub.findAddress);
    await submit();
    expectNoWrite();
    await press(confirmLabel);
    await submit();
    expect(mockEnqueueAddedPubEdit).toHaveBeenCalledWith({
      client_id: 'existing-client-id', name: 'Hospoda U Testu', ...resolvedAddress,
    });
  });

  it('queues only one pub when save is tapped twice before a render', async () => {
    renderScreen();
    fillAddress();
    await press(t.addPub.findAddress);
    await press(confirmLabel);
    const save = button(t.a11y.addPubSaveButton).props.onPress;
    await act(async () => { save(); save(); });
    expect(mockEnqueueAddedPub).toHaveBeenCalledTimes(1);
    expect(mockUpsertLocalPub).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows permission failure and offers settings without selecting stale route GPS', async () => {
    mockEnsureLocationPermission.mockResolvedValue('denied');
    renderScreen();
    fillAddress();
    await press(t.a11y.addPubUseCurrentLocationButton);
    await submit();
    expect(mockOpenSystemSettings).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockLookupAddedPubLocation).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain(t.addPub.locationPermissionDenied);
    expectNoWrite();
  });
});
