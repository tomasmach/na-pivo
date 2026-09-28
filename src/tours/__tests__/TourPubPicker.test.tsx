import { act, fireEvent, render } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { checkLocationPermission } from '@/compass/permissions';
import { cachedTourPubs, searchTourPubs } from '@/data/tourPubSearch';
import { t } from '@/i18n';
import type { TourStop } from '../model';
import { DEFAULT_TOUR_REGION, type TourMapProps } from '../TourMap';
import { TourPubPicker } from '../TourPubPicker';

jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, Polyline: () => null, PROVIDER_GOOGLE: 'google' }));
let mockMap: TourMapProps | null = null;
jest.mock('../TourMap', () => ({
  ...jest.requireActual('../TourMap'),
  TourMap: (props: TourMapProps) => { mockMap = props; return null; },
}));
jest.mock('expo-router', () => ({ useIsFocused: () => false, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { latitude: 50.087, longitude: 14.42 } })),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('@/compass/permissions', () => ({ checkLocationPermission: jest.fn(async () => 'granted') }));
jest.mock('@/data/tourPubSearch', () => ({ cachedTourPubs: jest.fn(async () => []), filterTourPubs: (pubs: unknown[]) => pubs, searchTourPubs: jest.fn() }));
jest.mock('@/stores/pubStore', () => ({ usePubStore: (select: (s: object) => unknown) => select({ reportedPubIds: [], reportedCacheKeys: [] }) }));
jest.mock('@/components/amenities/MapPubSheet', () => ({ MapPubSheet: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronLeftIcon: () => null, ChevronRightIcon: () => null, PlusIcon: () => null, SearchIcon: () => null, XIcon: () => null }));
jest.mock('@/utils/haptics', () => ({ fireLightImpactHaptic: jest.fn() }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ hapticEnabled: false }) } }));
jest.mock('@/utils/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/stores/pubPageStore', () => ({ pubPageRef: () => '', usePubPageStore: () => undefined }));

const stop: TourStop = { id: 's1', pubId: 'p1', name: 'U Fleků', lat: 49.19, lon: 16.61 } as TourStop;
const onToggle = jest.fn(async () => true);
const onReplace = jest.fn();
const onClose = jest.fn();
const open = async (stops: TourStop[], replaceStop?: TourStop) => {
  const screen = render(<TourPubPicker visible stops={stops} replaceStop={replaceStop} onToggle={onToggle} onReplace={onReplace} onClose={onClose} />);
  await act(async () => {});
  return screen;
};

beforeEach(() => { jest.clearAllMocks(); mockMap = null; jest.mocked(cachedTourPubs).mockResolvedValue([]); });

it('opens a new tour around the last known position, not the whole country', async () => {
  await open([]);
  expect(mockMap?.region).toMatchObject({ latitude: 50.087, longitude: 14.42, latitudeDelta: 0.055 });
});

it('falls back to a fresh fix, but never moves the map once you started searching', async () => {
  let resolveFix: (fix: Location.LocationObject) => void = () => {};
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValueOnce(null);
  jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(new Promise((resolve) => { resolveFix = resolve; }));
  const screen = await open([]);
  fireEvent.changeText(screen.getByLabelText(t.tours.searchPlaceholder), 'x');
  await act(async () => { resolveFix({ coords: { latitude: 50.087, longitude: 14.42 } } as Location.LocationObject); });
  expect(mockMap?.region).toEqual(DEFAULT_TOUR_REGION);
});

it('keeps a panned map when a late fix arrives', async () => {
  let resolveFix: (fix: Location.LocationObject) => void = () => {};
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValueOnce(null);
  jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(new Promise((resolve) => { resolveFix = resolve; }));
  await open([]);
  const panned = { ...DEFAULT_TOUR_REGION, latitude: 49.19, longitude: 16.61 };
  await act(async () => { mockMap?.onRegionChange?.(panned); });
  await act(async () => { resolveFix({ coords: { latitude: 50.087, longitude: 14.42 } } as Location.LocationObject); });
  expect(mockMap?.region).toEqual(panned);
});

it('uses an old fix when no fresh one comes', async () => {
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValueOnce(null).mockResolvedValueOnce({ coords: { latitude: 49.19, longitude: 16.61 } } as Location.LocationObject);
  jest.mocked(Location.getCurrentPositionAsync).mockRejectedValueOnce(new Error('Location services are off'));
  await open([]);
  expect(Location.getLastKnownPositionAsync).toHaveBeenNthCalledWith(1, { maxAge: 600000 });
  expect(mockMap?.region).toMatchObject({ latitude: 49.19, longitude: 16.61 });
});

it('keeps the country view without location permission and never asks for it', async () => {
  jest.mocked(checkLocationPermission).mockResolvedValueOnce('undetermined');
  await open([]);
  expect(mockMap?.region).toEqual(DEFAULT_TOUR_REGION);
  expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
});

it('keeps an existing tour framed on its stops', async () => {
  await open([stop]);
  expect(mockMap?.region).toMatchObject({ latitude: 49.19, longitude: 16.61 });
  expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
});

const pub = (id: string, name: string, lat: number, lng: number) => ({ id, name, lat, lng, address: 'Praha' });
const stopAt = (n: number, lat = 50.08, lon = 14.44): TourStop => ({ id: `00000000-0000-4000-8000-00000000000${n}`, pubId: `s${n}`, cacheKey: null, name: `Stop ${n}`, address: 'Praha', lat, lon });

it('adds a pub with one tap and stays open for the next one', async () => {
  jest.mocked(cachedTourPubs).mockResolvedValueOnce([pub('a', 'Kaštan', 50.08, 14.45)]);
  const screen = await open([]);
  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.addPubA11y('Kaštan'))); });
  expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText(t.tours.needTwo)).toBeTruthy();
});

it('takes a pub back out with a second tap on its numbered row', async () => {
  const added = stopAt(1);
  jest.mocked(searchTourPubs).mockResolvedValue({ pubs: [pub('s1', 'Stop 1', added.lat, added.lon)], status: 'ok' });
  const screen = await open([added]);
  const input = screen.getByLabelText(t.tours.searchPlaceholder);
  fireEvent.changeText(input, 'Stop');
  await act(async () => { fireEvent(input, 'submitEditing'); });
  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.removePubA11y('Stop 1', 1))); });
  expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
});

it('offers the nearest pubs from the last stop with walking minutes', async () => {
  jest.mocked(cachedTourPubs).mockResolvedValueOnce([
    pub('far', 'Daleko', 50.2, 14.6), pub('mid', 'Kousek dál', 50.086, 14.44), pub('near', 'Hned vedle', 50.081, 14.44), pub('s1', 'Stop 1', 50.08, 14.44),
  ]);
  const screen = await open([stopAt(1)]);
  expect(screen.getByText(t.tours.nearStop(1))).toBeTruthy();
  const names = screen.getAllByText(/Hned vedle|Kousek dál|Daleko/).map((node) => node.props.children);
  expect(names).toEqual(['Hned vedle', 'Kousek dál']);
  expect(screen.getByText(new RegExp(t.tours.walkMinutes(2)))).toBeTruthy();
});

it('refuses a ninth pub and says why', async () => {
  jest.mocked(cachedTourPubs).mockResolvedValue([pub('x', 'Devátá', 50.081, 14.44)]);
  const screen = await open([1, 2, 3, 4, 5, 6, 7, 8].map((n) => stopAt(n, 50 + n / 100)));
  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.addPubA11y('Devátá'))); });
  expect(onToggle).not.toHaveBeenCalled();
  expect(screen.getByText(t.tours.pickerFull)).toBeTruthy();
});

it('removes a picked pub from the bar even when search no longer lists it', async () => {
  const screen = await open([stopAt(1), stopAt(2, 50.09)]);
  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.removeChipA11y('Stop 2'))); });
  expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 's2', name: 'Stop 2' }));
  fireEvent.press(screen.getByTestId('tour-picker-done'));
  expect(onClose).toHaveBeenCalled();
});

it('replaces a stop with a single tap', async () => {
  jest.mocked(cachedTourPubs).mockResolvedValueOnce([pub('a', 'Kaštan', 50.08, 14.45)]);
  const screen = await open([stopAt(1)], stopAt(1));
  await act(async () => { fireEvent.press(screen.getByLabelText('Kaštan')); });
  expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  expect(onToggle).not.toHaveBeenCalled();
});

it('lists a pub once even when search and the cache know it under two ids', async () => {
  jest.mocked(cachedTourPubs).mockResolvedValue([pub('directory:a', 'Radegast', 50.081, 14.44), pub('osm:9', 'Radegast', 50.081, 14.44)]);
  const screen = await open([stopAt(1)]);
  expect(screen.getAllByText('Radegast')).toHaveLength(1);
});

it('lists the pubs nearest the middle of the map first and follows the map as you pan', async () => {
  const brno = { id: 'brno', name: 'Lokál Brno', lat: 49.195, lng: 16.607 };
  const opava = { id: 'opava', name: 'Radegastovna', lat: 49.938, lng: 17.902 };
  const prague = { id: 'prague', name: 'U Zlatého tygra', lat: 50.086, lng: 14.419 };
  jest.mocked(cachedTourPubs).mockResolvedValueOnce([brno, opava, prague]);
  const screen = await open([]);
  const listed = () => screen.getAllByText(/^(Lokál Brno|Radegastovna|U Zlatého tygra)$/).map((node) => node.props.children as string);
  expect(listed()).toEqual(['U Zlatého tygra', 'Lokál Brno', 'Radegastovna']);
  expect(mockMap?.candidates?.map((pub) => pub.id)).toEqual(['prague', 'brno', 'opava']);
  await act(async () => { mockMap?.onRegionChange?.({ ...DEFAULT_TOUR_REGION, latitude: 49.9, longitude: 17.9 }); });
  expect(listed()).toEqual(['Radegastovna', 'Lokál Brno', 'U Zlatého tygra']);
});

it('finds pubs beside the last stop even when the map centre sits far away', async () => {
  const midway = Array.from({ length: 60 }, (_, i) => pub(`mid${i}`, `Cestou ${i}`, 49.6 + i / 1000, 15.5));
  jest.mocked(cachedTourPubs).mockResolvedValue([...midway, pub('brno', 'U Brňáka', 49.1955, 16.6085)]);
  const screen = await open([stopAt(1, 50.08, 14.44), stopAt(2, 49.195, 16.608)]);
  expect(screen.getByText('U Brňáka')).toBeTruthy();
});
