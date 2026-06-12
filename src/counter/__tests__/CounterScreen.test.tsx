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
  Undo2Icon: jest.fn(() => null),
  RefreshCwIcon: jest.fn(() => null),
  XIcon: jest.fn(() => null),
}));

// Drinks delivery layer — assert calls without touching the network.
const enqueueDrink = jest.fn((_entry: unknown) => Promise.resolve(true));
const flushDrinksQueue = jest.fn(() => Promise.resolve(undefined));
const removeQueuedDrink = jest.fn((_clientId: string) => Promise.resolve(true));
jest.mock('@/data/drinksQueue', () => ({ enqueueDrink, flushDrinksQueue, removeQueuedDrink }));

const fetchPubHours = jest.fn(async () => new Map());
jest.mock('@/data/hoursClient', () => ({ fetchPubHours }));

jest.mock('@/data/account', () => ({ generateUuidV4: jest.fn(() => 'uuid-fixed') }));

const useNearbyPub = jest.fn();
jest.mock('@/counter/useNearbyPub', () => ({ useNearbyPub: () => useNearbyPub() }));

import { useTallyStore } from '@/stores/tallyStore';
import { useCommunityStore } from '@/stores/communityStore';
import { geohash8 } from '@/data/geohash';

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
  jest.clearAllMocks();
  fetchPubHours.mockImplementation(() => new Promise(() => undefined));
  useTallyStore.setState({ current: null, history: [] });
  useCommunityStore.setState({ overrides: {} });
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

    // Delivery enqueued + flushed.
    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(flushDrinksQueue).toHaveBeenCalledTimes(1);
    const entry = enqueueDrink.mock.calls[0][0] as any;
    expect(entry.client_id).toBe('uuid-fixed');
    expect(entry.beer).toEqual({ name: 'Plzeň', price_czk: 62, volume_ml: 500 });

    // Menu override still present (price unchanged → same single beer).
    const override = useCommunityStore.getState().overrides[CELL];
    expect(override?.beers).toHaveLength(1);
  });

  it('undoing the last pending count removes the tally drink and the queued payload', async () => {
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
    act(() => {
      card.props.onPress();
    });
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);

    // Tap the undo affordance.
    const undo = renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === cs.a11y.counterUndo,
    )[0];
    expect(undo).toBeTruthy();
    await act(async () => {
      undo.props.onPress();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(0);
    expect(removeQueuedDrink).toHaveBeenCalledWith('uuid-fixed');
  });
});
