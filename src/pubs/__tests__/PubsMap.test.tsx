import React, { forwardRef, useImperativeHandle } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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
    { children }: { children?: React.ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      animateCamera: mockAnimateCamera,
      animateToRegion: mockAnimateToRegion,
    }));
    return <View>{children}</View>;
  }),
  Marker: ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: React.ReactNode;
    onPress?: () => void;
  }) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress}>
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

function presentation(openState: PubPresentation['openState']): PubPresentation {
  const pub = {
    id: 'pub-1',
    name: 'U Testu',
    lat: 50.08,
    lng: 14.43,
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
});
