import React, { forwardRef, useImperativeHandle } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { t } from '@/i18n';
import { geohash8 } from '@/data/geohash';
import type { FriendPubActivity } from '@/data/friendsClient';
import { EMPTY_PUB_SEARCH_FILTERS } from '@/data/pubSearchFilters';
import BeerMapScreen, { resetBeerMapLayerForAddedPub } from '../BeerMapScreen';
import { fetchPubHours } from '@/data/hoursClient';
import { enqueuePubReport } from '@/data/pubReportQueue';
import { fetchPubBeersLastWeek } from '@/data/pubBeersClient';
import { useBeerMap } from '../useBeerMap';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import type { MapCompass } from '../BeerMapScreen';

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
      onPress,
      userInterfaceStyle,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: (event: { nativeEvent: { action?: string } }) => void;
      userInterfaceStyle?: 'light' | 'dark';
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      animateCamera: mockAnimateCamera,
      animateToRegion: mockAnimateToRegion,
      fitToCoordinates: jest.fn(),
    }));
    return (
      <Pressable
        onPress={() => onPress?.({ nativeEvent: {} })}
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: userInterfaceStyle }}
      >
        {children}
      </Pressable>
    );
  }),
  Polyline: () => <Text>route line</Text>,
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('../useBeerMap', () => ({ useBeerMap: jest.fn() }));
jest.mock('../HeadingCone', () => ({ HeadingCone: () => null }));
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
const mockSettingsState = {
  hapticEnabled: false,
  showPubBeers: false,
  setShowPubBeers: jest.fn(),
};
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof mockSettingsState) => unknown) => selector(mockSettingsState),
    { getState: () => mockSettingsState },
  ),
}));
jest.mock('@/data/pubBeersClient', () => ({
  fetchPubBeersLastWeek: jest.fn(async () => null),
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
    ChevronLeftIcon: MockIcon,
    ChevronRightIcon: MockIcon,
    CompassIcon: MockIcon,
    MenuIcon: MockIcon,
    ExternalLinkIcon: MockIcon,
    FlagIcon: MockIcon,
    MapPinPlusIcon: MockIcon,
    PencilIcon: MockIcon,
    Trash2Icon: MockIcon,
    ListIcon: MockIcon,
    LayoutListIcon: MockIcon,
    LocateFixedIcon: MockIcon,
    ListFilterIcon: MockIcon,
    MapIcon: MockIcon,
    MapPinnedIcon: MockIcon,
    RefreshCwIcon: MockIcon,
    StarIcon: MockIcon,
    SearchIcon: MockIcon,
    TrophyIcon: MockIcon,
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
    searchArea: null,
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
    refreshPosition: jest.fn(async () => null),
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
      searchArea: null,
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
      refreshPosition: jest.fn(async () => null),
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

  it('stays dark whatever the system color scheme', async () => {
    const props = {
      filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(),
      onShowCompass: jest.fn(),
    };
    const screen = await render(<BeerMapScreen {...props} />);

    expect(screen.getByLabelText(t.a11y.beerMap).props.accessibilityValue.text).toBe('dark');

    mockColorScheme = 'light';
    await await screen.rerender(<BeerMapScreen {...props} />);

    expect(screen.getByLabelText(t.a11y.beerMap).props.accessibilityValue.text).toBe('dark');
  });

  it('snapshots the entire pub marker after layout, including a newly selected marker', async () => {
    const screen = await render(<BeerMapScreen
      filters={EMPTY_PUB_SEARCH_FILTERS}
      onApplyFilters={jest.fn()}
      onShowCompass={jest.fn()}
    />);
    const marker = () => screen.getByLabelText(t.a11y.mapPub('U Testu', 0));

    // A slow first layout must not leave the initial, incomplete bitmap frozen.
    await act(() => jest.advanceTimersByTime(1000));
    expect(marker().props.accessibilityValue.text).toBe('tracking');
    await fireEvent(marker().queryAll((node) => node.props.collapsable === false)[0], 'layout');
    await act(() => jest.advanceTimersByTime(200));
    expect(marker().props.accessibilityValue.text).toBe('frozen');

    await act(async () => await fireEvent.press(marker()));
    expect(marker().props.accessibilityValue.text).toBe('tracking');
    await fireEvent(marker().queryAll((node) => node.props.collapsable === false)[0], 'layout');
    await act(() => jest.advanceTimersByTime(200));
    expect(marker().props.accessibilityValue.text).toBe('frozen');
  });

  it('lets a cluster count render before freezing its complete marker', async () => {
    const data = mockedUseBeerMap(EMPTY_PUB_SEARCH_FILTERS);
    mockedUseBeerMap.mockReturnValue({ ...data, pubs: [
      // Away from the pub the previous test selected: the selected pub keeps its own pin.
      { id: 'cluster-a', name: 'A', lat: 50.0896, lng: 14.4234 },
      { id: 'cluster-b', name: 'B', lat: 50.09, lng: 14.424 },
    ] });
    const screen = await render(<BeerMapScreen
      filters={EMPTY_PUB_SEARCH_FILTERS}
      onApplyFilters={jest.fn()}
      onShowCompass={jest.fn()}
    />);
    const marker = screen.getByLabelText(t.a11y.mapCluster(2));
    expect(screen.getByText('2')).toBeTruthy();
    expect(marker.props.accessibilityValue.text).toBe('tracking');
    await fireEvent(marker.queryAll((node) => node.props.collapsable === false)[0], 'layout');
    await act(() => jest.advanceTimersByTime(200));
    expect(marker.props.accessibilityValue.text).toBe('frozen');
  });

  it('recenters on the user without changing zoom or regrouping pub markers', async () => {
    mockedUseBeerMap.mockReturnValue({
      pubs: [{ id: 'pub-1', name: 'U Testu', lat: 50.0876, lng: 14.4214 }],
      nearbyPrices: [],
      searchArea: null,
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
      refreshPosition: jest.fn(async () => null),
    });
    const screen = await render(
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

    await fireEvent.press(screen.getByLabelText(t.a11y.mapLocate));

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

  it('follows a fresh one-shot fix when the user moved since the last one', async () => {
    const refreshPosition = jest.fn(async () => ({ lat: 50.0901, lng: 14.4301, accuracyMeters: 10 }));
    mockedUseBeerMap.mockReturnValue({
      ...mockedUseBeerMap(EMPTY_PUB_SEARCH_FILTERS),
      position: { lat: 50.0821, lng: 14.4213, accuracyMeters: 12 },
      refreshPosition,
    });
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    await act(async () => {
      await fireEvent.press(screen.getByLabelText(t.a11y.mapLocate));
      await Promise.resolve();
    });

    expect(refreshPosition).toHaveBeenCalledTimes(1);
    expect(mockAnimateToRegion).toHaveBeenLastCalledWith(
      expect.objectContaining({ latitude: 50.0901, longitude: 14.4301 }),
      0,
    );
  });

  it('centers a selected pub in the map viewport', async () => {
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));

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

  it('shows a friend avatar in the live map marker', async () => {
    const activity = mockLiveMap('https://cdn.test/pepa.jpg');
    const screen = await render(
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

  it('keeps the friend initial when the live marker has no avatar', async () => {
    mockLiveMap(null);
    const screen = await render(
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
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    await act(async () => undefined);

    expect(screen.getByText(t.compass.detailsLoading)).toBeTruthy();

    await act(() => {
      jest.advanceTimersByTime(2_999);
    });
    expect(screen.getByText(t.compass.detailsLoading)).toBeTruthy();

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText(t.compass.detailsLoading)).toBeNull();
    expect(screen.getByText(t.compass.hoursUnknown)).toBeTruthy();
  });

  it('renders the selected-pub dock as a fixed card, not a scroll view', async () => {
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));

    expect(screen.container.queryAll((node) => node.type === 'ScrollView')).toHaveLength(0);
  });

  it('shows active filters as a chip that clears them', async () => {
    const onApplyFilters = jest.fn();
    const screen = await render(
      <BeerMapScreen
        filters={{ ...EMPTY_PUB_SEARCH_FILTERS, priceMaxCzk: 30 }}
        onApplyFilters={onApplyFilters}
        onShowCompass={jest.fn()}
      />,
    );

    expect(screen.queryByText(t.compass.nudgeFilters(1))).toBeNull();
    expect(
      screen.getByLabelText(`${t.compass.moreFilters}, ${t.compass.moreFiltersActive(1)}`),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.a11y.mapFiltersClear));
    expect(onApplyFilters).toHaveBeenCalledWith(EMPTY_PUB_SEARCH_FILTERS);
  });

  it('switches layers from the dock, and only from the dock', async () => {
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );
    // A selection takes the dock's place; the card's cross gives it back, and
    // so does the empty map.
    await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    expect(screen.queryByLabelText(t.map.layerAll)).toBeNull();
    await fireEvent.press(screen.getByLabelText(t.a11y.mapSelectionClear));
    expect(screen.getByLabelText(t.map.layerAll)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    await fireEvent.press(screen.getByLabelText(t.a11y.beerMap));

    // The switch is on the surface, all three slices at once.
    expect(screen.getByLabelText(t.map.layerAll)).toBeTruthy();
    expect(screen.getByLabelText(t.map.layerVisited)).toBeTruthy();
    expect(screen.getByLabelText(t.map.layerFriends)).toBeTruthy();

    // And the overflow sheet no longer offers the same three as rows.
    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    expect(screen.queryAllByLabelText(t.map.layerVisited)).toHaveLength(1);

    await fireEvent.press(screen.getByLabelText(t.map.layerVisited));
    // "Moje stopy" is now the selected tab; the previous one became pressable.
    expect(
      screen.getByLabelText(t.map.layerVisited).props.accessibilityState,
    ).toMatchObject({ selected: true });

    await act(() => resetBeerMapLayerForAddedPub());
    expect(screen.getByLabelText(t.map.layerAll).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('opens the pub leaderboard from the overflow sheet', async () => {
    jest.useFakeTimers();
    try {
      const screen = await render(
        <BeerMapScreen
          filters={EMPTY_PUB_SEARCH_FILTERS}
          onApplyFilters={jest.fn()}
          onShowCompass={jest.fn()}
        />,
      );
      mockPush.mockClear();
      await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
      await fireEvent.press(screen.getByLabelText(t.map.moreBoard));
      await act(() => { jest.runOnlyPendingTimers(); });

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/leaderboards',
        params: { board: 'venues', source: 'map' },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens the same add-pub form as the compass, seeded with the map center', async () => {
    jest.useFakeTimers();
    try {
      const screen = await render(
        <BeerMapScreen
          filters={EMPTY_PUB_SEARCH_FILTERS}
          onApplyFilters={jest.fn()}
          onShowCompass={jest.fn()}
        />,
      );
      mockPush.mockClear();
      await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
      await fireEvent.press(screen.getByLabelText(t.compass.moreAddPub));
      await act(() => { jest.runOnlyPendingTimers(); });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const target = mockPush.mock.calls[0][0];
      expect(target.pathname).toBe('/add-pub');
      expect(Object.keys(target.params).sort()).toEqual(['lat', 'lng']);
      expect(screen.queryByText(t.map.pinConfirm)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks for confirmation before reporting a pub from the overflow sheet', async () => {
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    await fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed('U Testu')));
    await act(() => {
      jest.advanceTimersByTime(260);
    });

    expect(mockedEnqueuePubReport).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText(t.compass.reportNotPub));

    expect(mockedEnqueuePubReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pub-1', name: 'U Testu' }),
      'not_pub',
    );
    expect(screen.queryByLabelText(t.a11y.mapReportClosed('U Testu'))).toBeNull();
  });

  it('sends a closed reason when a pub no longer operates', async () => {
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    await fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed('U Testu')));
    await act(() => {
      jest.advanceTimersByTime(260);
    });

    await fireEvent.press(screen.getByLabelText(t.compass.reportClosed));

    expect(mockedEnqueuePubReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pub-1', name: 'U Testu' }),
      'closed',
    );
  });
  it('focuses a search result outside the catalogue instead of the remembered map', async () => {
    const props = {
      filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(),
      onShowCompass: jest.fn(),
    };
    const previous = await render(<BeerMapScreen {...props} />);
    await fireEvent.press(previous.getByLabelText(t.a11y.beerMap));
    await fireEvent.press(previous.getByLabelText(t.map.layerFriends));
    await previous.unmount();

    const found = { id: 'remote-1', name: 'Vzdálená hospoda', lat: 49.19, lng: 16.61 };
    const onSearch = jest.fn();
    const screen = await render(<BeerMapScreen
      {...props}
      initialPub={found}
      focusInitialPub
      onSearch={onSearch}
    />);
    expect(mockedUseBeerMap.mock.results.at(-1)?.value.loadRegion).toHaveBeenCalledWith({
      latitude: found.lat, longitude: found.lng, latitudeDelta: 0.035, longitudeDelta: 0.035,
    });
    expect(screen.getByLabelText(t.a11y.mapPub(found.name, 0))).toBeTruthy();
    expect(screen.getByText(found.name)).toBeTruthy();
    expect(mockedFetchPubHours).toHaveBeenCalledWith([found], expect.anything());
    await fireEvent.press(screen.getByLabelText(t.pubSearch.open));
    expect(onSearch).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByLabelText(t.map.aimCompass));
    expect(props.onShowCompass).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByLabelText(t.a11y.beerMap));
    expect(screen.getByLabelText(t.map.layerAll).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('applies later map layers, filters and fresh catalogue data to a searched pub', async () => {
    const found = { id: 'remote-2', name: 'Původní název', lat: 49.21, lng: 16.62 };
    const props = { initialPub: found, focusInitialPub: true, filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(), onShowCompass: jest.fn() };
    const screen = await render(<BeerMapScreen {...props} />);
    expect(screen.getByLabelText(t.a11y.mapPub(found.name, 0))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.a11y.beerMap));
    await fireEvent.press(screen.getByLabelText(t.map.layerVisited));
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
    await fireEvent.press(screen.getByLabelText(t.map.layerAll));
    await await screen.rerender(<BeerMapScreen {...props} filters={{ ...EMPTY_PUB_SEARCH_FILTERS, priceMaxCzk: 30 }} />);
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
    mockedUseBeerMap.mockReturnValue({ ...mockedUseBeerMap.mock.results.at(-1)!.value,
      pubs: [{ ...found, name: 'Nový název' }] });
    await await screen.rerender(<BeerMapScreen {...props} />);
    expect(screen.getByLabelText(t.a11y.mapPub('Nový název', 0))).toBeTruthy();
    expect(screen.queryByText(found.name)).toBeNull();
  });

  it.each(['id', 'cell'])('keeps a reported search result hidden by its %s', async (signal) => {
    const found = { id: 'remote-3', name: 'Zavřená hospoda', lat: 49.23, lng: 16.64 };
    const props = { initialPub: found, focusInitialPub: true, filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(), onShowCompass: jest.fn() };
    const screen = await render(<BeerMapScreen {...props} />);
    expect(screen.getByLabelText(t.a11y.mapPub(found.name, 0))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    await fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed(found.name)));
    await act(() => jest.advanceTimersByTime(260));
    await fireEvent.press(screen.getByLabelText(t.compass.reportClosed));
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
    await await screen.unmount();
    if (signal === 'id') mockPubStoreState.reportedCacheKeys = [];
    else mockPubStoreState.reportedPubIds = [];
    const reopened = await render(<BeerMapScreen {...props} />);
    expect(reopened.queryByLabelText(t.a11y.mapPub(found.name, 0))).toBeNull();
  });

  it('keeps the searched pub name instead of a historical visit at the same location', async () => {
    const found = { id: 'tygr-1', name: 'U Zlatého tygra', lat: 50.08759, lng: 14.42108 };
    mockedUseBeerMap.mockReturnValue({
      pubs: [], nearbyPrices: [], searchArea: null, visitedCities: [], livePubs: [], position: null,
      permissionState: 'granted', loadingPubs: false, stale: false,
      requestPermission: jest.fn(), loadRegion: jest.fn(), refresh: jest.fn(), refreshPosition: jest.fn(async () => null),
      visitedPubs: [{ cacheKey: geohash8(found.lat, found.lng), name: 'Bar Dawu',
        lat: found.lat, lng: found.lng, city: 'Praha', visitCount: 1, lastVisitedAt: '2026-09-18T12:00:00Z' }],
    });
    const screen = await render(<BeerMapScreen initialPub={found} focusInitialPub
      filters={EMPTY_PUB_SEARCH_FILTERS} onApplyFilters={jest.fn()} onShowCompass={jest.fn()} />);
    expect(screen.getByText(found.name)).toBeTruthy();
    expect(screen.queryByText('Bar Dawu')).toBeNull();
    expect(mockedFetchPubHours).toHaveBeenCalledWith([found], expect.anything());
    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    await fireEvent.press(screen.getByLabelText(t.a11y.mapReportClosed(found.name)));
    await act(() => jest.advanceTimersByTime(260));
    await fireEvent.press(screen.getByLabelText(t.compass.reportClosed));
    expect(screen.queryByLabelText(t.a11y.mapPub(found.name, 1))).toBeNull();
    expect(screen.queryByLabelText(t.a11y.mapPub('Bar Dawu', 1))).toBeNull();
  });

  it('keeps a selected pub identity when another cached pub occupies the same map cell', async () => {
    const found = { id: 'tygr-2', name: 'U Zlatého tygra', lat: 50.08759, lng: 14.42108 };
    const mapData = mockedUseBeerMap(EMPTY_PUB_SEARCH_FILTERS);
    mockedUseBeerMap.mockReturnValue({ ...mapData,
      pubs: [{ ...found, id: 'old-dawu', name: 'Bar Dawu' }],
    });
    const screen = await render(<BeerMapScreen initialPub={found} focusInitialPub
      filters={EMPTY_PUB_SEARCH_FILTERS} onApplyFilters={jest.fn()} onShowCompass={jest.fn()} />);
    expect(screen.getByText(found.name)).toBeTruthy();
    expect(screen.queryByText('Bar Dawu')).toBeNull();
    expect(mockedFetchPubHours).toHaveBeenCalledWith([found], expect.anything());
  });


  describe('as the home map with the compass in it', () => {
    function compassOnMap(): MapCompass {
      return {
        dial: <Text>dial</Text>,
        card: <Text>target card</Text>,
        route: { from: { lat: 50.08, lng: 14.42 }, to: { lat: 50.0876, lng: 14.4214 }, secret: false },
        heading: { value: null } as MapCompass['heading'],
        moreRows: [],
        nudge: null,
        peek: '323 m · U Testu',
      };
    }

    afterEach(async () => {
      await act(() => useFocusedPubStore.setState({ pub: null }));
    });

    it('puts the compass target where the layers were and lets it be put away', async () => {
      const screen = await render(
        <BeerMapScreen
          filters={EMPTY_PUB_SEARCH_FILTERS}
          onApplyFilters={jest.fn()}
          onShowCompass={jest.fn()}
          compass={compassOnMap()}
        />,
      );
      expect(screen.getByText('dial')).toBeTruthy();
      expect(screen.getByText('target card')).toBeTruthy();
      expect(screen.queryByLabelText(t.map.layerAll)).toBeNull();

      await fireEvent.press(screen.getByLabelText(t.a11y.mapTargetHide));
      expect(screen.queryByText('target card')).toBeNull();
      expect(screen.getByLabelText(t.map.layerAll)).toBeTruthy();
      expect(screen.getByText('323 m · U Testu')).toBeTruthy();

      await fireEvent.press(screen.getByLabelText(t.a11y.mapTargetShow));
      expect(screen.getByText('target card')).toBeTruthy();
    });

    it('draws the line to the target unless the target is a secret', async () => {
      const props = {
        filters: EMPTY_PUB_SEARCH_FILTERS,
        onApplyFilters: jest.fn(),
        onShowCompass: jest.fn(),
      };
      const screen = await render(<BeerMapScreen {...props} compass={compassOnMap()} />);
      expect(screen.getByText('route line')).toBeTruthy();

      const secret = compassOnMap();
      secret.route = { ...secret.route!, secret: true };
      await await screen.rerender(<BeerMapScreen {...props} compass={secret} />);
      expect(screen.queryByText('route line')).toBeNull();
    });

    it('closes its own sheet before a compass choice runs', async () => {
      jest.useFakeTimers();
      try {
        const surprise = jest.fn();
        const compass = compassOnMap();
        compass.moreRows = [{ key: 'surprise', label: t.compass.moreModeSurprise, icon: () => null, onPress: surprise }];
        const screen = await render(
          <BeerMapScreen
            filters={EMPTY_PUB_SEARCH_FILTERS}
            onApplyFilters={jest.fn()}
            onShowCompass={jest.fn()}
            compass={compass}
          />,
        );
        await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
        await fireEvent.press(screen.getByLabelText(t.compass.moreModeSurprise));
        await act(() => { jest.runOnlyPendingTimers(); });

        expect(surprise).toHaveBeenCalledTimes(1);
        expect(screen.queryByLabelText(t.compass.moreModeSurprise)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('aims the compass at a picked pub without leaving the map', async () => {
      const onShowCompass = jest.fn();
      const screen = await render(
        <BeerMapScreen
          filters={EMPTY_PUB_SEARCH_FILTERS}
          onApplyFilters={jest.fn()}
          onShowCompass={onShowCompass}
          compass={compassOnMap()}
        />,
      );
      await fireEvent.press(screen.getByLabelText(t.a11y.mapPub('U Testu', 0)));
      await fireEvent.press(screen.getByLabelText(t.map.aimCompass));

      expect(onShowCompass).not.toHaveBeenCalled();
      expect(useFocusedPubStore.getState().pub).toMatchObject({ name: 'U Testu' });
      expect(screen.getByText('target card')).toBeTruthy();
    });
  });
});

describe('BeerMapScreen last-week beers', () => {
  const busy = { id: 'pub-busy', name: 'U Plných', lat: 50.0876, lng: 14.4214 };
  const quiet = { id: 'pub-quiet', name: 'U Prázdných', lat: 50.0886, lng: 14.4234 };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsState.showPubBeers = true;
    mockPubStoreState.reportedPubIds = [];
    mockPubStoreState.reportedCacheKeys = [];
    mockedUseBeerMap.mockReturnValue({
      pubs: [busy, quiet],
      nearbyPrices: [],
      searchArea: null,
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
      refreshPosition: jest.fn(async () => null),
    });
    mockedFetchPubHours.mockResolvedValue(new Map());
    (fetchPubBeersLastWeek as jest.Mock).mockResolvedValue(
      new Map([[geohash8(busy.lat, busy.lng), 4]]),
    );
  });

  afterEach(() => {
    mockSettingsState.showPubBeers = false;
  });

  async function renderMap() {
    const screen = await render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );
    await act(async () => undefined);
    return screen;
  }

  const busyLabel = `${t.a11y.mapPub('U Plných', 0)}, ${t.map.beersLastWeek(4)}`;

  it('shows how many beers a pub poured last week on its pin and card', async () => {
    const screen = await renderMap();

    expect(screen.getByLabelText(busyLabel)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByLabelText(t.a11y.mapPub('U Prázdných', 0))).toBeTruthy();

    await act(async () => await fireEvent.press(screen.getByLabelText(busyLabel)));
    expect(screen.getByText(t.map.beersLastWeek(4))).toBeTruthy();
  });

  it('can narrow the map to pubs where people drank and clear it from the chip', async () => {
    const screen = await renderMap();

    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    await fireEvent.press(screen.getByText(t.map.moreBeersOnly));

    expect(screen.getByLabelText(busyLabel)).toBeTruthy();
    expect(screen.queryByLabelText(t.a11y.mapPub('U Prázdných', 0))).toBeNull();
    expect(
      screen.getByLabelText(`${t.compass.moreFilters}, ${t.compass.moreFiltersActive(1)}`),
    ).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(t.a11y.mapFiltersClear));
    expect(screen.queryByLabelText(t.a11y.mapFiltersClear)).toBeNull();
    expect(screen.getByLabelText(t.a11y.mapPub('U Prázdných', 0))).toBeTruthy();
  });

  it('drops the narrowed view when the counts are turned off', async () => {
    const screen = await renderMap();

    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    await fireEvent.press(screen.getByText(t.map.moreBeersOnly));
    await fireEvent.press(screen.getByLabelText(t.a11y.compassMore));
    await fireEvent.press(screen.getByText(t.map.moreBeers));

    expect(mockSettingsState.setShowPubBeers).toHaveBeenCalledWith(false);
    expect(screen.queryByLabelText(t.a11y.mapFiltersClear)).toBeNull();
    expect(screen.getByLabelText(t.a11y.mapPub('U Prázdných', 0))).toBeTruthy();
  });

  it('keeps a slow counts request alive while the catalogue reloads', async () => {
    let finish: (value: Map<string, number>) => void = () => undefined;
    (fetchPubBeersLastWeek as jest.Mock).mockImplementation(
      (signal: AbortSignal) =>
        new Promise((resolve) => {
          finish = resolve;
          expect(signal.aborted).toBe(false);
        }),
    );
    const props = {
      filters: EMPTY_PUB_SEARCH_FILTERS,
      onApplyFilters: jest.fn(),
      onShowCompass: jest.fn(),
    };
    const screen = await render(<BeerMapScreen {...props} />);
    const data = mockedUseBeerMap(EMPTY_PUB_SEARCH_FILTERS);
    mockedUseBeerMap.mockReturnValue({ ...data, pubs: [busy, quiet] });
    await await screen.rerender(<BeerMapScreen {...props} />);

    expect(fetchPubBeersLastWeek).toHaveBeenCalledTimes(1);
    const [signal] = (fetchPubBeersLastWeek as jest.Mock).mock.calls[0] as [AbortSignal];
    expect(signal.aborted).toBe(false);
    await act(async () => finish(new Map([[geohash8(busy.lat, busy.lng), 4]])));
    expect(screen.getByLabelText(busyLabel)).toBeTruthy();
  });

  it('hides the counts when the user turns them off', async () => {
    mockSettingsState.showPubBeers = false;
    const screen = await renderMap();

    expect(fetchPubBeersLastWeek).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t.a11y.mapPub('U Plných', 0))).toBeTruthy();
    expect(screen.queryByText('4')).toBeNull();
  });
});

describe('BeerMapScreen opened on one pub', () => {
  it('keeps the selected pub out of a cluster', async () => {
    const data = mockedUseBeerMap(EMPTY_PUB_SEARCH_FILTERS);
    const opened = { id: 'opened', name: 'Otevřená', lat: 50.0896, lng: 14.4234 };
    mockedUseBeerMap.mockReturnValue({ ...data, pubs: [
      opened,
      { id: 'neighbour', name: 'Soused', lat: 50.09, lng: 14.424 },
    ] });
    const screen = await render(<BeerMapScreen
      initialPub={opened}
      focusInitialPub
      filters={EMPTY_PUB_SEARCH_FILTERS}
      onApplyFilters={jest.fn()}
      onShowCompass={jest.fn()}
    />);
    await act(async () => undefined);

    expect(screen.getByLabelText(t.a11y.mapPub('Otevřená', 0))).toBeTruthy();
    expect(screen.queryByLabelText(t.a11y.mapCluster(2))).toBeNull();
  });
});
