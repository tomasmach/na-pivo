/**
 * CounterScreen — the "Tácek" surface.
 *
 * These tests exercise the four-block surface through its real leaf components
 * (PlaceChip / CoasterCard / NudgeSlot / CounterCta / DrinkPickSheet /
 * ReceiptSheet), so every assertion goes through an accessibility label a user
 * would actually reach. Only the modals that drag untestable native deps are
 * stubbed.
 *
 * The one thing the whole rebuild exists to guarantee: the CTA's label always
 * states exactly what one tap does, and the FIRST tap of an evening never
 * writes a guessed drink.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import type { TallySession } from '@/stores/tallyStore';
import type { PartyEvening } from '@/data/partyClient';
import { useLaunchModalMutex } from '@/stores/launchModalMutex';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../../modules/beer-live-activity', () => ({
  ackPendingAdds: jest.fn(async () => undefined),
  clearPendingAdds: jest.fn(async () => true),
  end: jest.fn(async () => undefined),
  getPendingAdds: jest.fn(async () => []),
  getStatus: jest.fn(async () => ({ active: false, sessionId: null })),
  startOrUpdate: jest.fn(async () => undefined),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: 'AnimatedView',
    Text: 'AnimatedText',
    createAnimatedComponent: (c: unknown) => c,
  },
  useSharedValue: jest.fn((value) => ({ value })),
  useAnimatedStyle: jest.fn((factory) => factory()),
  useAnimatedProps: jest.fn((factory) => factory()),
  useReducedMotion: jest.fn(() => true),
  withSpring: jest.fn((value) => value),
  withSequence: jest.fn((value) => value),
  withTiming: jest.fn((value) => value),
}));

// The public "Zmapuj hospodu" sheet is its own feature (store/icons tested
// elsewhere); stub it so these beer-counting tests stay isolated from its deps.
jest.mock('@/components/amenities/MapPubSheet', () => ({ MapPubSheet: () => null }));

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
  notificationAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
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
const mockPickMenuPhoto = jest.fn();
const mockScanMenuPhoto = jest.fn();
jest.mock('@/data/menuPhotoPicker', () => ({
  pickAndPrepareMenuPhoto: (...args: unknown[]) => mockPickMenuPhoto(...args),
}));
jest.mock('@/data/menuScanClient', () => ({
  scanMenuPhoto: (...args: unknown[]) => mockScanMenuPhoto(...args),
}));
jest.mock('@/vycep/ShareNightModal', () => ({ ShareNightModal: jest.fn(() => null) }));
// Photo capture flow — pure UI with its own coverage; it drags in
// expo-location via compass/permissions, which this suite doesn't stub.
jest.mock('@/photos/BeerPhotoCaptureFlow', () => ({ BeerPhotoCaptureFlow: () => null }));

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: mockRouterPush, back: jest.fn() })),
}));

jest.mock('@/components/shared/IconGlyph', () => {
  const names = [
    'BeerIcon', 'BeerOffIcon', 'CompassIcon', 'Undo2Icon', 'LockKeyholeIcon', 'EyeIcon',
    'EyeOffIcon', 'MapPinIcon', 'ExternalLinkIcon', 'RefreshCwIcon', 'SettingsIcon',
    'BellRingIcon', 'Volume2Icon', 'InfoIcon', 'ShieldIcon', 'ChevronLeftIcon',
    'ChevronRightIcon', 'ChevronDownIcon', 'HeartIcon', 'FlagIcon', 'MessageSquareIcon',
    'RadiusIcon', 'WifiIcon', 'GlassWaterIcon', 'WineIcon', 'PencilIcon', 'PlusIcon',
    'MinusIcon', 'Trash2Icon', 'CopyIcon', 'XIcon', 'CoinsIcon', 'StarIcon', 'ThumbsUpIcon',
    'ThumbsDownIcon', 'HistoryIcon', 'ClockIcon', 'UserIcon', 'UsersIcon', 'UserPlusIcon',
    'MailIcon', 'LinkIcon', 'CheckIcon', 'BadgeCheckIcon', 'KeyRoundIcon', 'CrownIcon',
    'CameraIcon', 'ImagesIcon', 'SparklesIcon', 'TreePineIcon', 'HouseIcon', 'MilkIcon',
    'CupSodaIcon', 'HandPlatterIcon', 'Share2Icon', 'SearchIcon', 'ListFilterIcon',
    'CreditCardIcon', 'AccessibilityIcon', 'TargetIcon', 'CircleDotIcon', 'SoccerBallIcon',
    'RadioIcon', 'MicIcon', 'TvIcon', 'SquareParkingIcon', 'MapPinnedIcon', 'MapPinPlusIcon',
    'MapIcon', 'ListIcon', 'LocateFixedIcon', 'SlidersHorizontalIcon', 'SproutIcon',
    'ClipboardListIcon', 'FlameIcon', 'TrophyIcon', 'MoonIcon', 'QrCodeIcon', 'MenuIcon',
  ];
  const glyphs: Record<string, unknown> = {};
  for (const name of names) glyphs[name] = jest.fn(() => null);
  return glyphs;
});
// Drinks delivery layer — assert calls without touching the network.
const enqueueDrink = jest.fn((_entry: unknown, _options?: unknown) => Promise.resolve('queued'));
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

// Local notification scheduling is covered by its own suite and needs neither
// AsyncStorage hydration nor expo-notifications here.
const refreshBeerCountReminderAfterBeer = jest.fn(async () => undefined);
jest.mock('@/notifications/beerCountReminder', () => ({ refreshBeerCountReminderAfterBeer }));

let mockUuidCounter = 0;
jest.mock('@/data/account', () => ({
  generateUuidV4: jest.fn(() => `uuid-${++mockUuidCounter}`),
  setAnonymousSessionEvictionListener: jest.fn(),
}));

// Visit ("evening") sync — keep it out of the network path; the wiring is
// covered by visitsSync/visitsQueue tests.
const syncVisit = jest.fn();
const deleteVisitByClientId = jest.fn();
jest.mock('@/data/visitsSync', () => ({ syncVisit, deleteVisitByClientId }));

const useNearbyPub = jest.fn();
jest.mock('@/counter/useNearbyPub', () => ({ useNearbyPub: () => useNearbyPub() }));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: 'CloseButton' }));

const { cs: copy, formatVolume } = jest.requireActual('@/i18n/cs') as typeof import('@/i18n/cs');
const { useTallyStore } = jest.requireActual('@/stores/tallyStore') as typeof import('@/stores/tallyStore');
const { useCommunityStore } = jest.requireActual('@/stores/communityStore') as typeof import('@/stores/communityStore');
const { usePartyEveningStore } = jest.requireActual('@/stores/partyEveningStore') as typeof import('@/stores/partyEveningStore');
const { useSettingsStore } = jest.requireActual('@/stores/settingsStore') as typeof import('@/stores/settingsStore');
const { useToastStore } = jest.requireActual('@/stores/toastStore') as typeof import('@/stores/toastStore');
const { geohash8 } = jest.requireActual('@/data/geohash') as typeof import('@/data/geohash');
const { BeerFormModal } = jest.requireMock('@/counter/BeerFormModal') as typeof import('@/counter/BeerFormModal');
const { PubPickerModal } = jest.requireMock('@/counter/PubPickerModal') as typeof import('@/counter/PubPickerModal');
const { showAppDialog } = jest.requireMock('@/components/shared/AppDialog') as typeof import('@/components/shared/AppDialog');
const { ScanMenuSheet } = jest.requireMock('@/components/contribute/ScanMenuSheet') as typeof import('@/components/contribute/ScanMenuSheet');
const { ScannedDrinkPicker } = jest.requireMock('@/counter/ScannedDrinkPicker') as typeof import('@/counter/ScannedDrinkPicker');
const { default: CounterScreen, groupMenuBeers, UNDO_WINDOW_MS } = jest.requireActual('../CounterScreen');
const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

const PUB = { id: 'osm:1', name: 'U Zlatého tygra', lat: 50.0876, lng: 14.4214 };
const CELL = geohash8(PUB.lat, PUB.lng);
const MIN_PLAUSIBLE_BEER_GAP_MS = 5 * 60 * 1000;
const PARTY_EVENING = {
  id: 'party-1',
  joinCode: 'PIVOXY',
  joinUrl: 'https://na-pivo.cz/party/PIVOXY',
  host: { id: 'me', nickname: 'tomas', displayName: 'Tomáš', avatarUrl: null },
  pubName: PUB.name,
  pubCity: 'Praha',
  active: true,
  startedAt: '2026-08-05T18:00:00.000Z',
  endedAt: null,
  isHost: true,
  members: [],
  events: [],
} as PartyEvening;

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

/** Mounted trees, torn down after each test so a later `setState` can never
 *  re-render a stale counter outside act(). */
const mounted: any[] = [];

function render(): any {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(React.createElement(CounterScreen));
  });
  mounted.push(renderer);
  return renderer;
}

function insideModal(node: any): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'Modal') return true;
    parent = parent.parent;
  }
  return false;
}

/** A pressable on the surface itself (never one hidden inside a sheet — the
 *  lean RN mock renders Modal children inline regardless of `visible`). */
function surface(renderer: any, accessibilityLabel: string): any {
  return renderer.root
    .findAll(
      (n: any) =>
        n.props?.accessibilityLabel === accessibilityLabel && typeof n.props?.onPress === 'function',
    )
    .filter((n: any) => !insideModal(n))[0];
}

/** Every piece of text rendered on the surface (sheets excluded), joined. */
function surfaceText(renderer: any): string {
  return renderer.root
    .findAll((n: any) => n.type === 'Text')
    .filter((n: any) => !insideModal(n))
    .map((n: any) => n.props.children)
    .flat()
    .filter((c: unknown) => typeof c === 'string')
    .join(' ');
}

/** The <Modal> of the sheet whose header carries `title`. */
/**
 * The sheet with this title, or undefined when it is not on screen.
 *
 * Since the sheets moved onto the shared `BottomSheetModal`, a closed sheet is
 * not mounted at all rather than mounted with `visible={false}` — so presence IS
 * the assertion, and `sheetOpen` below says that in one word.
 */
function sheet(renderer: any, title: string): any {
  return renderer.root
    .findAll((n: any) => n.type === 'Modal')
    .find(
      (m: any) => m.findAll((n: any) => n.type === 'Text' && n.props.children === title).length > 0,
    );
}

function sheetOpen(renderer: any, title: string): boolean {
  return sheet(renderer, title) !== undefined;
}

function sheetButton(renderer: any, title: string, accessibilityLabel: string): any {
  return sheet(renderer, title).findAll(
    (n: any) =>
      n.props?.accessibilityLabel === accessibilityLabel && typeof n.props?.onPress === 'function',
  )[0];
}

function lastProps(mock: unknown): any {
  return (mock as jest.Mock).mock.calls.at(-1)?.[0];
}

function session(over: Partial<TallySession> = {}): TallySession {
  return {
    clientId: 'session-1',
    pubKey: CELL,
    pubName: PUB.name,
    startedAt: new Date().toISOString(),
    drinks: [],
    ...over,
  };
}

/** One beer logged `minutesAgo` minutes back — far enough that the rapid-drink
 *  guard stays out of the way unless a test wants it. */
function beerDrink(id: string, minutesAgo: number) {
  return {
    id,
    beerName: 'Plzeň',
    priceCzk: 62,
    volumeMl: 500,
    at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
  };
}

/** Fill in the add-beer form the CTA just opened. */
async function submitForm(result: Record<string, unknown>) {
  await act(async () => {
    lastProps(BeerFormModal).onSubmit(result);
    await Promise.resolve();
  });
}

beforeEach(() => {
  // Fake timers so the counter's deferred-delivery setTimeout never auto-fires
  // mid-test (it would mark a drink synced after the test ends → act warnings).
  // Tests that exercise the undo window advance time explicitly.
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockUuidCounter = 0;
  const modalHolder = useLaunchModalMutex.getState().holder;
  if (modalHolder) useLaunchModalMutex.getState().release(modalHolder);
  fetchPubHours.mockImplementation(() => new Promise(() => undefined) as never);
  useTallyStore.setState({ current: null, history: [] });
  useCommunityStore.setState({ overrides: {} });
  usePartyEveningStore.setState({
    evening: null,
    confirmedIdentity: null,
    lastEvening: null,
    pendingJoinCode: null,
  });
  useSettingsStore.setState({ priceCurrency: 'CZK', waterNudgeEnabled: false });
});

afterEach(() => {
  act(() => {
    while (mounted.length > 0) mounted.pop().unmount();
  });
  jest.clearAllTimers();
  const modalHolder = useLaunchModalMutex.getState().holder;
  if (modalHolder) useLaunchModalMutex.getState().release(modalHolder);
  jest.useRealTimers();
});

// ─── 1. The CTA state machine ────────────────────────────────────────────────

describe('CounterScreen CTA state machine', () => {
  it('with no place resolved the CTA opens the pub picker and writes no drink', () => {
    useNearbyPub.mockReturnValue(nearbyState({ selected: null, candidates: [] }));
    const renderer = render();

    expect(surfaceText(renderer)).toContain(copy.counter.ctaLogBeer);
    expect(surfaceText(renderer)).toContain(copy.counter.placeUnknown);
    expect(lastProps(PubPickerModal).visible).toBe(false);

    act(() => surface(renderer, copy.counter.ctaLogBeer).props.onPress());

    expect(lastProps(PubPickerModal).visible).toBe(true);
    expect(useTallyStore.getState().current).toBeNull();
    expect(enqueueDrink).not.toHaveBeenCalled();
    expect(lastProps(BeerFormModal).visible).toBe(false);
  });

  it('still detecting the place, the CTA never counts either', () => {
    useNearbyPub.mockReturnValue(nearbyState({ selected: null, candidates: [], loading: true }));
    const renderer = render();

    expect(surfaceText(renderer)).toContain(copy.counter.detecting);
    act(() => surface(renderer, copy.counter.ctaLogBeer).props.onPress());

    expect(lastProps(PubPickerModal).visible).toBe(true);
    expect(enqueueDrink).not.toHaveBeenCalled();
  });

  it('at a pub with a menu and nothing counted, the CTA opens "Co si dáš?"', () => {
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    expect(surfaceText(renderer)).toContain(copy.counter.ctaPick);
    expect(sheetOpen(renderer, copy.counter.pickTitle)).toBe(false);

    act(() => surface(renderer, copy.counter.ctaPick).props.onPress());

    expect(sheetOpen(renderer, copy.counter.pickTitle)).toBe(true);
    expect(useTallyStore.getState().current).toBeNull();
    expect(enqueueDrink).not.toHaveBeenCalled();
  });

  it('with nothing to pick at all, the CTA opens the add-beer form in "add" mode', () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    expect(surfaceText(renderer)).toContain(copy.counter.ctaFirstBeer);

    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());

    expect(lastProps(BeerFormModal)).toMatchObject({ visible: true, mode: 'add' });
    expect(useTallyStore.getState().current).toBeNull();
    expect(enqueueDrink).not.toHaveBeenCalled();
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'beer_form_opened',
      context: { mode: 'add' },
    });
  });

  it('routes the top-camera menu choice through the pub menu scanner', () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.photoDiary.counterCta).props.onPress());

    const dialog = (showAppDialog as jest.Mock).mock.calls.at(-1)?.[0];
    expect(dialog.title).toBe(copy.counter.cameraTitle);
    expect(dialog.buttons.map((button: { text: string }) => button.text)).toEqual([
      copy.counter.cameraBeer,
      copy.counter.cameraMenu,
      copy.counter.cancel,
    ]);

    act(() => {
      dialog.buttons.find((button: { text: string }) => button.text === copy.counter.cameraMenu).onPress();
    });

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/contribute',
      params: expect.objectContaining({
        focus: 'beers',
        autoScan: '1',
        id: PUB.id,
        name: PUB.name,
        lat: String(PUB.lat),
        lng: String(PUB.lng),
      }),
    });
  });

  it('syncs the explicitly closed visit when the user confirms Dopito', () => {
    useTallyStore.setState({
      current: session({
        clientId: 'session-dopito',
        drinks: [beerDrink('drink-dopito', 15)],
      }),
      history: [],
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterMore).props.onPress());
    act(() => {
      sheetButton(renderer, copy.counter.moreTitle, copy.a11y.counterDone).props.onPress();
      jest.runOnlyPendingTimers();
    });

    const dialog = (showAppDialog as jest.Mock).mock.calls.at(-1)?.[0];
    expect(dialog.title).toBe(copy.counter.doneTitle);

    act(() => {
      dialog.buttons
        .find((button: { text: string }) => button.text === copy.counter.doneConfirm)
        .onPress();
    });

    const archived = useTallyStore.getState().history[0];
    expect(useTallyStore.getState().current).toBeNull();
    expect(archived).toMatchObject({
      clientId: 'session-dopito',
      archivedReason: 'manual',
      closedAt: expect.any(String),
    });
    expect(syncVisit).toHaveBeenCalledWith(archived);
  });

  it('keeps counter copy factual and removes beer competition', () => {
    expect(copy.counter.repeatCta).toBe('Zapsat stejné pivo');
    expect(copy.counter.rapidInline(7)).toBe('Poslední pivo před 7 min. Je zápis správně?');
    expect(copy.counter.rapidInlineJustNow).toBe('Pivo máš zapsané před chvilkou. Je zápis správně?');
    expect(copy.counter.rapidInlineConfirm).toBe('Ano, zapsat');

    const source = readFileSync(join(__dirname, '../CounterScreen.tsx'), 'utf8');
    expect(source).not.toContain('WeeklyRankChip');
    expect(source).not.toMatch(/kind:\s*"rank"/);
    expect(source).not.toContain('Ještě jedno');
  });

  it('once something was drunk here the CTA repeats that exact beer', async () => {
    useTallyStore.setState({
      current: session({ clientId: 'session-repeat', drinks: [beerDrink('drink-1', 30)] }),
      history: [],
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    const text = surfaceText(renderer);
    expect(text).not.toContain('Ještě jedno');
    expect(text).toContain(copy.counter.repeatCta);
    expect(text).toContain('Plzeň · 0,5 l');

    await act(async () => {
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
      await Promise.resolve();
    });

    const drinks = useTallyStore.getState().current?.drinks ?? [];
    expect(drinks).toHaveLength(2);
    expect(drinks[1]).toMatchObject({ beerName: 'Plzeň', priceCzk: 62, volumeMl: 500 });
  });

  it('a resumable evening here swaps the CTA to "Pokračovat ve večeru"', () => {
    useTallyStore.setState({
      current: null,
      history: [
        session({
          clientId: 'session-timeout',
          drinks: [beerDrink('drink-1', 90)],
          archivedReason: 'timeout',
        }),
      ],
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    const text = surfaceText(renderer);
    expect(text).toContain(copy.counter.resumeEvening);
    expect(text).toContain(copy.counter.resumeSub('1 pivo'));

    act(() => surface(renderer, copy.a11y.counterResume).props.onPress());

    expect(useTallyStore.getState().current?.clientId).toBe('session-timeout');
    expect(useTallyStore.getState().history).toHaveLength(0);
    expect(mockTrackClientEvent).toHaveBeenCalledWith({ event: 'counter_session_resumed' });
    // Resuming is not counting.
    expect(enqueueDrink).not.toHaveBeenCalled();
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
});

// ─── 2. Counting through the CTA ─────────────────────────────────────────────

describe('CounterScreen counting', () => {
  it('the first beer of an evening lands in the tally with delivery deferred', async () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());
    await submitForm({ drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 });

    const current = useTallyStore.getState().current;
    expect(current?.pubKey).toBe(CELL);
    expect(current?.drinks).toHaveLength(1);
    expect(current?.drinks[0]).toMatchObject({
      id: 'uuid-1',
      beerName: 'Plzeň',
      priceCzk: 62,
      volumeMl: 500,
    });

    // Persisted immediately but held back for the undo window, so the queued
    // payload stays retractable — nothing is flushed yet.
    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(enqueueDrink.mock.calls[0][1]).toEqual({ deliver: false });
    expect(flushDrinksQueue).not.toHaveBeenCalled();

    const entry = enqueueDrink.mock.calls[0][0] as any;
    expect(entry.client_id).toBe('uuid-1');
    expect(entry.beer).toEqual({ name: 'Plzeň', price_czk: 62, volume_ml: 500 });
    expect(entry.external_id).toBe(PUB.id);
    expect(entry.name).toBe(PUB.name);
    expect(entry.lat).toBe(PUB.lat);
    expect(entry.lng).toBe(PUB.lng);
    expect(entry.place_context).toBeUndefined();
    expect(typeof entry.drank_at).toBe('string');

    expect(syncVisit).toHaveBeenCalled();
    expect(mockTrackCounterTabOpened).toHaveBeenCalledWith(false);
    expect(mockTrackClientEvent).toHaveBeenCalledWith({ event: 'counter_session_started' });
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'drink_added',
      context: { had_active_session: false, backdated: false },
    });

    // The price the user just gave fills the pub's local community menu.
    expect(useCommunityStore.getState().overrides[CELL]?.beers).toEqual([
      expect.objectContaining({ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }),
    ]);
  });

  it('counts a menu row picked from "Co si dáš?" without re-asking the price', async () => {
    useCommunityStore.setState({
      overrides: { [CELL]: { beers: [{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }], updatedAt: 1 } },
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.counter.ctaPick).props.onPress());

    const row = sheetButton(
      renderer,
      copy.counter.pickTitle,
      copy.a11y.counterCountBeer('Plzeň', `${formatVolume(500)} · ${copy.counter.price(62)}`),
    );
    expect(row).toBeTruthy();

    await act(async () => {
      row.props.onPress();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
    expect(lastProps(BeerFormModal).visible).toBe(false);
    // The sheet leaves rather than blinking out, so it is still on screen for
    // the length of its exit before it unmounts.
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(sheetOpen(renderer, copy.counter.pickTitle)).toBe(false);
  });

  it('tags both the drink and its visit with the active shared table', async () => {
    usePartyEveningStore.setState({ evening: PARTY_EVENING });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());
    await submitForm({ drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 });

    expect(enqueueDrink.mock.calls[0][0]).toEqual(
      expect.objectContaining({ party_code: 'PIVOXY' }),
    );
    expect(syncVisit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: expect.any(String) }),
      undefined,
      'PIVOXY',
    );
  });

  it('keeps tagging offline beers after a cold relaunch restored only the table identity', async () => {
    usePartyEveningStore.setState({
      evening: null,
      confirmedIdentity: {
        id: PARTY_EVENING.id,
        joinCode: PARTY_EVENING.joinCode,
        isHost: PARTY_EVENING.isHost,
        confirmedAt: Date.now(),
      },
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());
    await submitForm({ drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 });

    expect(enqueueDrink.mock.calls[0][0]).toEqual(
      expect.objectContaining({ party_code: 'PIVOXY' }),
    );
    expect(syncVisit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: expect.any(String) }),
      undefined,
      'PIVOXY',
    );
  });

  it('does not leak a code reserved by a slow table create into drink or visit queues', async () => {
    usePartyEveningStore.setState({
      evening: null,
      confirmedIdentity: null,
      pendingJoinCode: 'PIVOXY',
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());
    await submitForm({ drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 });

    expect(enqueueDrink.mock.calls[0][0]).not.toHaveProperty('party_code');
    expect(syncVisit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: expect.any(String) }),
      undefined,
      null,
    );
  });

  it('never shares a backdated diary entry with the table that is active now', async () => {
    usePartyEveningStore.setState({ evening: PARTY_EVENING });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterMore).props.onPress());
    act(() => sheetButton(renderer, copy.counter.moreTitle, copy.counter.backdateLink).props.onPress());
    act(() => jest.advanceTimersByTime(400));
    act(() => lastProps(showAppDialog).buttons[0].onPress());
    await submitForm({ drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 });

    expect(enqueueDrink.mock.calls[0][0]).not.toHaveProperty('party_code');
    expect(syncVisit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: expect.any(String) }),
      undefined,
      null,
    );
  });
});

// ─── 3. Undo ─────────────────────────────────────────────────────────────────

describe('CounterScreen undo', () => {
  async function countFirstBeer(renderer: any) {
    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());
    await submitForm({ drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 });
  }

  it('the nudge slot offers undo, which pulls the still-queued payload', async () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();
    await countFirstBeer(renderer);

    const text = surfaceText(renderer);
    expect(text).toContain(copy.counter.countedStrip(1));
    expect(text).toContain(copy.counter.undo);

    await act(async () => {
      surface(renderer, copy.a11y.counterUndoStrip).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(0);
    expect(removeQueuedDrink).toHaveBeenCalledWith('uuid-1');
    expect(enqueueDelete).not.toHaveBeenCalled();
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'drink_removed',
      context: { delivery_state: 'queued' },
    });
    expect(deleteVisitByClientId).toHaveBeenCalledWith(expect.any(String));
    expect(surfaceText(renderer)).not.toContain(copy.counter.undo);
  });

  it('after the undo window the strip is gone and the drink is marked synced', async () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();
    await countFirstBeer(renderer);

    expect(flushDrinksQueue).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(flushDrinksQueue).toHaveBeenCalledTimes(1);
    expect(useTallyStore.getState().current?.drinks[0].syncStatus).toBe('sent');
    expect(surfaceText(renderer)).not.toContain(copy.counter.undo);
    expect(surface(renderer, copy.a11y.counterUndoStrip)).toBeUndefined();
  });

  it('never marks a drink synced when its retry payload was not persisted', async () => {
    enqueueDrink.mockResolvedValueOnce('storage-error');
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();
    await countFirstBeer(renderer);

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(flushDrinksQueue).not.toHaveBeenCalled();
    expect(useTallyStore.getState().current?.drinks[0].syncStatus).toBe('pending');
  });

  it('keeps a frozen-boundary enqueue rejection handled and pending', async () => {
    enqueueDrink.mockRejectedValueOnce(new Error('account transition'));
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();
    await countFirstBeer(renderer);

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(flushDrinksQueue).not.toHaveBeenCalled();
    expect(useTallyStore.getState().current?.drinks[0].syncStatus).toBe('pending');
  });

  it('a receipt minus after delivery enqueues a durable backend DELETE', async () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();
    await countFirstBeer(renderer);

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    flushDrinksQueue.mockClear();

    act(() => surface(renderer, copy.a11y.counterReceiptChip).props.onPress());
    expect(sheetOpen(renderer, copy.counter.receiptTitle)).toBe(true);

    // The payload is no longer pullable → the removal has to be delivered.
    removeQueuedDrink.mockResolvedValueOnce(false);
    await act(async () => {
      sheetButton(
        renderer,
        copy.counter.receiptTitle,
        copy.a11y.counterRemoveIdentity('Plzeň'),
      ).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(0);
    expect(enqueueDelete).toHaveBeenCalledWith('uuid-1');
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'drink_removed',
      context: { delivery_state: 'delivered' },
    });
  });
});

// ─── 4. The inline rapid-drink guard ─────────────────────────────────────────

describe('CounterScreen rapid-drink guard', () => {
  function seedFreshBeer() {
    useTallyStore.setState({
      current: session({
        clientId: 'session-rapid',
        drinks: [{ id: 'drink-1', beerName: 'Plzeň', priceCzk: 62, volumeMl: 500, at: new Date().toISOString() }],
      }),
      history: [],
    });
  }

  it('a too-soon repeat writes nothing and asks inline first', async () => {
    seedFreshBeer();
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    await act(async () => {
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
      await Promise.resolve();
    });

    // NOTHING was written.
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
    expect(enqueueDrink).not.toHaveBeenCalled();

    const text = surfaceText(renderer);
    expect(text).toContain(copy.counter.rapidInlineJustNow);
    expect(text).toContain(copy.counter.rapidInlineConfirm);

    await act(async () => {
      surface(renderer, copy.a11y.counterRapidConfirm).props.onPress();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
    expect(enqueueDrink).toHaveBeenCalledTimes(1);
    expect(surfaceText(renderer)).not.toContain(copy.counter.rapidInlineConfirm);
  });

  it('letting the inline confirmation time out means no', async () => {
    seedFreshBeer();
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    await act(async () => {
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
      await Promise.resolve();
    });
    expect(surfaceText(renderer)).toContain(copy.counter.rapidInlineConfirm);

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(surfaceText(renderer)).not.toContain(copy.counter.rapidInlineConfirm);
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
    expect(enqueueDrink).not.toHaveBeenCalled();
  });

  it('a repeat past the plausible gap counts straight away', async () => {
    useTallyStore.setState({
      current: session({
        clientId: 'session-slow',
        drinks: [
          {
            id: 'drink-1',
            beerName: 'Plzeň',
            priceCzk: 62,
            volumeMl: 500,
            at: new Date(Date.now() - MIN_PLAUSIBLE_BEER_GAP_MS - 1000).toISOString(),
          },
        ],
      }),
      history: [],
    });
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    await act(async () => {
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
      await Promise.resolve();
    });

    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
    expect(surfaceText(renderer)).not.toContain(copy.counter.rapidInlineConfirm);
  });
});

describe('CounterScreen modal handoffs', () => {
  it('waits for the scanned-drink picker to dismiss before opening the beer form', async () => {
    mockPickMenuPhoto.mockResolvedValue({ status: 'picked', uri: 'file:///menu.jpg' });
    mockScanMenuPhoto.mockResolvedValue({
      status: 'ok',
      drinks: [{ name: 'Kozel 11', drinkType: 'beer', priceCzk: 55, volumeMl: 500 }],
    });
    useNearbyPub.mockReturnValue(nearbyState());
    render();

    await act(async () => {
      await lastProps(ScanMenuSheet).onPick('camera');
      await Promise.resolve();
      await Promise.resolve();
    });

    const picker = lastProps(ScannedDrinkPicker);
    expect(picker.visible).toBe(true);
    act(() => picker.onSelect(picker.drinks[0]));

    expect(lastProps(BeerFormModal).visible).toBe(false);
    act(() => jest.advanceTimersByTime(259));
    expect(lastProps(BeerFormModal).visible).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(lastProps(BeerFormModal)).toMatchObject({ visible: true, mode: 'add' });
  });
});

// ─── 5. Water nudge ──────────────────────────────────────────────────────────

describe('CounterScreen water nudge', () => {
  // Seed a live evening with `drinkCount` beers logged well in the past (so the
  // rapid-drink guard never intercepts the next tap), under a chosen clientId
  // so we can prove the nudge guard is keyed by session identity.
  function seedSession(clientId: string, drinkCount: number) {
    const past = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    useTallyStore.setState({
      current: session({
        clientId,
        startedAt: past,
        drinks: Array.from({ length: drinkCount }, (_, i) => ({
          id: `seed-${clientId}-${i}`,
          beerName: 'Plzeň',
          priceCzk: 62,
          volumeMl: 500,
          at: past,
        })),
      }),
      history: [],
    });
  }

  it('fires once when a session hits its 4th beer, and again for a fresh session', async () => {
    useSettingsStore.setState({ waterNudgeEnabled: true });
    const showToast = jest.fn();
    useToastStore.setState({ show: showToast });
    useNearbyPub.mockReturnValue(nearbyState());

    // Session A already sits at 3 beers → the next tap is the 4th.
    seedSession('session-a', 3);
    const renderer = render();

    await act(async () => {
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
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
      // Past the CTA's double-tap swallow window.
      jest.advanceTimersByTime(800);
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
      await Promise.resolve();
    });

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenLastCalledWith(
      copy.counter.waterNudge(4),
      expect.objectContaining({ icon: expect.anything() }),
    );
  });

  it('stays quiet when the local opt-in is disabled', async () => {
    useSettingsStore.setState({ waterNudgeEnabled: false });
    const showToast = jest.fn();
    useToastStore.setState({ show: showToast });
    useNearbyPub.mockReturnValue(nearbyState());
    seedSession('session-disabled', 3);
    const renderer = render();

    await act(async () => {
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
      await Promise.resolve();
    });

    // The counted toast still confirms the tap — it is not the water nudge, and
    // it must never carry the water copy.
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      copy.counter.countedToast(4),
      expect.objectContaining({ icon: expect.anything() }),
    );
  });

  it('lets the water nudge take the slot instead of the counted toast', async () => {
    useSettingsStore.setState({ waterNudgeEnabled: true });
    const showToast = jest.fn();
    useToastStore.setState({ show: showToast });
    useNearbyPub.mockReturnValue(nearbyState());
    seedSession('session-both', 3);
    const renderer = render();

    await act(async () => {
      surface(renderer, copy.a11y.counterRepeat('Plzeň')).props.onPress();
      await Promise.resolve();
    });

    // One toast slot, so the 4th beer gets the nudge and nothing else.
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      copy.counter.waterNudge(4),
      expect.objectContaining({ icon: expect.anything() }),
    );
  });
});

// ─── 6. Mimo hospodu ─────────────────────────────────────────────────────────

describe('CounterScreen outside a pub', () => {
  it('switches the place chip and counts without a visit or a community override', async () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterPlaceChip(PUB.name)).props.onPress());
    act(() => lastProps(PubPickerModal).onSelectOutside('other'));

    const outsideLabel = copy.counter.outsideLabel('other');
    expect(surfaceText(renderer)).toContain(outsideLabel);
    expect(surface(renderer, copy.a11y.counterPlaceChip(outsideLabel))).toBeTruthy();

    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());
    await submitForm({
      drinkType: 'beer',
      name: 'Lahváč',
      priceCzk: 45,
      volumeMl: 500,
      servingType: 'bottle',
    });

    const current = useTallyStore.getState().current;
    expect(current?.pubKey).toBe('ctx:other');
    expect(current?.placeContext).toBe('other');
    expect(current?.drinks).toHaveLength(1);

    // An outside evening is not a pub visit and never enters community data.
    expect(syncVisit).not.toHaveBeenCalled();
    expect(useCommunityStore.getState().overrides).toEqual({});

    const entry = enqueueDrink.mock.calls[0][0] as any;
    expect(entry.place_context).toBe('other');
    expect(entry.lat).toBeUndefined();
    expect(entry.lng).toBeUndefined();
    expect(entry.external_id).toBeUndefined();
    expect(entry.beer).toEqual({
      name: 'Lahváč',
      price_czk: 45,
      volume_ml: 500,
      serving_type: 'bottle',
    });
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'drink_added',
      context: { had_active_session: false, backdated: false, place_context: 'other' },
    });
  });
});

// ─── 7. Permission gate ──────────────────────────────────────────────────────

describe('CounterScreen permission gate', () => {
  it('renders the gate and still lets you start an outside evening', () => {
    useNearbyPub.mockReturnValue(
      nearbyState({ permissionState: 'undetermined', selected: null, candidates: [] }),
    );
    const renderer = render();

    expect(surfaceText(renderer)).toContain(copy.counter.permTitle);

    act(() => surface(renderer, copy.counter.outsideNoLocationCta).props.onPress());

    const outsideLabel = copy.counter.outsideLabel('other');
    expect(surfaceText(renderer)).not.toContain(copy.counter.permTitle);
    expect(surface(renderer, copy.a11y.counterPlaceChip(outsideLabel))).toBeTruthy();
  });
});

// ─── 8. Teardown ─────────────────────────────────────────────────────────────

describe('CounterScreen teardown', () => {
  it('flushes the drinks queue exactly once on unmount and cancels pending timers', async () => {
    useNearbyPub.mockReturnValue(nearbyState());
    const renderer = render();

    act(() => surface(renderer, copy.a11y.counterAddBeer).props.onPress());
    await submitForm({ drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 });
    expect(flushDrinksQueue).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
      await Promise.resolve();
    });

    expect(flushDrinksQueue).toHaveBeenCalledTimes(1);

    // The deferred-delivery timer was cancelled, so nothing fires afterwards.
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
      await Promise.resolve();
    });

    expect(flushDrinksQueue).toHaveBeenCalledTimes(1);
  });
});
