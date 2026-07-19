import React from 'react';
import { cs as copy } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView', createAnimatedComponent: (c: unknown) => c },
  useSharedValue: jest.fn((value) => ({ value })),
  useAnimatedStyle: jest.fn((factory) => factory()),
  useAnimatedProps: jest.fn((factory) => factory()),
  withSpring: jest.fn((value) => value),
  withTiming: jest.fn((value) => value),
  withSequence: jest.fn((value) => value),
  useReducedMotion: jest.fn(() => true),
}));

// The public "Zmapuj hospodu" entry is its own feature (sheet/store/icons tested
// elsewhere); stub it so these beer-counting tests stay isolated from its deps.
jest.mock('@/components/amenities/MapPubEntry', () => ({ MapPubEntry: () => null }));

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
jest.mock('@/components/shared/AppDialog', () => ({
  AppDialogHost: jest.fn(() => null),
  showAppDialog: jest.fn(),
}));
// The modals wrap RN Modal/TextInput (not in the lean react-native test mock);
// they aren't under test here, so stub them out.
jest.mock('@/counter/BeerFormModal', () => ({ BeerFormModal: jest.fn(() => null) }));
jest.mock('@/counter/PubPickerModal', () => ({ PubPickerModal: jest.fn(() => null) }));
jest.mock('@/components/contribute/ScanMenuSheet', () => ({ ScanMenuSheet: jest.fn(() => null) }));
jest.mock('@/counter/ScannedDrinkPicker', () => ({ ScannedDrinkPicker: jest.fn(() => null) }));

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), back: jest.fn() })),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  MapPinIcon: jest.fn(() => null),
  PlusIcon: jest.fn(() => null),
  MinusIcon: jest.fn(() => null),
  Undo2Icon: jest.fn(() => null),
  RefreshCwIcon: jest.fn(() => null),
  CheckIcon: jest.fn(() => null),
  XIcon: jest.fn(() => null),
  BellRingIcon: jest.fn(() => null),
  GlassWaterIcon: jest.fn(() => null),
  HistoryIcon: jest.fn(() => null),
  CameraIcon: jest.fn(() => null),
  InfoIcon: jest.fn(() => null),
  SparklesIcon: jest.fn(() => null),
  HouseIcon: jest.fn(() => null),
  TreePineIcon: jest.fn(() => null),
}));

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

const mockShareFriendPubActivity = jest.fn(async () => ({ ok: true }));
jest.mock('@/data/friendsClient', () => ({ shareFriendPubActivity: mockShareFriendPubActivity }));

const fetchPubHours = jest.fn(async () => new Map());
jest.mock('@/data/hoursClient', () => ({ fetchPubHours }));

jest.mock('@/data/account', () => ({ generateUuidV4: jest.fn(() => 'uuid-fixed') }));

// Visit ("evening") sync — keep it out of the network path; the wiring is
// covered by visitsSync/visitsQueue tests.
const syncVisit = jest.fn();
const deleteVisitByClientId = jest.fn();
jest.mock('@/data/visitsSync', () => ({ syncVisit, deleteVisitByClientId }));

const useNearbyPub = jest.fn();
jest.mock('@/counter/useNearbyPub', () => ({ useNearbyPub: () => useNearbyPub() }));

// Photo capture flow — pure UI with its own coverage; it drags in
// expo-location via compass/permissions, which this suite doesn't stub.
jest.mock('@/photos/BeerPhotoCaptureFlow', () => ({ BeerPhotoCaptureFlow: () => null }));

import { useTallyStore } from '@/stores/tallyStore';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { geohash8 } from '@/data/geohash';
import { showAppDialog } from '@/components/shared/AppDialog';

const { default: CounterScreen, groupMenuBeers } = require('../CounterScreen');
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

  it('starts an outside evening directly instead of opening the pub picker', () => {
    useNearbyPub.mockReturnValue(nearbyState({ selected: null, candidates: [nearbyState().candidates[0]] }));
    const PubPickerModal = require('@/counter/PubPickerModal').PubPickerModal as jest.Mock;
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const outside = renderer.root.findAll(
      (node: any) =>
        node.props?.accessibilityLabel === copy.counter.outsideNoPubCta &&
        typeof node.props?.onPress === 'function',
    )[0];
    act(() => outside.props.onPress());

    const texts = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    expect(texts.flat().join(' ')).toContain(copy.counter.outsideLabel('other'));
    expect(PubPickerModal.mock.calls.at(-1)?.[0].visible).toBe(false);
  });

  it('offers outside counting from the change-place picker near a pub', () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const PubPickerModal = require('@/counter/PubPickerModal').PubPickerModal as jest.Mock;
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const changePlace = renderer.root.findAll(
      (node: any) =>
        node.props?.accessibilityLabel === copy.a11y.counterChangePub &&
        typeof node.props?.onPress === 'function',
    )[0];
    act(() => changePlace.props.onPress());

    const pickerProps = PubPickerModal.mock.calls.at(-1)?.[0];
    expect(pickerProps.visible).toBe(true);

    act(() => pickerProps.onSelectOutside('other'));

    const texts = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    expect(texts.flat().join(' ')).toContain(copy.counter.outsideLabel('other'));
  });
});

describe('CounterScreen counting', () => {
  it('groups serving sizes under one beer card and keeps each size countable', async () => {
    useCommunityStore.setState({
      overrides: {
        [CELL]: {
          beers: [
            { name: 'Pilsner Urquell', priceCzk: 155, volumeMl: 500 },
            { name: 'Pilsner Urquell', priceCzk: 95, volumeMl: 300 },
          ],
          updatedAt: 1,
        },
      },
    });
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const beerNames = renderer.root.findAll(
      (node: any) => node.type === 'Text' && node.props.children === 'Pilsner Urquell',
    );
    expect(beerNames).toHaveLength(1);

    const smallPlus = renderer.root.findAll(
      (node: any) =>
        node.props?.accessibilityLabel ===
          `${copy.a11y.counterCountBeer('Pilsner Urquell', copy.counter.price(95))}, 0,3 l` &&
        typeof node.props?.onPress === 'function',
    )[0];
    const largePlus = renderer.root.findAll(
      (node: any) =>
        node.props?.accessibilityLabel ===
          `${copy.a11y.counterCountBeer('Pilsner Urquell', copy.counter.price(155))}, 0,5 l` &&
        typeof node.props?.onPress === 'function',
    )[0];
    expect(smallPlus).toBeTruthy();
    expect(largePlus).toBeTruthy();

    await act(async () => {
      smallPlus.props.onPress();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks[0]).toMatchObject({
      beerName: 'Pilsner Urquell',
      priceCzk: 95,
      volumeMl: 300,
    });
  });

  it('orders grouped serving sizes from small to large', () => {
    const groups = groupMenuBeers([
      { name: 'Plzeň', priceCzk: 72, volumeMl: 500 },
      { name: 'Kozel', priceCzk: 55, volumeMl: 500 },
      { name: ' plzeň ', priceCzk: 48, volumeMl: 300 },
    ]);

    expect(groups.map((group: any) => group.name)).toEqual(['Plzeň', 'Kozel']);
    expect(groups[0].beers.map((beer: any) => beer.volumeMl)).toEqual([300, 500]);
  });

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
            hasGarden: null,
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
      context: { had_active_session: false, backdated: false },
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
    expect(showAppDialog).not.toHaveBeenCalled();

    await act(async () => {
      card.props.onPress();
      await Promise.resolve();
    });

    expect(showAppDialog).toHaveBeenCalledTimes(1);
    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);

    const buttons = (showAppDialog as jest.Mock).mock.calls[0][0].buttons;
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

    const { minus } = countOnce(renderer, copy);
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
    expect(deleteVisitByClientId).toHaveBeenCalledWith(expect.any(String));
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
    expect(deleteVisitByClientId).toHaveBeenCalledWith(expect.any(String));
  });

  it('waits for an in-flight drink POST before enqueueing the backend delete', async () => {
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());
    let resolveFlush!: () => void;
    flushDrinksQueue.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveFlush = () => resolve(undefined);
      }),
    );
    removeQueuedDrink.mockResolvedValueOnce(false);

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const cs = require('@/i18n/cs').cs;
    const { minus } = countOnce(renderer, cs);
    await act(async () => {
      minus.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(flushDrinksQueue).toHaveBeenCalledTimes(1);
    expect(enqueueDelete).not.toHaveBeenCalled();

    await act(async () => {
      resolveFlush();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(enqueueDelete).toHaveBeenCalledWith('uuid-fixed');
  });

  it('shares the active evening client id with friends', async () => {
    const startedAt = new Date().toISOString();
    useTallyStore.setState({
      current: {
        clientId: 'session-client-id',
        pubKey: CELL,
        pubName: PUB.name,
        startedAt,
        drinks: [
          {
            id: 'drink-id',
            beerName: 'Plzeň',
            priceCzk: 62,
            at: startedAt,
          },
        ],
      },
      history: [],
    });
    useNearbyPub.mockReturnValue(nearbyState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    const share = renderer.root.findAll(
      (n: any) =>
        n.props?.accessibilityLabel === copy.friends.shareHereShort &&
        typeof n.props?.onPress === 'function',
    )[0];
    expect(share).toBeTruthy();

    await act(async () => {
      share.props.onPress();
      await Promise.resolve();
    });

    // Parta 3.0 §B4: one-tap quick broadcast sends an empty message (the rich
    // compose with a message lives on the Parta tab).
    expect(mockShareFriendPubActivity).toHaveBeenCalledWith(
      PUB,
      '',
      'session-client-id',
    );
  });
});

describe('CounterScreen water nudge', () => {
  // Seed a live evening with `drinkCount` beers logged well in the past (so the
  // rapid-drink warning never intercepts the next tap), under a chosen clientId
  // so we can prove the nudge guard is keyed by session identity.
  function seedSession(clientId: string, drinkCount: number) {
    const past = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const drinks = Array.from({ length: drinkCount }, (_, i) => ({
      id: `seed-${clientId}-${i}`,
      beerName: 'Plzeň',
      priceCzk: 62,
      volumeMl: 500,
      at: past,
    }));
    useTallyStore.setState({
      current: { clientId, pubKey: CELL, pubName: PUB.name, startedAt: past, drinks },
      history: [],
    });
  }

  function findBeerCard(renderer: any) {
    const wanted = copy.a11y.counterCountBeer('Plzeň', copy.counter.price(62));
    return renderer.root.findAll(
      (n: any) => n.props?.accessibilityLabel === wanted && typeof n.props?.onPress === 'function',
    )[0];
  }

  it('fires once when a session hits its 4th beer, and again for a fresh session', async () => {
    const showToast = jest.fn();
    useToastStore.setState({ show: showToast });
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());

    // Session A already sits at 3 beers → the next tap is the 4th.
    seedSession('session-a', 3);

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CounterScreen));
    });

    await act(async () => {
      findBeerCard(renderer).props.onPress();
      await Promise.resolve();
    });

    // The 4th beer nudges exactly once (a shared-threshold double-fire is guarded).
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      copy.counter.waterNudge(4),
      expect.objectContaining({ icon: expect.anything() }),
    );

    // A fresh evening (different clientId) in the SAME mounted counter must nudge
    // again at its own 4th beer — the guard is keyed by session identity, not a
    // bare count that would stay "used up" at 4.
    act(() => {
      seedSession('session-b', 3);
    });
    await act(async () => {
      findBeerCard(renderer).props.onPress();
      await Promise.resolve();
    });

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenLastCalledWith(
      copy.counter.waterNudge(4),
      expect.objectContaining({ icon: expect.anything() }),
    );
  });
});
