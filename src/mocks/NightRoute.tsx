/**
 * DESIGN MOCK — the night, on a real map.
 *
 * The first attempt drew the route as an abstract zig-zag diagram. It was
 * wrong twice: a stretched viewBox squashed the dots into ellipses, and a
 * one-pub night degenerated into a single meaningless blob. The deeper mistake
 * was the premise — Strava's card is worth sharing because it shows a REAL map
 * of a REAL place, and no amount of tidying makes a made-up polyline do that.
 *
 * So this is the actual map: `react-native-maps` on Google (already the app's
 * provider in `BeerMapScreen`), a pin per pub, framed to fit them all, in dark
 * to match the card. Non-interactive on purpose — it is the card's picture,
 * not a map you drive; the whole card is one tap into the night's detail.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

const HEIGHT = 170;
/** Never frame tighter than this, or one pub fills the card with rooftops. */
const MIN_SPAN = 0.012;

export interface RouteStop {
  name: string;
  lat: number;
  lng: number;
}

/** Frame every stop with room to breathe. */
function regionFor(stops: RouteStop[]): Region {
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(MIN_SPAN, (maxLat - minLat) * 1.9),
    longitudeDelta: Math.max(MIN_SPAN, (maxLng - minLng) * 1.9),
  };
}

export function NightRoute({ stops, live = false }: { stops: RouteStop[]; live?: boolean }) {
  const region = useMemo(() => (stops.length > 0 ? regionFor(stops) : null), [stops]);
  const tint = live ? MockColors.live : MockColors.accent;

  if (!region) return null;

  return (
    <View style={styles.wrap}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        userInterfaceStyle="dark"
        mapType="standard"
        // The card's picture, not a map you drive.
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        loadingBackgroundColor={MockColors.bg}
        loadingIndicatorColor={Colors.amber}
        pointerEvents="none"
      >
        {stops.map((stop, index) => (
          <Marker
            key={`${stop.name}-${index}`}
            coordinate={{ latitude: stop.lat, longitude: stop.lng }}
            tracksViewChanges={false}
          >
            <View style={[styles.pin, { borderColor: tint }]}>
              <Text style={[styles.pinText, { color: tint }]} allowFontScaling={false}>
                {index + 1}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* The chain, spelled out along the foot — the map's caption. */}
      <View style={styles.caption} pointerEvents="none">
        <Text
          style={[styles.captionText, live && { color: MockColors.live }]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {stops.map((s) => s.name).join('  →  ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: HEIGHT, overflow: 'hidden', backgroundColor: MockColors.bg },
  pin: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderWidth: 2,
    backgroundColor: withAlpha('#000000', 0.75),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: { fontSize: 12, fontWeight: '800' },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: withAlpha('#000000', 0.55),
  },
  captionText: { fontSize: 13, fontWeight: '600', color: withAlpha(Colors.amber, 0.95) },
});
