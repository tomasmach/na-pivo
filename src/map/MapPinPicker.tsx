import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkLocationPermission } from '@/compass/permissions';
import { GlowButton } from '@/components/shared/GlowButton';
import { MapPinPlusIcon, XIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

export interface PinCoordinates {
  lat: number;
  lng: number;
}

// Whole Czechia, for when the form has no point to start from.
const STREET_DELTA = 0.004;

const COUNTRY_REGION: Region = {
  latitude: 49.8175,
  longitude: 15.473,
  latitudeDelta: 4.7,
  longitudeDelta: 4.2,
};

interface MapPinPickerProps {
  visible: boolean;
  start: PinCoordinates | null;
  onCancel: () => void;
  onConfirm: (coords: PinCoordinates) => void;
}

/**
 * Full-screen map with a fixed pin over the viewport center. The user aims by
 * panning the map underneath, so the chosen point is always explicit.
 */
export function MapPinPicker({ visible, start, onCancel, onConfirm }: MapPinPickerProps) {
  const insets = useSafeAreaInsets();
  const mapColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const mapRef = useRef<MapView>(null);
  const initialRegion: Region = start
    ? { latitude: start.lat, longitude: start.lng, latitudeDelta: STREET_DELTA, longitudeDelta: STREET_DELTA }
    : COUNTRY_REGION;
  const region = useRef(initialRegion);
  const moved = useRef(false);
  const [locationGranted, setLocationGranted] = useState(false);
  // Each opening starts over from `start`; the map itself remounts below.
  // Without one, jump to the last known fix, never asking for permission here.
  useEffect(() => {
    if (!visible) return;
    region.current = initialRegion;
    moved.current = false;
    let active = true;
    void (async () => {
      try {
        if (await checkLocationPermission() !== 'granted') return;
        if (active) setLocationGranted(true);
        if (start) return;
        const fix = await Location.getLastKnownPositionAsync();
        if (!active || !fix || moved.current) return;
        mapRef.current?.animateToRegion({
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          latitudeDelta: STREET_DELTA,
          longitudeDelta: STREET_DELTA,
        }, 0);
      } catch {
        // The whole country stays in view.
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const confirm = async () => {
    // The settled region can lag one gesture behind; the camera is exact.
    let center = { latitude: region.current.latitude, longitude: region.current.longitude };
    try {
      const camera = await mapRef.current?.getCamera();
      if (camera?.center) center = camera.center;
    } catch {
      // Fall back to the last settled region.
    }
    onConfirm({ lat: center.latitude, lng: center.longitude });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        {visible ? (
          <MapView
            key={mapColorScheme}
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            onRegionChangeComplete={(next) => { region.current = next; }}
            onPanDrag={() => { moved.current = true; }}
            showsUserLocation={locationGranted}
            mapType="standard"
            userInterfaceStyle={mapColorScheme}
            showsMyLocationButton={false}
            showsCompass={false}
            toolbarEnabled={false}
            loadingBackgroundColor={mapColorScheme === 'dark' ? Colors.stout : Colors.foam}
            loadingIndicatorColor={Colors.amber}
          />
        ) : null}

        <View style={styles.pinOverlay} pointerEvents="none">
          <View style={styles.pinBalloon}>
            <View style={styles.pinHead}>
              <MapPinPlusIcon size={20} color={Colors.amber} />
            </View>
            <View style={styles.pinStem} />
          </View>
          <View style={styles.pinDot} />
        </View>

        <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]} pointerEvents="box-none">
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.mapPinCancel}
          >
            <XIcon size={19} color={Colors.foamMuted} />
          </Pressable>
          <View style={styles.hintWrap} pointerEvents="none">
            <View style={styles.hintPill}>
              <Text style={styles.hintText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.map.pinHint}
              </Text>
            </View>
          </View>
          <View style={styles.balanceSpacer} />
        </View>

        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
          <GlowButton
            label={t.map.pinConfirm}
            onPress={() => void confirm()}
            variant="primary"
            glow="soft"
            height={62}
            accessibilityLabel={t.map.pinConfirm}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  pressed: { opacity: 0.6 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Round glyph target that has to stay legible over the light map.
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    ...softDrop(),
  },
  balanceSpacer: {
    width: 40,
    height: 40,
  },
  hintWrap: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: Spacing.sm,
  },
  hintPill: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  hintText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foam,
  },
  // The stem bottom touches the exact viewport center.
  pinOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBalloon: {
    alignItems: 'center',
    // Head (40) + stem (12) column, shifted up so the stem tip anchors at the
    // overlay center where pinDot marks the exact spot.
    transform: [{ translateY: -26 }],
  },
  pinHead: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinStem: {
    width: 2,
    height: 12,
    backgroundColor: Colors.stout2,
  },
  pinDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 6,
    height: 6,
    marginTop: -3,
    marginLeft: -3,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
  },
});
