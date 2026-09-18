import React, { forwardRef, useImperativeHandle } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { t } from '@/i18n';
import { geohash8 } from '@/data/geohash';
import type { FriendPubActivity } from '@/data/friendsClient';
import { EMPTY_PUB_SEARCH_FILTERS } from '@/data/pubSearchFilters';
import BeerMapScreen, { resetBeerMapLayerForAddedPub } from '../BeerMapScreen';
import { fetchPubHours } from '@/data/hoursClient';
import { enqueuePubReport } from '@/data/pubReportQueue';
import { useBeerMap } from '../useBeerMap';

const mockPubStoreState = {
  reportedPubIds: [] as string[],
  reportedCacheKeys: [] as string[],
  addReportedPub: jest.fn(),
};
let mockColorScheme: 'light' | 'dark' | null = 'dark';
const mockAnimateCamera = jest.fn();
const mockAnimateToRegion = jest.fn();

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    AccessibilityInfo: { announceForAccessibility: jest.fn(async () => undefined) },
    Image: 'Image',
    useColorScheme: () => mockColorScheme,
    Modal: ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) =>
      visible ? <RN.View>{children}</RN.View> : null,
  };
});

jest.mock('react-native-maps', () => ({
  __esModule: true,
  default: forwardRef(function MockMapView(
    {
      accessibilityLabel,
      children,
      userInterfaceStyle,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      userInterfaceStyle?: 'light' | 'dark';
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      animateCamera: mockAnimateCamera,
      animateToRegion: mockAnimateToRegion,
    }));
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: userInterfaceStyle }}
      >
        {children}
      </View>
    );
  }),
  Marker: ({ children, onPress, accessibilityLabel, tracksViewChanges }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    tracksViewChanges?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: tracksViewChanges ? 'tracking' : 'frozen' }}
    >
      {children}
    </Pressable>
  ),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock('../useBeerMap', () => ({ useBeerMap: jest.fn() }));
jest.mock('@/data/hoursClient', () => ({ fetchPubHours: jest.fn() }));
jest.mock('@/data/pubReportQueue', () => ({ enqueuePubReport: jest.fn(async () => true) }));
jest.mock('@/stores/pubStore', () => ({
  usePubStore: (selector: (state: typeof mockPubStoreState) => unknown) =>
    selector(mockPubStoreState),
}));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@/utils/haptics', () => ({ fireLightImpactHaptic: jest.fn() }));
jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { extrabold: 'display-extrabold' },
    ui: {
      regular: 'ui-regular',
      medium: 'ui-medium',
      semibold: 'ui-semibold',
      bold: 'ui-bold',
    },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { hapticEnabled: boolean }) => unknown) =>
    selector({ hapticEnabled: false }),
}));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: { session: null }) => unknown) => selector({ session: null }),
}));
jest.mock('@/components/amenities/MapPubSheet', () => ({ MapPubSheet: () => null }));
jest.mock('@/components/compass/PubFilterSheet', () => ({ PubFilterSheet: () => null }));
jest.mock('@/components/compass/OpenStatusChip', () => ({
  OpenStatusChip: ({ status }: { status?: string }) => (
    <Text>{status === 'loading' || status === 'pending' ? t.compass.detailsLoading : t.compass.hoursUnknown}</Text>
  ),
}));
jest.mock('@/components/shared/ExploreSwitch', () => ({ ExploreSwitch: () => null }));
jest.mock('@/components/shared/IconGlyph', () => {
  const MockIcon = () => null;
  return {
    BeerIcon: MockIcon,
    CheckIcon: MockIcon,
    ChevronRightIcon: MockIcon,
    CompassIcon: MockIcon,
    MenuIcon: MockIcon,
    ExternalLinkIcon: MockIcon,
    FlagIcon: MockIcon,
    MapPinPlusIcon: MockIcon,
    PencilIcon: MockIcon,
    Trash2Icon: MockIcon,
    ListIcon: MockIcon,
    LocateFixedIcon: MockIcon,
    ListFilterIcon: MockIcon,
    MapIcon: MockIcon,
    MapPinnedIcon: MockIcon,
    RefreshCwIcon: MockIcon,
    StarIcon: MockIcon,
    SearchIcon: MockIcon,
    UsersIcon: MockIcon,
    XIcon: MockIcon,
  };
});

const mockedUseBeerMap = useBeerMap as jest.MockedFunction<typeof useBeerMap>;
const mockedFetchPubHours = fetchPubHours as jest.MockedFunction<typeof fetchPubHours>;
const mockedEnqueuePubReport = enqueuePubReport as jest.MockedFunction<typeof enqueuePubReport>;

function liveActivity(avatarUrl: string | null): FriendPubActivity {
  return {
    id: 'activity-1',
    account: {
      id: 'friend-1',
      nickname: 'pepa',
      displayName: 'Pepa',
      avatarUrl,
      isPublic: true,
    },
    cacheKey: 'u2fkbnvy',
    name: 'Lokál',
    city: 'Praha',
    externalId: '',
    message: '',
    startedAt: '2026-07-16T18:00:00.000Z',
    expiresAt: '2026-07-16T22:00:00.000Z',
    active: true,
    createdAt: '2026-07-16T18:00:00.000Z',
    updatedAt: '2026-07-16T18:00:00.000Z',
    responses: { going: 0, maybe: 0, cant: 0, goingProfiles: [] },
    myResponse: null,
    kind: 'live',
    scheduledFor: null,
    reactions: { cheers: 0 },
    myReaction: null,
  };
}

function mockLiveMap(avatarUrl: string | null) {
  const activity = liveActivity(avatarUrl);
  mockedUseBeerMap.mockReturnValue({
    pubs: [],
    nearbyPrices: [],
    visitedPubs: [],
    visitedCities: [],
    livePubs: [{
      cacheKey: activity.cacheKey,
      name: activity.name,
      city: activity.city,
      lat: 50.0876,
      lng: 14.4214,
      activities: [activity],
    }],
    position: null,
    permissionState: 'granted',
    loadingPubs: false,
    stale: false,
    requestPermission: jest.fn(async () => undefined),
    loadRegion: jest.fn(),
    refresh: jest.fn(),
  });

  return activity;
}

describe('BeerMapScreen opening-hours loading', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockColorScheme = 'dark';
    mockPubStoreState.reportedPubIds = [];
    mockPubStoreState.reportedCacheKeys = [];
    mockPubStoreState.addReportedPub.mockImplementation((id: string, key: string) => {
      mockPubStoreState.reportedPubIds = [...mockPubStoreState.reportedPubIds, id];
      mockPubStoreState.reportedCacheKeys = [...mockPubStoreState.reportedCacheKeys, key];
    });
    mockedUseBeerMap.mockReturnValue({
      pubs: [{ id: 'pub-1', name: 'U Testu', lat: 50.0876, lng: 14.4214 }],
      nearbyPrices: [],
      visitedPubs: [],
      visitedCities: [],
      livePubs: [],
      position: null,
      permissionState: 'granted',
      loadingPubs: false,
      stale: false,
      requestPermission: jest.fn(async () => undefined),
      loadRegion: jest.fn(),
      refresh: jest.fn(),
    });
    mockedFetchPubHours.mockResolvedValue(new Map([
      ['pub-1', {
        status: 'pending',
        openingHours: null,
        isOpenNow: null,
        nextChange: null,
        source: null,
        communityHours: null,
        beers: [],
        historicalBeers: [],
        beersUpdatedAt: null,
        beerMenuRotates: false,
        hoursUpdatedAt: null,
        rating: null,
        ratingCount: null,
        ratingLabel: null,
        hasGarden: null,
        venueKind: 'unknown',
      }],
    ]));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('follows the system color scheme', () => {
    const props = {
      filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(),
      onShowCompass: jest.fn(),
    };
    const screen = render(<BeerMapScreen {...props} />);

    expect(screen.getByLabelText(t.a11y.beerMap).props.accessibilityValue.text).toBe('dark');

    mockColorScheme = 'light';
    screen.rerender(<BeerMapScreen {...props} />);

    expect(screen.getByLabelText(t.a11y.beerMap).props.accessibilityValue.text).toBe('light');
  });

  it('snapshots the entire pub marker after layout, including a newly selected marker', async () => {
    const screen = render(<BeerMapScreen
      filters={EMPTY_PUB_SEARCH_FILTERS}
      onApplyFilters={jest.fn()}
      onShowCompass={jest.fn()}
    />);
    const marker = () => screen.getByLabelText(t.a11y.mapPub('U Testu', 0));

    // A slow first layout must not leave the initial, incomplete bitmap frozen.
    act(() => jest.advanceTimersByTime(1000));
    expect(marker().props.accessibilityValue.text).toBe('tracking');
    fireEvent(marker().findByProps({ collapsable: false }), 'layout');
    act(() => jest.advanceTimersByTime(200));
    expect(marker().props.accessibilityValue.text).toBe('frozen');

    await act(async () => fireEvent.press(marker()));
    expect(marker().props.accessibilityValue.text).toBe('tracking');
    fireEvent(marker().findByProps({ collapsable: false }), 'layout');
    act(() => jest.advanceTimersByTime(200));
    expect(marker().props.accessibilityValue.text).toBe('frozen');
  });

  it('lets a cluster count render before freezing its complete marker', () => {
    const data = mockedUseBeerMap(EMPTY_PUB_SEARCH_FILTERS);
    mockedUseBeerMap.mockReturnValue({ ...data, pubs: [
      { id: 'cluster-a', name: 'A', lat: 50.0876, lng: 14.4214 },
      { id: 'cluster-b', name: 'B', lat: 50.088, lng: 14.422 },
    ] });
    const screen = render(<BeerMapScreen
      filters={EMPTY_PUB_SEARCH_FILTERS}
      onApplyFilters={jest.fn()}
      onShowCompass={jest.fn()}
    />);
    const marker = screen.getByLabelText(t.a11y.mapCluster(2));
    expect(screen.getByText('2')).toBeTruthy();
    expect(marker.props.accessibilityValue.text).toBe('tracking');
    fireEvent(marker.findByProps({ collapsable: false }), 'layout');
    act(() => jest.advanceTimersByTime(200));
    expect(marker.props.accessibilityValue.text).toBe('frozen');
  });

  it('recenters on the user without changing zoom or regrouping pub markers', () => {
    mockedUseBeerMap.mockReturnValue({
      pubs: [{ id: 'pub-1', name: 'U Testu', lat: 50.0876, lng: 14.4214 }],
      nearbyPrices: [],
      visitedPubs: [],
      visitedCities: [],
      livePubs: [],
      position: { lat: 50.0821, lng: 14.4213, accuracyMeters: 12 },
      permissionState: 'granted',
      loadingPubs: false,
      stale: false,
      requestPermission: jest.fn(async () => undefined),
      loadRegion: jest.fn(),
      refresh: jest.fn(),
    });
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    // The first location fix establishes the map's initial city-level zoom.
    expect(mockAnimateToRegion).toHaveBeenLastCalledWith(
      expect.objectContaining({
        latitudeDelta: 0.055,
        longitudeDelta: 0.055,
      }),
      0,
    );

    fireEvent.press(screen.getByLabelText(t.a11y.mapLocate));

    expect(mockAnimateToRegion).toHaveBeenLastCalledWith(
      {
        latitude: 50.0821,
        longitude: 14.4213,
        latitudeDelta: 0.055,
        longitudeDelta: 0.055,
      },
      0,
    );
  });

  it('centers a selected pub in the map viewport', () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));

    expect(mockAnimateCamera).toHaveBeenLastCalledWith(
      {
        center: {
          latitude: 50.0876,
          longitude: 14.4214,
        },
      },
      { duration: 0 },
    );
  });

  it('shows a friend avatar in the live map marker', () => {
    const activity = mockLiveMap('https://cdn.test/pepa.jpg');
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    expect(screen.getByTestId('live-map-avatar').props.source).toEqual({
      uri: activity.account.avatarUrl,
    });
  });

  it('keeps the friend initial when the live marker has no avatar', () => {
    mockLiveMap(null);
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('live-map-avatar')).toBeNull();
    expect(screen.getByText('P')).toBeTruthy();
  });

  it('replaces a pending loader with the unknown state after three seconds', async () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    await act(async () => undefined);

    expect(screen.getByText(t.compass.detailsLoading)).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(2_999);
    });
    expect(screen.getByText(t.compass.detailsLoading)).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText(t.compass.detailsLoading)).toBeNull();
    expect(screen.getByText(t.compass.hoursUnknown)).toBeTruthy();
  });

  it('renders the selected-pub dock as a fixed card, not a scroll view', () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));

    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
  });

  it('switches layers from the card, and only from the card', () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    // The switch is on the surface, all three slices at once.
    expect(screen.getByLabelText(t.map.layerAll)).toBeTruthy();
    expect(screen.getByLabelText(t.map.layerVisited)).toBeTruthy();
    expect(screen.getByLabelText(t.map.layerFriends)).toBeTruthy();

    // And the overflow sheet no longer offers the same three as rows.
    fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    expect(screen.queryAllByLabelText(t.map.layerVisited)).toHaveLength(1);

    fireEvent.press(screen.getByLabelText(t.map.layerVisited));
    // "Moje stopy" is now the selected tab; the previous one became pressable.
    expect(
      screen.getByLabelText(t.map.layerVisited).props.accessibilityState,
    ).toMatchObject({ selected: true });

    act(() => resetBeerMapLayerForAddedPub());
    expect(screen.getByLabelText(t.map.layerAll).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('asks for confirmation before reporting a pub from the overflow sheet', () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed('U Testu')));
    act(() => {
      jest.advanceTimersByTime(260);
    });

    expect(mockedEnqueuePubReport).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText(t.compass.reportNotPub));

    expect(mockedEnqueuePubReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pub-1', name: 'U Testu' }),
      'not_pub',
    );
    expect(screen.queryByLabelText(t.a11y.mapReportClosed('U Testu'))).toBeNull();
  });

  it('sends a closed reason when a pub no longer operates', () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed('U Testu')));
    act(() => {
      jest.advanceTimersByTime(260);
    });

    fireEvent.press(screen.getByLabelText(t.compass.reportClosed));

    expect(mockedEnqueuePubReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pub-1', name: 'U Testu' }),
      'closed',
    );
  });
  it('focuses a search result outside the catalogue instead of the remembered map', () => {
    const props = {
      filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(),
      onShowCompass: jest.fn(),
    };
    const previous = render(<BeerMapScreen {...props} />);
    fireEvent.press(previous.getByLabelText(t.map.layerFriends));
    previous.unmount();

    const found = { id: 'remote-1', name: 'Vzdálená hospoda', lat: 49.19, lng: 16.61 };
    const onSearch = jest.fn();
    const screen = render(<BeerMapScreen
      {...props}
      initialPub={found}
      focusInitialPub
      onSearch={onSearch}
    />);
    expect(mockedUseBeerMap.mock.results.at(-1)?.value.loadRegion).toHaveBeenCalledWith({
      latitude: found.lat, longitude: found.lng, latitudeDelta: 0.035, longitudeDelta: 0.035,
    });
    expect(screen.getByLabelText(t.map.layerAll).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText(t.a11y.mapPub(found.name, 0))).toBeTruthy();
    expect(screen.getByText(found.name)).toBeTruthy();
    expect(mockedFetchPubHours).toHaveBeenCalledWith([found], expect.anything());
    fireEvent.press(screen.getByLabelText(t.pubSearch.open));
    expect(onSearch).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText(t.map.aimCompass));
    expect(props.onShowCompass).toHaveBeenCalledTimes(1);
  });

  it('applies later map layers, filters and fresh catalogue data to a searched pub', () => {
    const found = { id: 'remote-2', name: 'Původní název', lat: 49.21, lng: 16.62 };
    const props = { initialPub: found, focusInitialPub: true, filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(), onShowCompass: jest.fn() };
    const screen = render(<BeerMapScreen {...props} />);
    expect(screen.getByLabelText(t.a11y.mapPub(found.name, 0))).toBeTruthy();
    fireEvent.press(screen.getByLabelText(t.map.layerVisited));
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
    fireEvent.press(screen.getByLabelText(t.map.layerAll));
    screen.rerender(<BeerMapScreen {...props} filters={{ ...EMPTY_PUB_SEARCH_FILTERS, priceMaxCzk: 30 }} />);
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
    mockedUseBeerMap.mockReturnValue({ ...mockedUseBeerMap.mock.results.at(-1)!.value,
      pubs: [{ ...found, name: 'Nový název' }] });
    screen.rerender(<BeerMapScreen {...props} />);
    expect(screen.getByLabelText(t.a11y.mapPub('Nový název', 0))).toBeTruthy();
    expect(screen.queryByText(found.name)).toBeNull();
  });

  it.each(['id', 'cell'])('keeps a reported search result hidden by its %s', (signal) => {
    const found = { id: 'remote-3', name: 'Zavřená hospoda', lat: 49.23, lng: 16.64 };
    const props = { initialPub: found, focusInitialPub: true, filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(), onShowCompass: jest.fn() };
    const screen = render(<BeerMapScreen {...props} />);
    expect(screen.getByLabelText(t.a11y.mapPub(found.name, 0))).toBeTruthy();
    fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed(found.name)));
    act(() => jest.advanceTimersByTime(260));
    fireEvent.press(screen.getByLabelText(t.compass.reportClosed));
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
    screen.unmount();
    if (signal === 'id') mockPubStoreState.reportedCacheKeys = [];
    else mockPubStoreState.reportedPubIds = [];
    const reopened = render(<BeerMapScreen {...props} />);
    expect(reopened.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
  });

  it('keeps the searched pub name instead of a historical visit at the same location', () => {
    const found = { id: 'tygr-1', name: 'U Zlatého tygra', lat: 50.08759, lng: 14.42108 };
    mockedUseBeerMap.mockReturnValue({
      pubs: [], nearbyPrices: [], visitedCities: [], livePubs: [], position: null,
      permissionState: 'granted', loadingPubs: false, stale: false,
      requestPermission: jest.fn(), loadRegion: jest.fn(), refresh: jest.fn(),
      visitedPubs: [{ cacheKey: geohash8(found.lat, found.lng), name: 'Bar Dawu',
        lat: found.lat, lng: found.lng, city: 'Praha', visitCount: 1, lastVisitedAt: '2026-09-18T12:00:00Z' }],
    });
    const screen = render(<BeerMapScreen initialPub={found} focusInitialPub
      filters={EMPTY_PUB_SEARCH_FILTERS} onApplyFilters={jest.fn()} onShowCompass={jest.fn()} />);
    expect(screen.getByText(found.name)).toBeTruthy();
    expect(screen.queryByText('Bar Dawu')).toBeNull();
    expect(mockedFetchPubHours).toHaveBeenCalledWith([found], expect.anything());
    fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed(found.name)));
    act(() => jest.advanceTimersByTime(260));
    fireEvent.press(screen.getByLabelText(t.compass.reportClosed));
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 1))).toBeNull();
    expect(screen.queryByLabelText(t.a11y.mapPub('Bar Dawu', 1))).toBeNull();
  });

  it('keeps a selected pub identity when another cached pub occupies the same map cell', () => {
    const found = { id: 'tygr-2', name: 'U Zlatého tygra', lat: 50.08759, lng: 14.42108 };
    const mapData = mockedUseBeerMap(EMPTY_PUB_SEARCH_FILTERS);
    mockedUseBeerMap.mockReturnValue({ ...mapData,
      pubs: [{ ...found, id: 'old-dawu', name: 'Bar Dawu' }],
    });
    const screen = render(<BeerMapScreen initialPub={found} focusInitialPub
      filters={EMPTY_PUB_SEARCH_FILTERS} onApplyFilters={jest.fn()} onShowCompass={jest.fn()} />);
    expect(screen.getByText(found.name)).toBeTruthy();
    expect(screen.queryByText('Bar Dawu')).toBeNull();
    expect(mockedFetchPubHours).toHaveBeenCalledWith([found], expect.anything());
  });

});
