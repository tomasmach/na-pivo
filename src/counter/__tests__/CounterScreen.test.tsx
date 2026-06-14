import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: jest.fn((value) => ({ value })),
  useAnimatedStyle: jest.fn((factory) => factory()),
  withSpring: jest.fn((value) => value),
  withSequence: jest.fn((value) => value),
  useReducedMotion: jest.fn(() => true),
}));

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: jest.fn(async () => undefined),
}));

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: {
      regular: 'display-regular',
      medium: 'display-medium',
      semibold: 'display-semibold',
      bold: 'display-bold',
      extrabold: 'display-extrabold',
      black: 'display-extrabold',
    },
    ui: { regular: 'ui-regular', medium: 'ui-medium', semibold: 'ui-semibold', bold: 'ui-bold' },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock('@/components/celebration/BeerBubbles', () => ({ BeerBubbles: jest.fn(() => null) }));
jest.mock('@/components/shared/GlowButton', () => ({ GlowButton: jest.fn(() => null) }));
// The modals wrap RN Modal/TextInput (not in the lean react-native test mock);
// they aren't under test here, so stub them out.
jest.mock('@/counter/BeerFormModal', () => ({ BeerFormModal: jest.fn(() => null) }));
jest.mock('@/counter/PubPickerModal', () => ({ PubPickerModal: jest.fn(() => null) }));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  MapPinIcon: jest.fn(() => null),
  PlusIcon: jest.fn(() => null),
  MinusIcon: jest.fn(() => null),
  Undo2Icon: jest.fn(() => null),
  RefreshCwIcon: jest.fn(() => null),
  HistoryIcon: jest.fn(() => null),
  XIcon: jest.fn(() => null),
}));

// expo-router pulls in ESM (expo-asset) that jest can't transform; the counter
// only needs router.push for the "Moje piva" entry, so stub it.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));

// Drinks delivery layer — assert calls without touching the network.
const enqueueDrink = jest.fn((_entry: unknown, _options?: unknown) => Promise.resolve(true));
const flushDrinksQueue = jest.fn(() => Promise.resolve(undefined));
const removeQueuedDrink = jest.fn((_clientId: string) => Promise.resolve(true));
const isDrinkQueued = jest.fn((_clientId: string) => Promise.resolve(false));
jest.mock('@/data/drinksQueue', () => ({ enqueueDrink, flushDrinksQueue, isDrinkQueued, removeQueuedDrink }));

const enqueueDelete = jest.fn((_clientId: string) => Promise.resolve(undefined));
const flushDeleteDrinksQueue = jest.fn(() => Promise.resolve(undefined));
jest.mock('@/data/deleteDrinksQueue', () => ({ enqueueDelete, flushDeleteDrinksQueue }));

const mockTrackClientEvent = jest.fn(async () => undefined);
jest.mock('@/data/telemetryClient', () => ({ trackClientEvent: mockTrackClientEvent }));

const mockTrackCounterTabOpened = jest.fn(async () => undefined);
jest.mock('@/data/counterTelemetry', () => ({ trackCounterTabOpened: mockTrackCounterTabOpened }));

const fetchPubHours = jest.fn(async () => new Map());
jest.mock('@/data/hoursClient', () => ({ fetchPubHours }));

jest.mock('@/data/account', () => ({ generateUuidV4: jest.fn(() => 'uuid-fixed') }));

const useNearbyPub = jest.fn();
jest.mock('@/counter/useNearbyPub', () => ({ useNearbyPub: () => useNearbyPub() }));

import { useTallyStore } from '@/stores/tallyStore';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { geohash8 } from '@/data/geohash';
import { Alert } from 'react-native';

const CounterScreen = require('../CounterScreen').default;
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const PUB = { id: 'osm:1', name: 'U Zlatého tygra', lat: 50.0876, lng: 14.4214 };
const CELL = geohash8(PUB.lat, PUB.lng);

function nearbyState(over: Record<string, unknown> = {}) {
  return {
    candidates: [{ pubKey: CELL, pub: PUB, distanceMeters: 12 }],
    selected: PUB,
    selectPub: jest.fn(),
    permissionState: 'granted',
    requestPermission: jest.fn(),
    loading: false,
    retry: jest.fn(),
    ...over,
  };
}

beforeEach(() => {
  // Fake timers so the counter's deferred-delivery setTimeout never auto-fires
  // mid-test (it would mark a drink synced after the test ends → act warnings).
  // Tests that exercise the undo window advance time explicitly.
  jest.useFakeTimers();
  jest.clearAllMocks();
  fetchPubHours.mockImplementation(() => new Promise(() => undefined));
  useTallyStore.setState({ current: null, history: [] });
  useCommunityStore.setState({ overrides: {} });
  useSettingsStore.setState({ priceCurrency: 'CZK' });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('CounterScreen states', () => {
  it('renders the permission gate when permission is not granted', () => {
    useNearbyPub.mockReturnValue(nearbyState({ permissionState: 'undetermined', selected: null, candidates: [] }));
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });
    const cs = require('@/i18n/cs').cs;
    const texts = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    expect(texts.flat().join(' ')).toContain(cs.counter.permTitle);
  });

  it('renders the detecting state while loading', () => {
    useNearbyPub.mockReturnValue(nearbyState({ loading: true, selected: null, candidates: [] }));
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });
    const cs = require('@/i18n/cs').cs;
    const texts = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    expect(texts.flat().join(' ')).toContain(cs.counter.detecting);
  });

  it('renders the no-pub state when there is no active pub', () => {
    useNearbyPub.mockReturnValue(nearbyState({ selected: null, candidates: [] }));
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });
    const cs = require('@/i18n/cs').cs;
    const texts = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    expect(texts.flat().join(' ')).toContain(cs.counter.noPubTitle);
  });
});

describe('CounterScreen counting', () => {
  it('renders backend community beers fetched for the active pub', async () => {
    fetchPubHours.mockResolvedValueOnce(
      new Map([
        [
          PUB.id,
          {
            openingHours: null,
            isOpenNow: null,
            nextChange: null,
            status: 'ok',
            source: 'firmy',
            communityHours: null,
            beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }],
            rating: null,
            ratingCount: null,
            ratingLabel: null,
            venueKind: 'pub',
          },
        ],
      ]),
    );
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const cs = require('@/i18n/cs').cs;
    const wanted = cs.a11y.counterCountBeer('Plzeň', cs.counter.price(62));
    const card = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === wanted && typeof n.props?.onPress === 'function',
    )[0];
    expect(card).toBeTruthy();
    expect(fetchPubHours).toHaveBeenCalledWith([PUB], expect.any(AbortSignal));
  });

  it('counts a priced beer on tap → updates tally, queue, and menu override', async () => {
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    // Find the menu card Pressable (its a11y label references the beer count).
    const cs = require('@/i18n/cs').cs;
    const wanted = cs.a11y.counterCountBeer('Plzeň', cs.counter.price(62));
    const card = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === wanted && typeof n.props?.onPress === 'function',
    )[0];
    expect(card).toBeTruthy();

    await act(async () => {
      card.props.onPress();
      await Promise.resolve();
    });

    // Tally recorded.
    const current = useTallyStore.getState().current;
    expect(current?.pubKey).toBe(CELL);
    expect(current?.drinks).toHaveLength(1);
    expect(current?.drinks[0].priceCzk).toBe(62);

    // Delivery is persisted immediately but deferred (deliver: false), so the
    // queued payload stays retractable through the undo window — no flush yet.
    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(enqueueDrink.mock.calls[0][1]).toEqual({ deliver: false });
    expect(flushDrinksQueue).not.toHaveBeenCalled();
    const entry = enqueueDrink.mock.calls[0][0] as any;
    expect(entry.client_id).toBe('uuid-fixed');
    expect(entry.beer).toEqual({ name: 'Plzeň', price_czk: 62, volume_ml: 500 });
    expect(mockTrackCounterTabOpened).toHaveBeenCalledWith(false);
    expect(mockTrackClientEvent).toHaveBeenCalledWith({ event: 'counter_session_started' });
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'drink_added',
      context: { had_active_session: false },
    });

    // Menu override still present (price unchanged → same single beer).
    const override = useCommunityStore.getState().overrides[CELL];
    expect(override?.beers).toHaveLength(1);
  });

  it('renders priced beer labels in EUR when selected in settings', () => {
    useSettingsStore.setState({ priceCurrency: 'EUR' });
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 75, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const cs = require('@/i18n/cs').cs;
    const wanted = cs.a11y.counterCountBeer('Plzeň', '3 €');
    const card = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === wanted && typeof n.props?.onPress === 'function',
    )[0];
    expect(card).toBeTruthy();
  });

  it('shows the last-drink time and asks for confirmation when counting again too quickly', async () => {
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const cs = require('@/i18n/cs').cs;
    const wanted = cs.a11y.counterCountBeer('Plzeň', cs.counter.price(62));
    const card = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === wanted && typeof n.props?.onPress === 'function',
    )[0];

    await act(async () => {
      card.props.onPress();
      await Promise.resolve();
    });

    const texts = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    expect(texts.flat().join(' ')).toContain(cs.counter.lastDrinkJustNow);
    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();

    await act(async () => {
      card.props.onPress();
      await Promise.resolve();
    });

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    await act(async () => {
      buttons[1].onPress();
      await Promise.resolve();
    });

    expect(enqueueDrink).toHaveBeenCalledTimes(2);
    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
  });

  // Counts the beer, returns the rendered "+" and "−" Pressables for it.
  function countOnce(renderer: any, cs: any) {
    const plusLabel = cs.a11y.counterCountBeer('Plzeň', cs.counter.price(62));
    const plus = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === plusLabel && typeof n.props?.onPress === 'function',
    )[0];
    act(() => {
      plus.props.onPress();
    });
    const minus = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === cs.a11y.counterRemoveBeer('Plzeň') && typeof n.props?.onPress === 'function',
    )[0];
    return { plus, minus };
  }

  it('the minus button removes the last count of that beer and pulls a still-queued payload', async () => {
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const cs = require('@/i18n/cs').cs;
    const { minus } = countOnce(renderer, cs);
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
    expect(minus).toBeTruthy();

    // Within the undo window the payload is still queued, so − pulls it back and
    // never asks the backend to delete (it was never delivered).
    await act(async () => {
      minus.props.onPress();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(0);
    expect(removeQueuedDrink).toHaveBeenCalledWith('uuid-fixed');
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'drink_removed',
      context: { delivery_state: 'queued' },
    });
    expect(enqueueDelete).not.toHaveBeenCalled();
  });

  it('the minus button enqueues a backend delete once the drink has been delivered', async () => {
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const cs = require('@/i18n/cs').cs;
    countOnce(renderer, cs);

    // Let the deferred send fire → the drink reaches the backend (marked synced).
    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(flushDrinksQueue).toHaveBeenCalledTimes(1);
    expect(useTallyStore.getState().current?.drinks[0].syncStatus).toBe('sent');

    // Now − can no longer pull it from the queue → it durably enqueues a DELETE.
    removeQueuedDrink.mockResolvedValueOnce(false);
    const minus = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === cs.a11y.counterRemoveBeer('Plzeň') && typeof n.props?.onPress === 'function',
    )[0];
    await act(async () => {
      minus.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(0);
    expect(enqueueDelete).toHaveBeenCalledWith('uuid-fixed');
  });
});
