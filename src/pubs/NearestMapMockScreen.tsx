/**
 * DESIGN MOCK — the map, turned the way you are.
 *
 * A north-up map makes you do the rotation in your head. This one turns with
 * the phone, so "the pub is up and slightly left on screen" means "the pub is
 * up and slightly left in the street". It is the compass idea, drawn as a map:
 * one place in focus, and the world rotating around you rather than the pin
 * moving around a static north.
 *
 * The heading arrives on the UI thread as a Reanimated shared value, so it is
 * brought over to JS deliberately and cheaply:
 *
 *   - only when the bearing has actually moved by `HEADING_STEP` degrees, and
 *   - through `animateCamera`, never by re-rendering a controlled `camera`
 *     prop, which would rebuild the map on every sensor tick.
 *
 * That threshold is the whole cost story: the magnetometer fires far faster
 * than a map can redraw, and a camera animation per tick is what turns a map
 * into a battery complaint.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';

import { ChevronLeftIcon, LocateFixedIcon } from '@/components/shared/IconGlyph';
import { useDeviceHeading } from '@/compass/useDeviceHeading';
import { EMPTY_NEARBY_PUB_FILTERS, useNearbyPubs } from '@/pubs/useNearbyPubs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** Degrees the phone must turn before the map is told about it. */
const HEADING_STEP = 2;
/** Matches the sensor cadence closely enough to look continuous. */
const CAMERA_MS = 220;
const ZOOM = 17;

export default function NearestMapMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const lastHeadingRef = useRef<number | null>(null);
  const nearby = useNearbyPubs(EMPTY_NEARBY_PUB_FILTERS);
  const pub = nearby.pubs[0] ?? null;
  const pubLat = pub?.lat;
  const pubLng = pub?.lng;

  const { smoothedHeading } = useDeviceHeading(true);

  const applyHeading = useCallback((heading: number) => {
    const previous = lastHeadingRef.current;
    if (previous !== null && Math.abs(heading - previous) < HEADING_STEP) return;
    lastHeadingRef.current = heading;
    mapRef.current?.animateCamera({ heading }, { duration: CAMERA_MS });
  }, []);

  useAnimatedReaction(
    () => smoothedHeading.value,
    (heading) => {
      if (heading === null) return;
      runOnJS(applyHeading)(heading);
    },
  );

  // Frame the pub once; after this only the heading changes.
  useEffect(() => {
    if (pubLat == null || pubLng == null) return;
    mapRef.current?.setCamera({
      center: { latitude: pubLat, longitude: pubLng },
      zoom: ZOOM,
    });
  }, [pubLat, pubLng]);

  const recentre = () => {
    if (!pub) return;
    mapRef.current?.animateCamera(
      { center: { latitude: pub.lat, longitude: pub.lng }, zoom: ZOOM },
      { duration: 320 },
    );
  };

  if (!pub || !nearby.position) {
    return (
      <View style={styles.emptyScreen}>
        <Text style={styles.emptyText}>
          {nearby.loading
            ? 'Hledám nejbližší hospodu…'
            : nearby.permissionState === 'granted'
              ? 'V okolí teď žádnou hospodu nevidím.'
              : 'Bez polohy ti cestu neotočím.'}
        </Text>
        {!nearby.loading ? (
          <Pressable
            onPress={() =>
              nearby.permissionState === 'granted'
                ? nearby.retry()
                : void nearby.requestPermission()
            }
            style={styles.emptyButton}
          >
            <Text style={styles.emptyButtonText}>
              {nearby.permissionState === 'granted' ? 'Zkusit znovu' : 'Povolit polohu'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialCamera={{
          center: { latitude: pub.lat, longitude: pub.lng },
          heading: 0,
          pitch: 0,
          zoom: ZOOM,
          altitude: 0,
        }}
        userInterfaceStyle="dark"
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        loadingBackgroundColor={Colors.stout}
        loadingIndicatorColor={Colors.amber}
      >
        <Marker
          coordinate={{ latitude: pub.lat, longitude: pub.lng }}
          tracksViewChanges={false}
          accessibilityLabel={pub.name}
        >
          <View style={styles.pin} />
        </Marker>
      </MapView>

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpátky"
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <View style={styles.grow} />
        <Pressable
          onPress={recentre}
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Vycentrovat na hospodu"
        >
          <LocateFixedIcon size={20} color={Colors.foam} />
        </Pressable>
      </View>

      {/* The one place in focus, restated at the bottom so the map never has to
          be read to know where you are being sent. */}
      <View style={[styles.card, { marginBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.grow}>
          <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.distance} · {pub.hoursLabel}
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText} allowFontScaling={false}>
            Nejbližší
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  emptyScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    backgroundColor: Colors.stout,
  },
  emptyText: { ...MockType.body, color: Colors.mutedText, textAlign: 'center' },
  emptyButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  emptyButtonText: { fontSize: 14, fontWeight: '700', color: Colors.amber },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  topBar: {
    position: 'absolute',
    top: 0,
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.6),
  },

  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.amber,
    borderWidth: 3,
    borderColor: withAlpha('#000000', 0.75),
  },

  card: {
    marginTop: 'auto',
    marginHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: MockLayout.cardRadius,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.1),
  },
  pub: { ...MockType.titleS, color: Colors.foam },
  meta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },
  badge: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: Colors.amber },
});
