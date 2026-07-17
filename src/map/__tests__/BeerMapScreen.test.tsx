import React, { forwardRef, useImperativeHandle } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { cs } from '@/i18n/cs';
import type { FriendPubActivity } from '@/data/friendsClient';
import { EMPTY_PUB_SEARCH_FILTERS } from '@/data/pubSearchFilters';
import BeerMapScreen from '../BeerMapScreen';
import { fetchPubHours } from '@/data/hoursClient';
import { enqueuePubReport } from '@/data/pubReportQueue';
import { useBeerMap } from '../useBeerMap';

let mockColorScheme: 'light' | 'dark' | null = 'dark';

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
      animateCamera: jest.fn(),
      animateToRegion: jest.fn(),
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
  Marker: ({ children, onPress, accessibilityLabel }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => (
    <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel}>
      {children}
    </Pressable>
  ),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../useBeerMap', () => ({ useBeerMap: jest.fn() }));
jest.mock('@/data/hoursClient', () => ({ fetchPubHours: jest.fn() }));
jest.mock('@/data/pubReportQueue', () => ({ enqueuePubReport: jest.fn(async () => true) }));
jest.mock('@/stores/pubStore', () => ({
  usePubStore: (selector: (state: { addReportedPub: jest.Mock }) => unknown) =>
    selector({ addReportedPub: jest.fn() }),
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
    <Text>{status === 'loading' || status === 'pending' ? cs.compass.detailsLoading : cs.compass.hoursUnknown}</Text>
  ),
}));
jest.mock('@/components/shared/ExploreSwitch', () => ({ ExploreSwitch: () => null }));
jest.mock('@/components/shared/PubCardActions', () => ({ PubCardActions: () => null }));
jest.mock('@/components/shared/IconGlyph', () => {
  const MockIcon = () => null;
  return {
    BeerIcon: MockIcon,
    ChevronRightIcon: MockIcon,
    CompassIcon: MockIcon,
    ExternalLinkIcon: MockIcon,
    ListIcon: MockIcon,
    LocateFixedIcon: MockIcon,
    ListFilterIcon: MockIcon,
    MapPinnedIcon: MockIcon,
    RefreshCwIcon: MockIcon,
    StarIcon: MockIcon,
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

    expect(screen.getByLabelText(cs.a11y.beerMap).props.accessibilityValue.text).toBe('dark');

    mockColorScheme = 'light';
    screen.rerender(<BeerMapScreen {...props} />);

    expect(screen.getByLabelText(cs.a11y.beerMap).props.accessibilityValue.text).toBe('light');
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

    fireEvent.press(screen.getByLabelText(cs.a11y.mapPub('U Testu', 0)));
    await act(async () => undefined);

    expect(screen.getByText(cs.compass.detailsLoading)).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(2_999);
    });
    expect(screen.getByText(cs.compass.detailsLoading)).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText(cs.compass.detailsLoading)).toBeNull();
    expect(screen.getByText(cs.compass.hoursUnknown)).toBeTruthy();
  });

  it('renders the selected-pub dock as a fixed card, not a scroll view', () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(cs.a11y.mapPub('U Testu', 0)));

    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
  });

  it('reports a closed pub directly from the selected-pub card', () => {
    const screen = render(
      <BeerMapScreen
        filters={EMPTY_PUB_SEARCH_FILTERS}
        onApplyFilters={jest.fn()}
        onShowCompass={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(cs.a11y.mapPub('U Testu', 0)));
    fireEvent.press(screen.getByLabelText(cs.a11y.mapReportClosed('U Testu')));

    expect(mockedEnqueuePubReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pub-1', name: 'U Testu' }),
      'closed',
    );
    expect(screen.queryByLabelText(cs.a11y.mapReportClosed('U Testu'))).toBeNull();
  });
});
