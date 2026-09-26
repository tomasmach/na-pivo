import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { t } from '@/i18n';
import { showAppDialog } from '@/components/shared/AppDialog';
import { openPubInMaps } from '@/utils/maps';
import { fetchPubHours } from '@/data/hoursClient';
import { useCounterHandoffStore } from '@/stores/counterHandoffStore';
import type { TourPlan, TourRun } from '../model';
import { TourJourneyIllustration } from '../TourJourneyIllustration';
import TourDetailScreen from '../TourDetailScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tourId = '11111111-1111-4111-8111-111111111111';
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockStore = {
  plans: [] as TourPlan[],
  activeRun: null as TourRun | null,
  runs: [] as TourRun[],
  published: {} as Record<string, string>,
  pending: {},
  hydrated: true,
  error: null,
  busy: false,
  hydrate: jest.fn(async () => ({ ok: true })),
  copyPlan: jest.fn(async () => ({ ok: true as const, id: 'copied-plan' })),
  markStop: jest.fn(async (id: string, status: 'visited' | 'skipped' | null) => {
    if (!mockStore.activeRun) throw new Error('No active run');
    const statuses = { ...mockStore.activeRun.statuses };
    if (status === null) delete statuses[id]; else statuses[id] = status;
    mockStore.activeRun = { ...mockStore.activeRun, statuses };
    return { ok: true as const };
  }),
};

jest.mock('react-native', () => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    ...native,
    AccessibilityInfo: { ...native.AccessibilityInfo, announceForAccessibility: jest.fn() },
    BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    ScrollView: react.forwardRef((props: { children?: React.ReactNode }, ref) => {
      react.useImperativeHandle(ref, () => ({ scrollTo: jest.fn() }));
      return react.createElement('ScrollView', props, props.children);
    }),
  };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: tourId }),
  useRouter: () => ({ replace: mockReplace, canGoBack: () => true, back: mockBack, push: mockPush, navigate: mockPush }),
  useIsFocused: () => true,
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/stores/toursStore', () => ({
  useToursStore: Object.assign(() => mockStore, { getState: () => mockStore }),
  tourContentSignature: (plan: TourPlan) => JSON.stringify(plan.stops),
}));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/amenities/MapPubSheet', () => ({ MapPubSheet: () => null }));
jest.mock('@/components/amenities/pubInfoContext', () => ({ pubInfoFromPub: jest.fn() }));
jest.mock('@/utils/maps', () => ({ openPubInMaps: jest.fn(async () => undefined) }));
jest.mock('@/data/pubs', () => ({ getAllLoadedPubs: () => [] }));
const mockTally = { current: null as null | { pubKey: string; drinks: { drinkType?: string; at: string }[] }, history: [] as { pubKey: string; drinks: { at: string }[] }[] };
jest.mock('@/stores/tallyStore', () => ({ useTallyStore: (select: (s: typeof mockTally) => unknown) => select(mockTally) }));
jest.mock('@/data/hoursClient', () => ({ fetchPubHours: jest.fn(async () => new Map()) }));
jest.mock('../TourJourneyIllustration', () => ({ TourJourneyIllustration: jest.fn(() => null) }));
jest.mock('../TourCrew', () => ({ TourCrewRow: ({ ping, onPing }: { ping: boolean; onPing: () => void }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text onPress={onPing}>{`crew-row ping:${ping}`}</Text>;
}, TourCrewSheet: () => null, going: (crew: { members?: { left: boolean }[] }) => (crew.members ?? []).filter((member) => !member.left),
inviting: (crew?: { closed?: boolean; refused?: boolean }) => !!crew && !crew.closed && !crew.refused }));
jest.mock('@/friends/PingSheet', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('@/data/friendsQueue', () => ({ friendActivityState: jest.fn(async () => 'queued') }));
// Undefined keeps the party unknown for tests that do not care, so no late state update lands after them.
const mockFriends = { current: undefined as { ghost: boolean; friends: { id: string }[] } | null | undefined };
jest.mock('@/data/friendsClient', () => ({
  loadPartyFriends: jest.fn(() => mockFriends.current === undefined ? new Promise(() => undefined) : Promise.resolve(mockFriends.current)),
}));
jest.mock('../crewPing', () => ({ ...jest.requireActual('../crewPing'), sendPing: jest.fn(async () => ({ status: 'sent', clientId: 'c1' })) }));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: () => false, selectIsSignedIn: () => false, selectNickname: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null, CheckIcon: () => null, ChevronLeftIcon: () => null, ChevronRightIcon: () => null,
  CompassIcon: () => null, EllipsisIcon: () => null, FootprintsIcon: () => null, HistoryIcon: () => null,
  LockKeyholeIcon: () => null, MapIcon: () => null, MinusIcon: () => null,
}));
jest.mock('../TourMap', () => ({
  TourMap: ({ stops, onSelect, preview }: {
    stops: TourPlan['stops']; onSelect: (id: string) => void; preview?: boolean;
  }) => {
    const react = jest.requireActual<typeof import('react')>('react');
    const native = jest.requireActual<typeof import('react-native')>('react-native');
    return preview ? null : react.createElement(native.View, { testID: 'full-tour-map' },
      stops.map((stop) => react.createElement(native.Pressable, {
        key: stop.id, accessibilityRole: 'button', accessibilityLabel: `Map: ${stop.name}`,
        onPress: () => onSelect(stop.id),
      })));
  },
}));

function plan(title: string, prefix: string): TourPlan {
  return {
    id: tourId, title, revision: 1, updatedAt: '2026-09-18T10:00:00Z',
    scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague',
    stops: [1, 2].map((number) => ({
      id: `${prefix}-${number}`, pubId: `${prefix}-pub-${number}`, cacheKey: null,
      name: `${prefix} hospoda ${number}`, address: 'Praha', lat: 50 + number / 100, lon: 14,
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.plans = [plan('Současný plán', 'Plán')];
  mockStore.activeRun = {
    id: 'active-run', planId: tourId, snapshot: plan('Probíhající večer', 'Aktivní'),
    startedAt: '2026-09-18T17:00:00Z', endedAt: null, statuses: {},
  };
  mockStore.runs = [];
  mockStore.published = {};
  mockFriends.current = undefined;
});

it('marks the next stop, navigates to the following one, and restores the first with undo', async () => {
  const first = mockStore.activeRun!.snapshot.stops[0];
  const second = mockStore.activeRun!.snapshot.stops[1];
  const screen = render(<TourDetailScreen />);
  expect(screen.getByLabelText(`1. ${first.name}. ${t.tours.nextStop} · Praha`)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.navigate)).toBeTruthy();

  fireEvent.press(screen.getByLabelText(`1. ${first.name}. ${t.tours.nextStop} · Praha`));
  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.markVisited)); });
  screen.rerender(<TourDetailScreen />);
  expect(mockStore.markStop).toHaveBeenLastCalledWith(first.id, 'visited');
  // The pub the group sits in stays visible instead of jumping straight to the next one.
  expect(screen.getByLabelText(`1. ${first.name}. ${t.tours.youAreHere}`)).toBeTruthy();
  expect(screen.getByLabelText(`2. ${second.name}. ${t.tours.nextStop} · Praha`)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.logBeerAt(2))).toBeTruthy();
  fireEvent.press(screen.getByLabelText(t.tours.navigateMinutes(17)));
  expect(openPubInMaps).toHaveBeenLastCalledWith({ lat: second.lat, lng: second.lon, name: second.name });

  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.undo)); });
  screen.rerender(<TourDetailScreen />);
  expect(mockStore.markStop).toHaveBeenLastCalledWith(first.id, null);
  expect(screen.getByLabelText(`1. ${first.name}. ${t.tours.nextStop} · Praha`)).toBeTruthy();
  expect(screen.getByLabelText(`2. ${second.name}. Praha`)).toBeTruthy();
  expect(screen.queryByLabelText(t.tours.undo)).toBeNull();
});

it('shows the historical snapshot without active-run actions and returns to the active run', () => {
  const snapshot = plan('Minulý večer', 'Historická');
  mockStore.runs = [{
    id: 'past-run', planId: tourId, snapshot, startedAt: '2026-09-10T17:00:00Z',
    endedAt: '2026-09-10T21:00:00Z', statuses: { [snapshot.stops[0].id]: 'visited' },
  }];
  const screen = render(<TourDetailScreen />);
  fireEvent.press(screen.getByLabelText(new RegExp(`^${t.tours.pastRun}\\.`)));

  expect(screen.getByText(snapshot.title)).toBeTruthy();
  expect(screen.getByLabelText(`1. ${snapshot.stops[0].name}. ${t.tours.visited}`)).toBeTruthy();
  expect(screen.queryByText(mockStore.plans[0].title)).toBeNull();
  expect(screen.queryByText(mockStore.activeRun!.snapshot.title)).toBeNull();
  expect(screen.queryByLabelText(t.tours.logBeerAt(1))).toBeNull();
  expect(screen.queryByLabelText(t.tours.navigate)).toBeNull();
  expect(screen.getByLabelText(t.tours.repeat)).toBeTruthy();

  fireEvent.press(screen.getByLabelText(t.tours.back));
  expect(screen.getByText(mockStore.activeRun!.snapshot.title)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.logBeerAt(1))).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
});

it('copies the history being displayed from both copy actions', async () => {
  mockStore.runs = [{
    id: 'past-run', planId: tourId, snapshot: plan('Minulý večer', 'Historická'),
    startedAt: '2026-09-10T17:00:00Z', endedAt: '2026-09-10T21:00:00Z', statuses: {},
  }];
  const screen = render(<TourDetailScreen />);
  fireEvent.press(screen.getByLabelText(new RegExp(`^${t.tours.pastRun}\\.`)));
  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.repeat)); });
  expect(mockStore.copyPlan).toHaveBeenLastCalledWith(tourId, 'past-run');
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/tours/[id]', params: { id: 'copied-plan' } });
  fireEvent.press(screen.getByLabelText(t.tours.more));
  const dialog = jest.mocked(showAppDialog).mock.calls[0][0];
  await act(async () => { dialog.buttons!.find((button) => button.text === t.tours.repeat)!.onPress!(); });
  expect(mockStore.copyPlan).toHaveBeenCalledTimes(2);
  expect(mockStore.copyPlan).toHaveBeenLastCalledWith(tourId, 'past-run');
});

it('shows only plan content in share mode, including the illustration and stop detail', () => {
  // Use the same stop IDs so accidentally leaked run states cannot hide behind different IDs.
  mockStore.plans[0].stops = mockStore.activeRun!.snapshot.stops;
  mockStore.activeRun!.statuses = { [mockStore.plans[0].stops[0].id]: 'visited', [mockStore.plans[0].stops[1].id]: 'skipped' };
  const screen = render(<TourDetailScreen />);
  fireEvent.press(screen.getByLabelText(t.tours.more));
  const dialog = jest.mocked(showAppDialog).mock.calls[0][0];
  act(() => { dialog.buttons!.find((button) => button.text === t.tours.share)!.onPress!(); });

  expect(screen.getByText(mockStore.plans[0].title)).toBeTruthy();
  expect(screen.queryByText(mockStore.activeRun!.snapshot.title)).toBeNull();
  expect(screen.queryByText(t.tours.visited)).toBeNull();
  expect(screen.queryByText(t.tours.skipped)).toBeNull();
  expect(screen.queryByLabelText(t.tours.markVisited)).toBeNull();
  expect(screen.queryByLabelText(t.tours.privateRun)).toBeNull();
  expect(screen.queryByLabelText(t.tours.end)).toBeNull();
  const artworkCalls = jest.mocked(TourJourneyIllustration).mock.calls;
  const artworkProps = artworkCalls[artworkCalls.length - 1][0];
  expect(artworkProps.statuses).toBeUndefined();
  expect(artworkProps.nextStopId).toBeUndefined();
  expect(screen.getByLabelText(t.tours.createLink)).toBeTruthy();

  const first = mockStore.plans[0].stops[0];
  fireEvent.press(screen.getByLabelText(`1. ${first.name}. ${t.tours.firstStop} · ${first.address}`));
  expect(screen.queryByLabelText(t.tours.markVisited)).toBeNull();
  expect(screen.queryByLabelText(t.tours.undoMark)).toBeNull();
  expect(screen.queryByLabelText(t.tours.skip)).toBeNull();
});

it('opens the full map, selects a stop, and restores the main controls on close', async () => {
  const screen = render(<TourDetailScreen />);
  expect(screen.queryByTestId('full-tour-map')).toBeNull();
  fireEvent.press(screen.getByLabelText(t.tours.openMap));
  expect(screen.getByTestId('full-tour-map')).toBeTruthy();
  expect(screen.queryByLabelText(t.tours.logBeerAt(1))).toBeNull();

  const second = mockStore.activeRun!.snapshot.stops[1];
  fireEvent.press(screen.getByLabelText(`Map: ${second.name}`));
  expect(screen.getByText(`2. ${second.name}`)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.fullPubDetail)).toBeTruthy();
  fireEvent.press(screen.getByLabelText(t.tours.back));
  await waitFor(() => expect(screen.queryByTestId('full-tour-map')).toBeNull());
  expect(screen.getByLabelText(t.tours.logBeerAt(1))).toBeTruthy();
  expect(screen.getByLabelText(t.tours.openMap)).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
});

it('shows walking legs, meetup-day hours, taps and a closed stop in a plan', async () => {
  mockStore.activeRun = null;
  mockStore.plans[0].scheduledDate = '2030-01-04';
  const [first, second] = mockStore.plans[0].stops;
  const week = { mo: [['12:00', '22:00']], tu: [], we: [], th: [], fr: [['15:00', '23:00']], sa: [], su: [] };
  jest.mocked(fetchPubHours).mockResolvedValueOnce(new Map([
    [first.id, { communityHours: week, openingHours: null, beers: [{ name: 'Pilsner Urquell' }] }],
    [second.id, { communityHours: { ...week, fr: [] }, openingHours: null, beers: [] }],
  ]) as never);
  const screen = render(<TourDetailScreen />);

  expect(screen.getByText(t.tours.walkLeg('1,4 km', 17))).toBeTruthy();
  expect(await screen.findByText(`${t.tours.onDay[4]} 15:00–23:00`)).toBeTruthy();
  expect(screen.getByText(/Pilsner Urquell/)).toBeTruthy();
  expect(screen.getByText(t.tours.closedOn(t.tours.onDay[4]))).toBeTruthy();
  expect(screen.getByText(t.tours.closedOnMeetup(second.name, 1))).toBeTruthy();
  expect(jest.mocked(fetchPubHours).mock.calls[0][2]).toEqual({ syncBudget: 0 });
});

it('offers adding a meetup to an undated plan', () => {
  mockStore.activeRun = null;
  const screen = render(<TourDetailScreen />);
  expect(screen.getByLabelText(t.tours.addMeetup)).toBeTruthy();
  expect(screen.queryByText(new RegExp(t.tours.optional))).toBeNull();
});

it('keeps the group at the last visited pub when the stop after it is skipped', async () => {
  const stop = (n: number) => ({ id: `Běh-${n}`, pubId: `běh-pub-${n}`, cacheKey: null, name: `Běh hospoda ${n}`, address: 'Praha', lat: 50 + n / 100, lon: 14 });
  const snapshot = { ...plan('Tři hospody', 'Běh'), stops: [stop(1), stop(2), stop(3)] };
  mockStore.activeRun = { ...mockStore.activeRun!, snapshot, statuses: { 'Běh-1': 'visited', 'Běh-2': 'skipped' } };
  const screen = render(<TourDetailScreen />);
  expect(screen.getByLabelText(`1. Běh hospoda 1. ${t.tours.youAreHere}`)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.logBeerAt(3))).toBeTruthy();
  // 1 → 3 is about 2.2 km of air distance, not the 2 → 3 leg.
  expect(screen.getByLabelText(t.tours.navigateMinutes(35))).toBeTruthy();
});

it('hands the next stop to the counter and shows beers counted at visited stops', () => {
  const [first, second] = mockStore.activeRun!.snapshot.stops;
  mockStore.activeRun!.statuses = { [first.id]: 'visited' };
  mockTally.current = { pubKey: 'u2fkbnjj', drinks: [{ at: '2026-09-18T17:30:00Z' }, { at: '2026-09-18T18:10:00Z' }, { at: '2026-09-17T18:10:00Z' }] };
  first.cacheKey = 'u2fkbnjj';
  const screen = render(<TourDetailScreen />);
  // Two beers since the run started at 17:00; yesterday's beer does not count.
  expect(screen.getByLabelText(`1. ${first.name}. ${t.tours.youAreHere} · 2 piva`)).toBeTruthy();
  fireEvent.press(screen.getByLabelText(t.tours.logBeerAt(2)));
  expect(useCounterHandoffStore.getState().pub).toEqual({ id: second.pubId, name: second.name, lat: second.lat, lng: second.lon, address: 'Praha' });
  expect(mockPush).toHaveBeenLastCalledWith('/(tabs)/beer');
  mockTally.current = null;
});


it('offers pinging friends on a run without a crew, but not in invisible mode or without friends', async () => {
  mockFriends.current = null;
  const screen = render(<TourDetailScreen />);
  await act(async () => undefined);
  expect(screen.queryByText(/crew-row/)).toBeNull();
  mockFriends.current = { ghost: false, friends: [{ id: 'eva' }] };
  const withFriends = render(<TourDetailScreen />);
  expect(await withFriends.findByText('crew-row ping:true')).toBeTruthy();
  // Tapping the row opens the sheet to pick who; sending there goes to Eva and the row learns it went out.
  const PingSheet = jest.requireMock('@/friends/PingSheet').default as jest.Mock;
  fireEvent.press(withFriends.getByText('crew-row ping:true'));
  const sheet = PingSheet.mock.calls.at(-1)[0];
  expect(sheet.friends).toEqual([{ id: 'eva' }]);
  const { sendPing } = jest.requireMock('../crewPing');
  await act(async () => { expect(await sheet.onSend(['eva'])).toBeNull(); });
  expect(sendPing).toHaveBeenCalledWith('Probíhající večer', expect.objectContaining({ heading: true }), ['eva']);
  mockFriends.current = { ghost: true, friends: [{ id: 'eva' }] };
  const ghost = render(<TourDetailScreen />);
  await act(async () => undefined);
  expect(ghost.queryByText(/crew-row/)).toBeNull();
});
