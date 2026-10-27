import React from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { Platform } from 'react-native';
import { openPubPage } from '@/pubPage/openPubPage';
import { ReportPubModal } from '@/components/compass/ReportPubModal';
import { CompassCard } from '@/compassui/CompassCard';
import { MoreSheet } from '@/components/shared/MoreSheet';
import BeerMapScreen from '@/map/BeerMapScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Alert: {
      alert: jest.fn(),
    },
    KeyboardAvoidingView: jest.fn(({ children }) => <RN.View>{children}</RN.View>),
    Modal: jest.fn(({ children, visible }) => (visible ? <RN.View>{children}</RN.View> : null)),
    TextInput: jest.fn(() => null),
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useIsFocused: jest.fn(() => true),
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
  })),
}));

// The right-half pages have their own tests and pull in every detail screen.
jest.mock('@/layout/RightPage', () => ({ RightPage: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaInsetsContext: jest.requireActual<typeof import('react')>('react').createContext(null),
  useSafeAreaInsets: jest.fn(() => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })),
}));

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('@/__mocks__/react-native-reanimated'),
  useAnimatedReaction: jest.fn(),
}));

jest.mock('@/components/compass/CompassContainer', () => ({
  CompassContainer: jest.fn(() => null),
}));

jest.mock('@/components/compass/PubFilterSheet', () => ({
  PubFilterSheet: jest.fn(() => null),
}));

jest.mock('@/pubPage/openPubPage', () => ({
  openPubPage: jest.fn(),
}));

jest.mock('@/components/compass/ReportPubModal', () => ({
  ReportPubModal: jest.fn(() => null),
}));

jest.mock('@/compassui/CompassCard', () => ({
  CompassCard: jest.fn(() => null),
}));

jest.mock('@/components/shared/MoreSheet', () => ({
  MoreSheet: jest.fn(() => null),
}));

jest.mock('@/counter/NudgeSlot', () => ({
  NudgeSlot: jest.fn(() => null),
}));

jest.mock('@/counter/CounterCta', () => ({
  CounterCta: jest.fn(() => null),
  CounterSecondary: jest.fn(() => null),
}));

jest.mock('@/map/BeerMapScreen', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

jest.mock('@/components/shared/TitleBar', () => ({
  TitleBar: jest.fn(({ filterSlot }) => filterSlot ?? null),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: jest.fn(() => null),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  SearchIcon: jest.fn(() => null),
  BeerIcon: jest.fn(() => null),
  BeerOffIcon: jest.fn(() => null),
  Trash2Icon: jest.fn(() => null),
  CompassIcon: jest.fn(() => null),
  LockKeyholeIcon: jest.fn(() => null),
  EyeIcon: jest.fn(() => null),
  MapPinIcon: jest.fn(() => null),
  MapIcon: jest.fn(() => null),
  ExternalLinkIcon: jest.fn(() => null),
  RefreshCwIcon: jest.fn(() => null),
  SettingsIcon: jest.fn(() => null),
  FlagIcon: jest.fn(() => null),
  MapPinnedIcon: jest.fn(() => null),
  MapPinPlusIcon: jest.fn(() => null),
  PencilIcon: jest.fn(() => null),
  StarIcon: jest.fn(() => null),
  TreePineIcon: jest.fn(() => null),
  XIcon: jest.fn(() => null),
  ListFilterIcon: jest.fn(() => null),
  HouseIcon: jest.fn(() => null),
  MenuIcon: jest.fn(() => null),
  TargetIcon: jest.fn(() => null),
  SparklesIcon: jest.fn(() => null),
}));

jest.mock('@/utils/maps', () => ({
  openPubInMaps: jest.fn(),
  openHomeInMaps: jest.fn(),
}));

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: {
      extrabold: 'display-extrabold',
    },
    ui: {
      regular: 'ui-regular',
      medium: 'ui-medium',
      semibold: 'ui-semibold',
      bold: 'ui-bold',
    },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock('@/hooks/useCompass', () => ({
  useCompass: jest.fn(),
}));

jest.mock('@/data/account', () => ({
  updateAccountPreferences: jest.fn(async () => null),
}));

const CompassScreen = require('../(tabs)/index').default;
const { useCompass } = require('@/hooks/useCompass') as {
  useCompass: jest.Mock;
};
const { updateAccountPreferences } = require('@/data/account') as {
  updateAccountPreferences: jest.Mock;
};
const mockedUseRouter = useRouter as jest.Mock;
const CompassCardMock = CompassCard as jest.Mock;
const MoreSheetMock = MoreSheet as jest.Mock;
const openPubPageMock = openPubPage as jest.Mock;
const ReportPubModalMock = ReportPubModal as jest.Mock;

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function latestProps(mock: jest.Mock) {
  return mock.mock.calls.at(-1)?.[0];
}

function openMoreSheet(renderer: any) {
  const moreButton = renderer.root.findByProps({
    accessibilityLabel: t.a11y.compassMore,
  });

  act(() => {
    moreButton.props.onPress();
  });

  const props = latestProps(MoreSheetMock);
  expect(props.visible).toBe(true);
  return props;
}

function pressMoreRow(renderer: any, label: string) {
  const sheet = openMoreSheet(renderer);
  const row = sheet.rows.find((candidate: { label: string }) => candidate.label === label);
  expect(row).toBeDefined();

  act(() => {
    row.onPress();
  });

  return row;
}

function baseCompassState() {
  return {
    arrowRotation: { value: null },
    distanceFormatted: '750 m',
    pub: {
      id: 'osm:1',
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
    },
    revealed: false,
    reveal: jest.fn(),
    mode: 'nearest',
    setMode: jest.fn(),
    reroll: jest.fn(),
    skip: jest.fn(),
    reportCurrentPub: jest.fn(async () => true),
    renameCurrentPub: jest.fn(async () => true),
    retrySearch: jest.fn(),
    arrived: false,
    dismissArrival: jest.fn(),
    headingAccuracy: null,
    hasMagnetometer: true,
    permissionState: 'granted',
    requestPermission: jest.fn(),
    isLoading: false,
    searchFailed: false,
    currentPosition: null,
  };
}

/** A phone opens on the map; these tests start on the full compass, as after a tap on its dial. */
function createOnCompass(): any {
  let renderer: any;
  act(() => { renderer = TestRenderer.create(React.createElement(CompassScreen)); });
  act(() => renderer.root.findByType(BeerMapScreen).props.onShowCompass());
  return renderer;
}

function createOnMap() {
  return TestRenderer.create(React.createElement(CompassScreen));
}

describe('CompassScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    mockedUseRouter.mockReturnValue({ push: jest.fn() });
    act(() => {
      useSettingsStore.setState({ hidePubNames: false, homePoint: null });
    });
  });

  it.each(['ios', 'android'] as const)('keeps the long disclosure only outside iOS (%s)', (platform) => {
    Platform.OS = platform;
    useCompass.mockReturnValue({ ...baseCompassState(), permissionState: 'undetermined' });
    let renderer: any;
    renderer = createOnCompass();
    const screen = JSON.stringify(renderer.toJSON());
    if (platform === 'ios') expect(screen).not.toContain(t.permissions.body);
    else expect(screen).toContain(t.permissions.body);
    act(() => renderer.unmount());
  });

  it('shows only the settings action after location was denied', () => {
    useCompass.mockReturnValue({ ...baseCompassState(), permissionState: 'denied' });
    let renderer: any;
    renderer = createOnCompass();
    expect(renderer.root.findAllByProps({ accessibilityLabel: t.permissions.openSettings })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: t.permissions.cta })).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it.each([
    ['active', {}],
    ['loading', { isLoading: true }],
    ['empty', { pub: null }],
    ['denied location', { permissionState: 'denied' }],
    ['undetermined location', { permissionState: 'undetermined' }],
  ])('opens pub search from the %s compass', (_name, overrides) => {
    const push = jest.fn();
    mockedUseRouter.mockReturnValue({ push });
    useCompass.mockReturnValue({ ...baseCompassState(), ...overrides });
    let renderer: any;
    renderer = createOnCompass();
    const button = renderer.root.findAllByProps({ accessibilityLabel: t.pubSearch.open })[0];
    act(() => button.props.onPress());
    expect(push).toHaveBeenCalledWith('/pub-search');
    act(() => renderer.unmount());
  });

  it('shows the empty state instead of a compass card when no pub is selected', () => {
    useCompass.mockReturnValue({
      ...baseCompassState(),
      pub: null,
    });

    let renderer: any;

    renderer = createOnCompass();

    expect(CompassCardMock).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({ accessibilityLabel: t.empty.retry }).length).toBeGreaterThan(0);
  });

  it('reveals a hidden pub when the compass card footer is pressed', () => {
    act(() => {
      useSettingsStore.setState({ hidePubNames: true });
    });
    const reveal = jest.fn();
    useCompass.mockReturnValue({
      ...baseCompassState(),
      reveal,
    });

    let renderer: any;

    renderer = createOnCompass();

    const card = latestProps(CompassCardMock);
    expect(card.hidden).toBe(true);
    expect(card.pubName).toBeNull();

    act(() => {
      card.onPressFooter();
    });

    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('passes the pub name to the compass card when hidden names are disabled', () => {
    useCompass.mockReturnValue(baseCompassState());

    createOnCompass();

    expect(latestProps(CompassCardMock)).toEqual(
      expect.objectContaining({
        hidden: false,
        pubName: 'U Testu',
      }),
    );
  });

  it('offers the map as a header door, not as a menu row', () => {
    useCompass.mockReturnValue(baseCompassState());

    let renderer: any;

    renderer = createOnCompass();

    expect(renderer.root.findByProps({ accessibilityLabel: t.a11y.mapSwitchToMap })).toBeTruthy();

    // And exactly one door to it: the overflow sheet no longer carries the map.
    const sheet = openMoreSheet(renderer);
    expect(
      sheet.rows.some((row: { label: string }) => row.label === t.compass.moreMap),
    ).toBe(false);
  });
  it('opens the full compass from explicit pub navigation', () => {
    const setParams = jest.fn();
    mockedUseRouter.mockReturnValue({ push: jest.fn(), setParams });
    useCompass.mockReturnValue(baseCompassState());
    let renderer: any;
    act(() => {
      renderer = createOnMap();
    });
    expect(renderer.root.findAllByType(BeerMapScreen)).toHaveLength(1);

    (useLocalSearchParams as jest.Mock).mockReturnValue({ view: 'compass' });
    act(() => renderer.update(React.createElement(CompassScreen)));
    const focus = (useFocusEffect as jest.Mock).mock.calls.at(-1)![0];
    act(() => focus());
    expect(renderer.root.findAllByType(BeerMapScreen)).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: t.a11y.mapSwitchToMap })).toBeTruthy();
    expect(setParams).toHaveBeenCalledWith({ view: undefined });
    act(() => renderer.unmount());
  });
  it('opens on the map and moves between it and the full compass', () => {
    useCompass.mockReturnValue(baseCompassState());
    let renderer: any;
    act(() => {
      renderer = createOnMap();
    });

    const map = renderer.root.findByType(BeerMapScreen);
    expect(map.props.compass.card).not.toBeNull();
    expect(map.props.highlightPubKey).not.toBeNull();
    act(() => map.props.compass.dial.props.onPress());
    expect(renderer.root.findAllByType(BeerMapScreen)).toHaveLength(0);
    expect(CompassCardMock).toHaveBeenCalled();

    act(() => renderer.root.findByProps({ accessibilityLabel: t.a11y.mapSwitchToMap }).props.onPress());
    expect(renderer.root.findAllByType(BeerMapScreen)).toHaveLength(1);
    act(() => renderer.unmount());
  });
  it('offers destination-only navigation home when a home point is set', () => {
    const { openHomeInMaps } = require('@/utils/maps') as { openHomeInMaps: jest.Mock };
    useCompass.mockReturnValue(baseCompassState());

    let renderer: any;
    renderer = createOnCompass();
    expect(
      openMoreSheet(renderer).rows.some(
        (row: { label: string }) => row.label === t.compass.moreHome,
      ),
    ).toBe(false);

    act(() => {
      useSettingsStore.setState({ homePoint: { lat: 50.08, lng: 14.42 } });
    });

    renderer = createOnCompass();

    pressMoreRow(renderer, t.compass.moreHome);
    expect(openHomeInMaps).toHaveBeenCalledWith({ lat: 50.08, lng: 14.42 });
  });

  it('keeps the compass sensors on under the map and shows no target without location', () => {
    useCompass.mockReturnValue({ ...baseCompassState(), permissionState: 'denied' });
    let renderer: any;

    act(() => {
      renderer = createOnMap();
    });

    const map = renderer.root.findByType(BeerMapScreen);
    expect(map.props.compass.card).toBeNull();
    expect(map.props.compass.route).toBeNull();
    expect(useCompass).toHaveBeenLastCalledWith(null, [], null, null, true, false);

    // The full compass still asks for location and keeps its door back.
    act(() => map.props.onShowCompass());
    const mapButton = renderer.root.findByProps({ accessibilityLabel: t.map.openWithoutLocation });
    act(() => mapButton.props.onPress());
    expect(renderer.root.findAllByType(BeerMapScreen)).toHaveLength(1);
    act(() => renderer.unmount());
  });
  it('draws the route to the target and keeps a secret target secret', () => {
    useCompass.mockReturnValue({
      ...baseCompassState(),
      currentPosition: { lat: 50.07, lng: 14.41, accuracyMeters: 8 },
    });
    let renderer: any;
    act(() => { renderer = createOnMap(); });
    const route = renderer.root.findByType(BeerMapScreen).props.compass.route;
    expect(route).toEqual(expect.objectContaining({ from: { lat: 50.07, lng: 14.41 }, secret: false }));

    act(() => renderer.unmount());

    act(() => {
      useSettingsStore.setState({ hidePubNames: true });
    });
    act(() => { renderer = createOnMap(); });
    const map = renderer.root.findByType(BeerMapScreen);
    expect(map.props.compass.route.secret).toBe(true);
    expect(map.props.highlightPubKey).toBeNull();
    expect(map.props.compass.card.props.pubName).toBeNull();
    act(() => renderer.unmount());
  });

  it('navigates to the pub the needle points at, not the nearest one', () => {
    const { openPubInMaps } = require('@/utils/maps') as { openPubInMaps: jest.Mock };
    const focusedPub = { lat: 50.0824, lng: 14.4227, name: 'U Pinkasů', cacheKey: 'u2fkbbxy' };
    useCompass.mockReturnValue({ ...baseCompassState(), focusedPub });
    let renderer: any;
    act(() => { renderer = createOnMap(); });
    const card = renderer.root.findByType(BeerMapScreen).props.compass.card;
    expect(card.props.secondary.label).toBe(t.compass.backToNearest);
    act(() => card.props.primary.onPress());
    expect(openPubInMaps).toHaveBeenCalledWith(focusedPub);
    act(() => renderer.unmount());
  });

  it('syncs more-sheet compass mode changes to the account preferences endpoint', () => {
    const setMode = jest.fn();
    useCompass.mockReturnValue({ ...baseCompassState(), setMode });

    let renderer: any;

    renderer = createOnCompass();

    pressMoreRow(renderer, t.compass.moreModeSurprise);

    expect(setMode).toHaveBeenCalledWith('surprise');
    expect(updateAccountPreferences).toHaveBeenCalledWith({ mode: 'surprise' });
  });

  it('opens the report reason sheet from the more sheet', () => {
    const reportCurrentPub = jest.fn(async () => true);
    useCompass.mockReturnValue({
      ...baseCompassState(),
      revealed: true,
      reportCurrentPub,
    });

    let renderer: any;

    renderer = createOnCompass();

    pressMoreRow(renderer, t.compass.moreReport);
    const reportModal = latestProps(ReportPubModalMock);
    expect(reportModal.visible).toBe(true);

    act(() => {
      reportModal.onReportReason('not_pub');
    });

    expect(reportCurrentPub).toHaveBeenCalledWith('not_pub');
  });

  it('opens the pub page for the targeted pub from the card footer', () => {
    const pub = {
      id: 'osm:1',
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
      city: 'Praha',
      openingHours: 'Mo-Fr 11:00-23:00; Sa 12:00-00:00',
      hoursSource: 'firmy',
    };
    useCompass.mockReturnValue({
      ...baseCompassState(),
      revealed: true,
      pub,
    });

    createOnCompass();

    expect(openPubPageMock).not.toHaveBeenCalled();
    act(() => {
      latestProps(CompassCardMock).onPressFooter();
    });

    expect(openPubPageMock).toHaveBeenCalledTimes(1);
    expect(openPubPageMock.mock.calls[0][1]).toEqual(pub);
  });

  it('opens add-pub from the report modal reached through the more sheet', () => {
    const push = jest.fn();
    mockedUseRouter.mockReturnValue({ push });
    useCompass.mockReturnValue({
      ...baseCompassState(),
      revealed: true,
      currentPosition: { lat: 50.0821, lng: 14.4213, accuracyMeters: 12 },
    });

    let renderer: any;

    renderer = createOnCompass();

    pressMoreRow(renderer, t.compass.moreReport);
    const reportModal = latestProps(ReportPubModalMock);
    expect(reportModal.visible).toBe(true);
    act(() => {
      reportModal.onAddPub();
    });

    expect(push).toHaveBeenCalledWith({
      pathname: '/add-pub',
      params: {
        lat: '50.0821',
        lng: '14.4213',
      },
    });
  });
});
