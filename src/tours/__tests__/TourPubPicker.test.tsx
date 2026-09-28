import { act, fireEvent, render } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { checkLocationPermission } from '@/compass/permissions';
import { cachedTourPubs } from '@/data/tourPubSearch';
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
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronLeftIcon: () => null, ChevronRightIcon: () => null, SearchIcon: () => null, XIcon: () => null }));

const stop: TourStop = { id: 's1', pubId: 'p1', name: 'U Fleků', lat: 49.19, lon: 16.61 } as TourStop;
const open = async (stops: TourStop[]) => {
  const screen = render(<TourPubPicker visible stops={stops} onSelect={jest.fn()} onClose={jest.fn()} />);
  await act(async () => {});
  return screen;
};

beforeEach(() => { jest.clearAllMocks(); mockMap = null; });

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
