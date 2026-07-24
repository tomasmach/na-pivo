import React from 'react';
import { useRouter } from 'expo-router';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
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
  useRouter: jest.fn(() => ({
    push: jest.fn(),
  })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })),
}));

jest.mock('react-native-reanimated', () => ({
  useAnimatedReaction: jest.fn(),
  useSharedValue: jest.fn((value) => ({ value })),
}));

jest.mock('@/components/compass/CompassContainer', () => ({
  CompassContainer: jest.fn(() => null),
}));

jest.mock('@/components/compass/PubFilterSheet', () => ({
  PubFilterSheet: jest.fn(() => null),
}));

jest.mock('@/components/amenities/MapPubSheet', () => ({
  MapPubSheet: jest.fn(() => null),
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
  EllipsisIcon: jest.fn(() => null),
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
const MapPubSheetMock = MapPubSheet as jest.Mock;
const ReportPubModalMock = ReportPubModal as jest.Mock;

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function latestProps(mock: jest.Mock) {
  return mock.mock.calls.at(-1)?.[0];
}

function openMoreSheet(renderer: any) {
  const moreButton = renderer.root.findByProps({
    accessibilityLabel: cs.a11y.compassMore,
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

describe('CompassScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue({ push: jest.fn() });
    act(() => {
      useSettingsStore.setState({ hidePubNames: false, homePoint: null });
    });
  });

  it('shows the empty state instead of a compass card when no pub is selected', () => {
    useCompass.mockReturnValue({
      ...baseCompassState(),
      pub: null,
    });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(CompassCardMock).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.empty.retry }).length).toBeGreaterThan(0);
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

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

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

    act(() => {
      TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(latestProps(CompassCardMock)).toEqual(
      expect.objectContaining({
        hidden: false,
        pubName: 'U Testu',
      }),
    );
  });

  it('renders the compass wordmark in the active header row', () => {
    useCompass.mockReturnValue(baseCompassState());

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(
      renderer.root.findByProps({ accessibilityLabel: cs.compass.headerTitle }),
    ).toBeTruthy();
  });

  it('switches from the active compass to the map from the more sheet', () => {
    const BeerMapScreenMock = BeerMapScreen as jest.Mock;
    useCompass.mockReturnValue(baseCompassState());
    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    pressMoreRow(renderer, cs.compass.moreMap);

    expect(BeerMapScreenMock).toHaveBeenCalledWith(
      expect.objectContaining({ onShowCompass: expect.any(Function) }),
      undefined,
    );
  });

  it('offers destination-only navigation home when a home point is set', () => {
    const { openHomeInMaps } = require('@/utils/maps') as { openHomeInMaps: jest.Mock };
    useCompass.mockReturnValue(baseCompassState());

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });
    expect(
      openMoreSheet(renderer).rows.some(
        (row: { label: string }) => row.label === cs.compass.moreHome,
      ),
    ).toBe(false);

    act(() => {
      useSettingsStore.setState({ homePoint: { lat: 50.08, lng: 14.42 } });
    });

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    pressMoreRow(renderer, cs.compass.moreHome);
    expect(openHomeInMaps).toHaveBeenCalledWith({ lat: 50.08, lng: 14.42 });
  });

  it('opens the map without location permission and pauses compass sensors', () => {
    const BeerMapScreenMock = BeerMapScreen as jest.Mock;
    useCompass.mockReturnValue({ ...baseCompassState(), permissionState: 'denied' });
    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    const mapButton = renderer!.root.findByProps({ accessibilityLabel: cs.map.openWithoutLocation });
    act(() => mapButton.props.onPress());

    expect(BeerMapScreenMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialPub: expect.objectContaining({ name: 'U Testu' }) }),
      undefined,
    );
    expect(useCompass).toHaveBeenLastCalledWith(null, [], null, null, false, false);
  });

  it('syncs more-sheet compass mode changes to the account preferences endpoint', () => {
    const setMode = jest.fn();
    useCompass.mockReturnValue({ ...baseCompassState(), setMode });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    pressMoreRow(renderer, cs.compass.moreModeSurprise);

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

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    pressMoreRow(renderer, cs.compass.moreReport);
    const reportModal = latestProps(ReportPubModalMock);
    expect(reportModal.visible).toBe(true);

    act(() => {
      reportModal.onReportReason('not_pub');
    });

    expect(reportCurrentPub).toHaveBeenCalledWith('not_pub');
  });

  it('passes Firmy.cz opening hours to the map hub when community hours are absent', () => {
    useCompass.mockReturnValue({
      ...baseCompassState(),
      revealed: true,
      pub: {
        id: 'osm:1',
        name: 'U Testu',
        lat: 50.08,
        lng: 14.42,
        city: 'Praha',
        openingHours: 'Mo-Fr 11:00-23:00; Sa 12:00-00:00',
        hoursSource: 'firmy',
      },
    });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(latestProps(MapPubSheetMock).visible).toBe(false);
    act(() => {
      latestProps(CompassCardMock).onPressFooter();
    });

    const sheet = latestProps(MapPubSheetMock);
    expect(sheet.visible).toBe(true);
    expect(sheet.info.openingHours).toBe('Mo-Fr 11:00-23:00; Sa 12:00-00:00');
    expect(sheet.info.prefillHours).toBeNull();
    expect(sheet.pubName).toBe('U Testu');
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

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    pressMoreRow(renderer, cs.compass.moreReport);
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
