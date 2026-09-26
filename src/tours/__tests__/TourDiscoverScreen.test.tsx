import { act, fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import { searchPublicTours, type PublicTourHit } from '@/data/toursClient';
import { checkLocationPermission, ensureLocationPermission } from '@/compass/permissions';
import TourDiscoverScreen from '../TourDiscoverScreen';

const mockPush = jest.fn();
const mockStore = { hiddenPublic: ['44444444-4444-4444-8444-444444444444'] as string[] | undefined };
// The shared react-native mock renders FlatList rows as nothing; here the rows are the point.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const { createElement, Fragment } = jest.requireActual('react');
  type Props = { data: unknown[]; renderItem: (info: { item: unknown }) => unknown; keyExtractor: (item: unknown) => string; ListHeaderComponent?: unknown; ListFooterComponent?: unknown };
  return { ...actual, FlatList: ({ data, renderItem, keyExtractor, ListHeaderComponent, ListFooterComponent }: Props) =>
    createElement(actual.View, null, ListHeaderComponent, ...data.map((item) => createElement(Fragment, { key: keyExtractor(item) }, renderItem({ item }))), ListFooterComponent) };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { latitude: 50.087, longitude: 14.42 } })),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('@/compass/permissions', () => ({ checkLocationPermission: jest.fn(async () => 'undetermined'), ensureLocationPermission: jest.fn(async () => 'denied') }));
jest.mock('@/data/toursClient', () => ({ searchPublicTours: jest.fn() }));
jest.mock('@/stores/toursStore', () => ({
  useToursStore: Object.assign((select: (s: typeof mockStore) => unknown) => select(mockStore), { getState: () => ({ beginDraft: jest.fn(async () => ({ ok: true })), hydrate: jest.fn(async () => ({ ok: true })) }) }),
}));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null, ChevronDownIcon: () => null, ChevronLeftIcon: () => null, ChevronRightIcon: () => null, SearchIcon: () => null, XIcon: () => null }));

const hit = (title: string, extra: Partial<PublicTourHit> = {}): PublicTourHit => ({
  id: '33333333-3333-4333-8333-333333333333', token: 'publicTokenForTests12', title, city: 'Praha', stopCount: 3, walkM: 1200, hasChallenges: true,
  peopleCount: 5, distanceM: null, author: { id: 'a', nickname: 'pivni_vlk', displayName: '', avatarUrl: null }, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('lists public tours, leaves out reported ones and opens a tour', async () => {
  jest.mocked(searchPublicTours).mockResolvedValue({ ok: true, nearby: true, nextPage: null,
    results: [hit('Pátek u tygra'), hit('Nahlášená', { id: '44444444-4444-4444-8444-444444444444' })] });
  const screen = render(<TourDiscoverScreen />);
  const row = await screen.findByText('Pátek u tygra');
  expect(screen.queryByText('Nahlášená')).toBeNull();
  expect(screen.getByText(`pivni_vlk · ${t.tours.discoverPeople(5)} · ${t.tours.discoverWithChallenges}`)).toBeTruthy();
  // Without a location nothing asks for it until "Kolem mě" is tapped.
  expect(ensureLocationPermission).not.toHaveBeenCalled();
  expect(jest.mocked(searchPublicTours).mock.calls[0][0]).toEqual({ q: '', stops: null, challenges: false });
  fireEvent.press(row);
  expect(mockPush).toHaveBeenCalledWith('/t/publicTokenForTests12');
});

it('sorts by distance once location is allowed, and points to the text field when it is not', async () => {
  jest.mocked(searchPublicTours).mockResolvedValue({ ok: true, nearby: true, nextPage: null, results: [hit('Pátek u tygra', { distanceM: 350 })] });
  const screen = render(<TourDiscoverScreen />);
  await screen.findByText('Pátek u tygra');
  await act(async () => { fireEvent.press(screen.getByText(t.tours.discoverNearMe)); });
  expect(screen.getByText(t.tours.discoverNoLocation)).toBeTruthy();

  jest.mocked(checkLocationPermission).mockResolvedValueOnce('granted');
  const located = render(<TourDiscoverScreen />);
  expect(await located.findByText('350 m')).toBeTruthy();
  expect(jest.mocked(searchPublicTours).mock.calls.at(-1)![0]).toMatchObject({ lat: 50.087, lon: 14.42 });
});

it('explains empty filters, nothing nearby and a lost connection', async () => {
  jest.mocked(searchPublicTours).mockResolvedValue({ ok: true, nearby: true, nextPage: null, results: [] });
  const screen = render(<TourDiscoverScreen />);
  expect(await screen.findByText(t.tours.discoverNothing)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText(t.tours.discoverChallenges)); });
  expect(await screen.findByText(t.tours.discoverNothingFiltered)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText(t.tours.discoverClearFilters)); });
  expect(await screen.findByText(t.tours.discoverNothing)).toBeTruthy();

  jest.mocked(searchPublicTours).mockResolvedValue({ ok: true, nearby: false, nextPage: null, results: [hit('Brněnský okruh', { distanceM: 187500 })] });
  const far = render(<TourDiscoverScreen />);
  expect(await far.findByText(t.tours.discoverNothingNear)).toBeTruthy();
  // With a filter on, "nobody published anything" would be a lie.
  await act(async () => { fireEvent.press(far.getByText(t.tours.discoverChallenges)); });
  expect(await far.findByText(t.tours.discoverNothingNearFiltered)).toBeTruthy();
  expect(far.getByText(t.tours.discoverClearFilters)).toBeTruthy();

  jest.mocked(searchPublicTours).mockResolvedValue({ ok: false, offline: true });
  const offline = render(<TourDiscoverScreen />);
  expect(await offline.findByText(t.tours.discoverOffline)).toBeTruthy();
  jest.mocked(searchPublicTours).mockResolvedValue({ ok: true, nearby: true, nextPage: null, results: [hit('Pátek u tygra')] });
  await act(async () => { fireEvent.press(offline.getByText(t.tours.retry)); });
  expect(await offline.findByText('Pátek u tygra')).toBeTruthy();
});

it('keeps the last list on screen while the next search is on its way', async () => {
  jest.mocked(searchPublicTours).mockResolvedValueOnce({ ok: true, nearby: true, nextPage: null, results: [hit('Pátek u tygra')] });
  const screen = render(<TourDiscoverScreen />);
  await screen.findByText('Pátek u tygra');
  jest.mocked(searchPublicTours).mockReturnValue(new Promise(() => undefined));
  await act(async () => { fireEvent.press(screen.getByText(t.tours.discoverChallenges)); });
  expect(screen.getByText('Pátek u tygra')).toBeTruthy();
  // "!!" is not a search the server understands, so nothing new is asked for.
  const asked = jest.mocked(searchPublicTours).mock.calls.length;
  fireEvent.changeText(screen.getByLabelText(t.tours.discoverOpen), '!!');
  expect(jest.mocked(searchPublicTours).mock.calls.length).toBe(asked);
});
