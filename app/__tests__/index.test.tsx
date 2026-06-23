import React from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Alert: {
    alert: jest.fn(),
  },
  TextInput: jest.fn(() => null),
}));

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

jest.mock('@/components/compass/BeerBrandFilterSheet', () => ({
  BeerBrandFilterSheet: jest.fn(() => null),
}));

jest.mock('@/components/shared/TitleBar', () => ({
  TitleBar: jest.fn(() => null),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: jest.fn(() => null),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  BeerOffIcon: jest.fn(() => null),
  LockKeyholeIcon: jest.fn(() => null),
  EyeIcon: jest.fn(() => null),
  MapPinIcon: jest.fn(() => null),
  ExternalLinkIcon: jest.fn(() => null),
  RefreshCwIcon: jest.fn(() => null),
  SettingsIcon: jest.fn(() => null),
  FlagIcon: jest.fn(() => null),
  PencilIcon: jest.fn(() => null),
  StarIcon: jest.fn(() => null),
  TreePineIcon: jest.fn(() => null),
  XIcon: jest.fn(() => null),
}));

jest.mock('@/utils/maps', () => ({
  openPubInMaps: jest.fn(),
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

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

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
      useSettingsStore.setState({ hidePubNames: false });
    });
  });

  it('shows empty state instead of a reveal button when no pub is selected', () => {
    useCompass.mockReturnValue({
      ...baseCompassState(),
      pub: null,
    });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.a11y.pubPillHidden })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.empty.retry }).length).toBeGreaterThan(0);
  });

  it('wires the hidden pub pill to reveal when a pub exists', () => {
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

    const hiddenPill = renderer!.root.findByProps({ accessibilityLabel: cs.a11y.pubPillHidden });

    act(() => {
      hiddenPill.props.onPress();
    });

    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('shows the revealed pub pill by default when hidden names are disabled', () => {
    useCompass.mockReturnValue(baseCompassState());

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.a11y.pubPillHidden })).toHaveLength(0);
    expect(
      renderer!.root.find(
        (node: any) =>
          typeof node.props.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.startsWith(cs.a11y.pubPillRevealed('U Testu')),
      ),
    ).toBeTruthy();
  });

  it('shrinks the compass at large system font sizes so the bottom controls stay on-screen', () => {
    const { useWindowDimensions } = require('react-native') as {
      useWindowDimensions: jest.Mock;
    };
    const { CompassContainer } = require('@/components/compass/CompassContainer') as {
      CompassContainer: jest.Mock;
    };
    useCompass.mockReturnValue(baseCompassState());

    // Baseline: default mock dimensions (390×844, fontScale 1) → full design size.
    act(() => {
      TestRenderer.create(React.createElement(CompassScreen));
    });
    const baselineSize = CompassContainer.mock.calls.at(-1)?.[0]?.size;
    expect(baselineSize).toBe(320);

    // Samsung-style accessibility font scale: the chrome reserve grows, so the
    // compass must give up vertical space instead of pushing controls off-screen.
    useWindowDimensions.mockReturnValueOnce({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 2,
    });
    act(() => {
      TestRenderer.create(React.createElement(CompassScreen));
    });
    const scaledSize = CompassContainer.mock.calls.at(-1)?.[0]?.size;
    expect(scaledSize).toBeLessThan(baselineSize);
  });

  it('uses measured scene height after the tab bar takes vertical space', () => {
    const { CompassContainer } = require('@/components/compass/CompassContainer') as {
      CompassContainer: jest.Mock;
    };
    useCompass.mockReturnValue(baseCompassState());
    CompassContainer.mockClear();

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    expect(CompassContainer.mock.calls.at(-1)?.[0]?.size).toBe(320);

    const measuredRoot = renderer!.root.find(
      (node: any) => typeof node.props.onLayout === 'function',
    );

    act(() => {
      measuredRoot.props.onLayout({
        nativeEvent: { layout: { width: 390, height: 744 } },
      });
    });

    expect(CompassContainer.mock.calls.at(-1)?.[0]?.size).toBeLessThan(320);
  });

  it('places the title bar in the top-left on the active compass', () => {
    const { TitleBar } = require('@/components/shared/TitleBar') as {
      TitleBar: jest.Mock;
    };
    useCompass.mockReturnValue(baseCompassState());
    TitleBar.mockClear();

    act(() => {
      TestRenderer.create(React.createElement(CompassScreen));
    });

    // Settings now lives in the Profile tab, so the compass header drops the
    // gear and only carries the left-aligned title (plus the centered filter).
    expect(TitleBar).toHaveBeenCalledWith(
      expect.objectContaining({ align: 'left', showGear: false }),
      undefined,
    );
  });

  it('reserves revealed-card height before the pub is revealed', () => {
    act(() => {
      useSettingsStore.setState({ hidePubNames: true });
    });
    useCompass.mockReturnValue(baseCompassState());

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    const hiddenPill = renderer!.root.findByProps({ accessibilityLabel: cs.a11y.pubPillHidden });
    const hiddenStyle = hiddenPill.props.style({ pressed: false });

    expect(hiddenStyle[0].minHeight).toBeGreaterThanOrEqual(160);
  });

  it('keeps the surprise mode label on one line', () => {
    useCompass.mockReturnValue(baseCompassState());

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    const surpriseLabel = renderer!.root.find(
      (node: any) => node.type === 'Text' && node.children.includes(cs.compass.modeSurprise),
    );

    expect(surpriseLabel.props.numberOfLines).toBe(1);
    expect(surpriseLabel.props.adjustsFontSizeToFit).toBe(true);
    expect(surpriseLabel.props.minimumFontScale).toBeLessThan(1);
  });

  it('syncs compass mode changes to the account preferences endpoint', () => {
    const setMode = jest.fn();
    useCompass.mockReturnValue({ ...baseCompassState(), setMode });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    const surpriseButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.modeSurpriseButton,
    });

    act(() => {
      surpriseButton.props.onPress();
    });

    expect(setMode).toHaveBeenCalledWith('surprise');
    expect(updateAccountPreferences).toHaveBeenCalledWith({ mode: 'surprise' });
  });

  it('opens the report reason sheet from the revealed pub pill', () => {
    const reportCurrentPub = jest.fn(async () => true);
    (Alert.alert as jest.Mock).mockImplementation(() => undefined);
    useCompass.mockReturnValue({
      ...baseCompassState(),
      revealed: true,
      reportCurrentPub,
    });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(React.createElement(CompassScreen));
    });

    const reportButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.reportPubButton,
    });

    act(() => {
      reportButton.props.onPress();
    });

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    act(() => {
      buttons?.[2]?.onPress?.();
    });

    expect(reportCurrentPub).toHaveBeenCalledWith('not_pub');
  });

  it('prefills contribute hours from Firmy.cz opening hours when community hours are absent', () => {
    const push = jest.fn();
    mockedUseRouter.mockReturnValue({ push });
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

    const contributeButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.contributeOrAddButton,
    });

    act(() => {
      contributeButton.props.onPress();
    });

    // The compact pub card funnels contribute/add through an action sheet;
    // pick the first option ("Doplnit / přidat" → contribute).
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    act(() => {
      buttons?.[0]?.onPress?.();
    });

    expect(push).toHaveBeenCalledTimes(1);
    const route = push.mock.calls[0][0];
    expect(route.pathname).toBe('/contribute');
    expect(JSON.parse(route.params.hours)).toEqual({
      mo: [['11:00', '23:00']],
      tu: [['11:00', '23:00']],
      we: [['11:00', '23:00']],
      th: [['11:00', '23:00']],
      fr: [['11:00', '23:00']],
      sa: [['12:00', '00:00']],
      su: [],
    });
  });

  it('opens add-pub from the revealed pub pill with current coordinates', () => {
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

    const addPubButton = renderer!.root.findByProps({
      accessibilityLabel: cs.a11y.contributeOrAddButton,
    });

    act(() => {
      addPubButton.props.onPress();
    });

    // Second action-sheet option ("Přidat hospodu" → add-pub).
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    act(() => {
      buttons?.[1]?.onPress?.();
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
