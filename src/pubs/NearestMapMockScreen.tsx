import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';

import { ChevronLeftIcon, LocateFixedIcon } from '@/components/shared/IconGlyph';
import { useDeviceHeading } from '@/compass/useDeviceHeading';
import { useCompass } from '@/hooks/useCompass';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { presentPub } from '@/pubs/pubPresentation';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const HEADING_STEP = 2;
const CAMERA_MS = 220;
const ZOOM = 17;

export default function NearestMapMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const lastHeadingRef = useRef<number | null>(null);
  const compass = useCompass(null, [], null, null, true, false);
  const { smoothedHeading } = useDeviceHeading(true);
  const target = compass.pub;
  const presentation = target
    ? presentPub(target, compass.currentPosition)
    : null;

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

  useEffect(() => {
    if (!target) return;
    mapRef.current?.setCamera({
      center: { latitude: target.lat, longitude: target.lng },
      zoom: ZOOM,
    });
  }, [target]);

  const recentre = () => {
    if (!target) return;
    mapRef.current?.animateCamera(
      { center: { latitude: target.lat, longitude: target.lng }, zoom: ZOOM },
      { duration: 320 },
    );
  };

  if (!target || !presentation) {
    return (
      <View style={styles.screen}>
        <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.round, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Zpátky"
          >
            <ChevronLeftIcon size={22} color={Colors.foam} />
          </Pressable>
        </View>
        <View style={styles.state}>
          {compass.isLoading && compass.permissionState !== 'denied' ? (
            <ActivityIndicator color={Colors.amber} />
          ) : null}
          <Text style={styles.stateText} maxFontSizeMultiplier={FontScaleCap.body}>
            {compass.permissionState === 'denied'
              ? 'Povol polohu a ukážu ti nejbližší hospodu.'
              : compass.searchFailed
                ? 'Hospodu se teď nepodařilo načíst.'
                : 'Hledám nejbližší hospodu…'}
          </Text>
          {compass.permissionState === 'denied' ? (
            <Pressable
              onPress={() => void compass.requestPermission()}
              style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.stateButtonText}>Povolit polohu</Text>
            </Pressable>
          ) : compass.searchFailed ? (
            <Pressable
              onPress={compass.retrySearch}
              style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.stateButtonText}>Zkusit znovu</Text>
            </Pressable>
          ) : null}
        </View>
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
          center: { latitude: target.lat, longitude: target.lng },
          heading: 0,
          pitch: 0,
          zoom: ZOOM,
          altitude: 0,
        }}
        userInterfaceStyle="dark"
        showsUserLocation={compass.currentPosition != null}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        loadingBackgroundColor={Colors.stout}
        loadingIndicatorColor={Colors.amber}
      >
        <Marker
          coordinate={{ latitude: target.lat, longitude: target.lng }}
          tracksViewChanges={false}
          accessibilityLabel={target.name}
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

      <View style={[styles.card, { marginBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.grow}>
          <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {presentation.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {[presentation.distanceLabel, presentation.openLabel].filter(Boolean).join(' · ')}
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
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  stateText: { fontSize: 15, fontWeight: '600', color: Colors.mutedText, textAlign: 'center' },
  stateButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  stateButtonText: { fontSize: 15, fontWeight: '700', color: Colors.foam },
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
