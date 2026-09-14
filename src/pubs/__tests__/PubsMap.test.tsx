import React, { forwardRef, useImperativeHandle } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import type { Pub } from '@/data/pubs';
import { Colors, withAlpha } from '@/theme/colors';
import type { PubPresentation } from '@/pubs/pubPresentation';
import { PubsMap } from '@/pubs/PubsMap';

const mockAnimateCamera = jest.fn();
const mockAnimateToRegion = jest.fn();

jest.mock('react-native-maps', () => ({
  __esModule: true,
  PROVIDER_GOOGLE: 'google',
  default: forwardRef(function MockMapView(
    { children, ...props }: { children?: React.ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      animateCamera: mockAnimateCamera,
      animateToRegion: mockAnimateToRegion,
      fitToCoordinates: jest.fn(),
    }));
    return (
      <View testID="map-view" {...props}>
        {children}
      </View>
    );
  }),
  Marker: ({
    accessibilityLabel,
    children,
    onPress,
    ...props
  }: {
    accessibilityLabel?: string;
    children?: React.ReactNode;
    onPress?: () => void;
  }) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} {...props}>
      {children}
    </Pressable>
  ),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: ({ color, size }: { color: string; size: number }) => (
    <View
      testID="pub-map-marker-icon"
      accessibilityValue={{ text: `${size}:${color}` }}
    />
  ),
}));

function presentation(
  openState: PubPresentation['openState'],
  overrides: { id?: string; name?: string; lat?: number; lng?: number } = {},
): PubPresentation {
  const pub = {
    id: overrides.id ?? 'pub-1',
    name: overrides.name ?? 'U Testu',
    lat: overrides.lat ?? 50.08,
    lng: overrides.lng ?? 14.43,
  } as Pub;
  return {
    pub,
    id: pub.id,
    name: pub.name,
    address: 'Praha',
    distanceMeters: 120,
    distanceLabel: '120 m',
    distanceValue: '120',
    distanceUnit: 'm',
    openState,
    openLabel: openState === 'closed' ? 'Zavřeno' : 'Otevřeno',
    featuredTap: null,
    beerLine: null,
    rating: null,
    ratingLabel: null,
    hasGarden: false,
    hasTankBeer: false,
    visitCount: 0,
    lastVisitedAt: null,
  };
}

describe('PubsMap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it('renders each pub as a tappable beer marker instead of a tiny dot', () => {
    const { getByTestId } = render(
      <PubsMap
        pubs={[presentation('open')]}
        currentPosition={{ lat: 50.08, lng: 14.43 }}
      />,
    );

    expect(StyleSheet.flatten(getByTestId('pub-map-marker-hit').props.style)).toMatchObject({
      width: 56,
      height: 56,
    });
    expect(StyleSheet.flatten(getByTestId('pub-map-marker-visual').props.style)).toMatchObject({
      width: 31,
      height: 31,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: Colors.amber,
    });
    expect(getByTestId('pub-map-marker-icon').props.accessibilityValue.text).toBe(
      `15:${Colors.foam}`,
    );
  });

  it('mutes closed pub markers without making them smaller', () => {
    const { getByTestId } = render(
      <PubsMap
        pubs={[presentation('closed')]}
        currentPosition={{ lat: 50.08, lng: 14.43 }}
      />,
    );

    expect(StyleSheet.flatten(getByTestId('pub-map-marker-visual').props.style)).toMatchObject({
      width: 31,
      height: 31,
      borderColor: withAlpha(Colors.foamMuted, 0.58),
    });
    expect(getByTestId('pub-map-marker-icon').props.accessibilityValue.text).toBe(
      `15:${withAlpha(Colors.foam, 0.58)}`,
    );
  });

  it('lifts the Google attribution above the sheet instead of clamping it under one', () => {
    const { height } = Dimensions.get('window');
    const sheetInset = Math.round(height * 0.8);

    const { getByTestId } = render(
      <PubsMap
        pubs={[presentation('open')]}
        currentPosition={{ lat: 50.08, lng: 14.43 }}
        bottomInset={sheetInset}
      />,
    );

    const padding = getByTestId('map-view').props.mapPadding;
    expect(padding.bottom).toBe(sheetInset);
    expect(padding.bottom).toBeGreaterThan(Math.round(height * 0.62));
  });

  it('still leaves the map a strip to draw in when the inset is absurd', () => {
    const { height } = Dimensions.get('window');

    const { getByTestId } = render(
      <PubsMap
        pubs={[presentation('open')]}
        currentPosition={{ lat: 50.08, lng: 14.43 }}
        bottomInset={height * 4}
      />,
    );

    expect(getByTestId('map-view').props.mapPadding.bottom).toBe(Math.round(height - 88));
  });

  it('keeps pub names off the attribution corner', () => {
    const { queryByText } = render(
      <PubsMap
        pubs={[
          presentation('open', {
            id: 'corner',
            name: 'U Loga',
            lat: 50.08 - 0.0122,
            lng: 14.43 - 0.0122,
          }),
          presentation('open', { id: 'middle', name: 'U Stredu' }),
        ]}
        currentPosition={{ lat: 50.08, lng: 14.43 }}
      />,
    );

    expect(queryByText('U Stredu')).not.toBeNull();
    expect(queryByText('U Loga')).toBeNull();
  });

  it('renders the cluster count and freezes the marker only after it has laid out', () => {
    const { getByTestId, getByLabelText } = render(
      <PubsMap
        pubs={[
          presentation('open', { id: 'a', name: 'A', lat: 50.08, lng: 14.43 }),
          presentation('open', { id: 'b', name: 'B', lat: 50.0801, lng: 14.4301 }),
        ]}
        currentPosition={{ lat: 50.08, lng: 14.43 }}
      />,
    );

    expect(getByTestId('pub-map-cluster')).toHaveTextContent('2');
    expect(getByTestId('pub-map-cluster').props.collapsable).toBe(false);

    const marker = getByLabelText('2 hospody. Přiblížit');
    expect(marker.props.tracksViewChanges).toBe(true);

    act(() => jest.advanceTimersByTime(200));

    expect(getByLabelText('2 hospody. Přiblížit').props.tracksViewChanges).toBe(false);
    expect(getByTestId('pub-map-cluster')).toHaveTextContent('2');
  });

  it('gives the selected pub label the same settle before freezing', () => {
    const { getByTestId, getByLabelText } = render(
      <PubsMap
        pubs={[presentation('open')]}
        currentPosition={{ lat: 50.08, lng: 14.43 }}
        selectedId="pub-1"
      />,
    );

    expect(getByTestId('pub-map-selected')).toHaveTextContent('U Testu');
    expect(getByTestId('pub-map-selected').props.collapsable).toBe(false);
    expect(getByLabelText('U Testu').props.tracksViewChanges).toBe(true);

    act(() => jest.advanceTimersByTime(200));

    expect(getByLabelText('U Testu').props.tracksViewChanges).toBe(false);
  });
});
