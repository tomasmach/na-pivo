/**
 * DESIGN MOCK — the pub row's picture: a map of the actual spot.
 *
 * The obvious objection to a map per row is cost — a scrolling list of live
 * `MapView`s is heavy on both frame time and battery. `cacheEnabled` is the
 * answer on iOS: the map renders once and is then frozen into a bitmap, so what
 * scrolls is an image, not a map engine. Interaction is off for the same
 * reason, and so that the whole row stays one tap target.
 *
 * Android has no `cacheEnabled`; it has `liteMode`, which is the same idea —
 * a static, non-interactive rendering. Both are set.
 *
 * The provider is the platform's own, not Google: Google's terms require its
 * logo to remain visible, and at thumbnail size that logo covers the map it is
 * attributing. That is a licensing constraint, not a taste one — it cannot be
 * styled away.
 *
 * The remaining real cost is the first render of each tile. If this ships,
 * the list wants either a windowed renderer (only visible rows mount a map) or
 * a cached static-map image per `cacheKey`. Worth saying out loud rather than
 * discovering on a 200-pub list.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView from 'react-native-maps';

import { MockLayout } from '@/mocks/mockTheme';
import { Colors } from '@/theme/colors';

/** Tight enough that the streets around the pub are legible at thumb size. */
const SPAN = 0.0022;

export function PubThumbMap({ lat, lng, size }: { lat: number; lng: number; size: number }) {
  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <MapView
        // Deliberately NOT `PROVIDER_GOOGLE`. Google Maps Platform terms
        // require its logo to stay visible and unobscured, and at 56pt that
        // logo is half the tile — so a Google thumbnail is out on licensing
        // grounds before it is out on looks. The platform map (MapKit on iOS)
        // carries far lighter attribution at this size. The big map keeps
        // Google, where the logo has room to sit legally and unobtrusively.
        style={StyleSheet.absoluteFill}
        region={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: SPAN,
          longitudeDelta: SPAN,
        }}
        userInterfaceStyle="dark"
        // Freeze to a bitmap after the first paint (iOS) / render a static,
        // non-interactive map (Android). A list must not scroll live maps.
        cacheEnabled={Platform.OS === 'ios'}
        liteMode={Platform.OS === 'android'}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        loadingBackgroundColor={Colors.stout3}
        loadingIndicatorColor={Colors.amber}
        pointerEvents="none"
      />
      {/* The pub is the centre of its own thumbnail, so the marker is a fixed
          dot rather than a real `Marker` — one fewer native view per row. */}
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: MockLayout.thumbRadius,
    overflow: 'hidden',
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: Colors.amber,
    borderWidth: 1.5,
    borderColor: '#000000',
  },
});
