/**
 * DESIGN MOCK — the night, on a real map.
 *
 * An earlier pass drew the route as an abstract zig-zag. It was wrong twice: a
 * stretched viewBox squashed the dots into ellipses, and a one-pub night became
 * a single meaningless blob. The deeper mistake was the premise — Strava's card
 * is worth sharing because it shows a REAL map of a REAL place, and no amount
 * of tidying makes an invented polyline do that.
 *
 * `react-native-maps` on Google (the app's provider in `BeerMapScreen`), a
 * numbered pin per pub, framed to fit them all, dark to match the card, and
 * non-interactive: it is the card's picture, not a map you drive. The whole
 * card is one tap into the night's detail.
 *
 * Two things this file learned the hard way:
 *
 *  - Use `region`, not `initialRegion`. The latter is applied once at mount,
 *    and a MapView that mounts before layout has a size falls back to a
 *    continent — which is exactly what it did.
 *  - The caption is a fade, not a bar. A solid strip across the picture reads
 *    as a broken overlay; a gradient that dissolves into the map reads as part
 *    of it.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { ImagesIcon } from '@/components/shared/IconGlyph';
import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

const HEIGHT = 170;
/** Street level. One pub should look like a corner, not a country. */
const MIN_SPAN = 0.006;
/** How tall the bottom fade is. */
const FADE = 78;

/**
 * `showsPointsOfInterests` is an Apple Maps prop and this map is Google, so
 * every church, museum and Hard Rock Cafe was shouting over the night's own
 * pins. On Google the same request is a style rule.
 */
const MAP_STYLE = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

export interface RouteStop {
  name: string;
  lat: number;
  lng: number;
}

/** Frame every stop with a little room around them. */
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
    latitudeDelta: Math.max(MIN_SPAN, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(MIN_SPAN, (maxLng - minLng) * 1.6),
  };
}

export function NightRoute({
  stops,
  live = false,
  photos = 0,
  height = HEIGHT,
  caption = true,
  fallbackCenter,
}: {
  stops: RouteStop[];
  live?: boolean;
  photos?: number;
  /** Card hero by default; a shorter strip when it heads a live party. */
  height?: number;
  /** The route printed over the fade. Off where the screen already names the
   *  place — in the party hub the header says it two rows below. */
  caption?: boolean;
  /** Where to look when there are no stops yet — the party hub's idle state
   *  frames the neighbourhood the evening is about to happen in instead of
   *  rendering nothing and leaving a black band. No marker: there is no stop
   *  to number, just a place. `span` widens the frame for a centre the app is
   *  only guessing at (no fix yet), so it reads as "somewhere here" rather than
   *  as a wrong street corner. */
  fallbackCenter?: { lat: number; lng: number; span?: number };
}) {
  const region = useMemo(() => {
    if (stops.length > 0) return regionFor(stops);
    if (fallbackCenter) {
      const span = Math.max(MIN_SPAN, fallbackCenter.span ?? MIN_SPAN);
      return {
        latitude: fallbackCenter.lat,
        longitude: fallbackCenter.lng,
        latitudeDelta: span,
        longitudeDelta: span,
      };
    }
    return null;
  }, [fallbackCenter, stops]);
  const tint = live ? MockColors.live : MockColors.accent;

  if (!region) return null;

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        region={region}
        userInterfaceStyle="dark"
        mapType="standard"
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsPointsOfInterests={false}
        customMapStyle={MAP_STYLE}
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

      {/* The map dissolves into the card instead of being cut by a bar. */}
      <View style={styles.fade} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="mapFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity="0" />
              <Stop offset="0.55" stopColor="#000000" stopOpacity="0.55" />
              <Stop offset="1" stopColor="#000000" stopOpacity="0.88" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#mapFade)" />
        </Svg>
      </View>

      {/* Caption left, the night's photos right — both riding the same fade. */}
      <View style={styles.foot} pointerEvents="none">
        {caption ? (
          <Text
            style={[styles.captionText, live && { color: MockColors.live }]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {stops.map((s) => s.name).join('  →  ')}
          </Text>
        ) : (
          <View style={styles.grow} />
        )}
        {photos > 0 ? (
          <View style={styles.photoPill}>
            <ImagesIcon size={13} color={Colors.foam} />
            <Text style={styles.photoText} allowFontScaling={false}>
              {photos}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  wrap: { overflow: 'hidden', backgroundColor: MockColors.bg },
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
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: FADE },
  foot: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  captionText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: withAlpha(Colors.amber, 0.95),
  },
  photoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    height: 26,
    borderRadius: 13,
    backgroundColor: withAlpha('#000000', 0.55),
  },
  photoText: { fontSize: 12, fontWeight: '700', color: Colors.foam },
});
