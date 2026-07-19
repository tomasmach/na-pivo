import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, type MapPressEvent, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon, MapPinIcon, TargetIcon, Trash2Icon } from '@/components/shared/IconGlyph';
import { ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import { useSettingsStore, type HomePoint } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const CZECHIA_REGION: Region = {
  latitude: 49.8175,
  longitude: 15.473,
  latitudeDelta: 4.5,
  longitudeDelta: 4.5,
};

function regionFor(point: HomePoint | null): Region {
  if (!point) return CZECHIA_REGION;
  return { latitude: point.lat, longitude: point.lng, latitudeDelta: 0.025, longitudeDelta: 0.025 };
}

export default function HomePointScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const savedPoint = useSettingsStore((state) => state.homePoint);
  const setHomePoint = useSettingsStore((state) => state.setHomePoint);
  const [draftPoint, setDraftPoint] = useState<HomePoint | null>(savedPoint);
  const [region, setRegion] = useState(() => regionFor(savedPoint));
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [locating, setLocating] = useState(false);

  const dirty = useMemo(
    () => draftPoint?.lat !== savedPoint?.lat || draftPoint?.lng !== savedPoint?.lng,
    [draftPoint, savedPoint],
  );

  const handleMapPress = useCallback((event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setDraftPoint({ lat: latitude, lng: longitude });
    setPermissionDenied(false);
  }, []);

  const handleUseCurrentLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      const permission = await ensureLocationPermission();
      if (permission !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point = { lat: location.coords.latitude, lng: location.coords.longitude };
      setDraftPoint(point);
      setRegion(regionFor(point));
      setPermissionDenied(false);
    } finally {
      setLocating(false);
    }
  }, [locating]);

  const save = useCallback(() => {
    if (!draftPoint) return;
    setHomePoint(draftPoint);
    router.back();
  }, [draftPoint, router, setHomePoint]);

  const clear = useCallback(() => {
    setHomePoint(null);
    router.back();
  }, [router, setHomePoint]);

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Zpět">
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle}>Domovský bod</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <View>
          <Text style={styles.lead}>Ťukni do mapy, nebo použij svoji současnou polohu.</Text>
          <Text style={styles.privacy}>Uložím až potvrzený bod — jen do tohoto telefonu. Trasy ani historii polohy nesbírám.</Text>
        </View>

        <View style={styles.mapFrame}>
          <MapView
            style={StyleSheet.absoluteFill}
            region={region}
            onRegionChangeComplete={setRegion}
            onPress={handleMapPress}
            showsUserLocation={false}
            showsMyLocationButton={false}
            accessibilityLabel="Mapa pro výběr domovského bodu"
          >
            {draftPoint ? <Marker coordinate={{ latitude: draftPoint.lat, longitude: draftPoint.lng }} /> : null}
          </MapView>
          {!draftPoint ? (
            <View pointerEvents="none" style={styles.mapHint}>
              <MapPinIcon size={18} color={Colors.amber} />
              <Text style={styles.mapHintText}>Vyber místo v mapě</Text>
            </View>
          ) : null}
        </View>

        {permissionDenied ? (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>Poloha je vypnutá. Domov můžeš vybrat ručně v mapě, nebo povolení změnit v nastavení telefonu.</Text>
            <Pressable onPress={() => void openSystemSettings()} accessibilityRole="button" style={styles.inlineButton}>
              <Text style={styles.inlineButtonText}>Otevřít nastavení</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={() => void handleUseCurrentLocation()} disabled={locating} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} accessibilityRole="button">
          {locating ? <ActivityIndicator color={Colors.foam} /> : <TargetIcon size={18} color={Colors.foam} />}
          <Text style={styles.secondaryButtonText}>Použít moji polohu</Text>
        </Pressable>

        <Pressable onPress={save} disabled={!draftPoint || !dirty} style={({ pressed }) => [styles.primaryButton, (!draftPoint || !dirty) && styles.disabled, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>{savedPoint ? 'Uložit změnu' : 'Uložit domov'}</Text>
        </Pressable>

        {savedPoint ? (
          <Pressable onPress={clear} style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]} accessibilityRole="button">
            <Trash2Icon size={16} color={Colors.foamMuted} />
            <Text style={styles.clearButtonText}>Smazat domovský bod</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.stout },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
  headerButton: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: Colors.stout2, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: Fonts.display.extrabold, fontSize: 24, color: Colors.foam },
  headerSpacer: { width: 44 },
  content: { flex: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  lead: { fontFamily: Fonts.ui.semibold, fontSize: 17, lineHeight: 23, color: Colors.foam },
  privacy: { marginTop: 4, fontFamily: Fonts.ui.regular, fontSize: 13.5, lineHeight: 19, color: Colors.foamMuted, maxWidth: 520 },
  mapFrame: { flex: 1, minHeight: 280, overflow: 'hidden', borderRadius: Radius.card, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.stout2 },
  mapHint: { position: 'absolute', alignSelf: 'center', top: 16, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: Colors.stout, borderWidth: 1, borderColor: withAlpha(Colors.amber, 0.45) },
  mapHintText: { fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foam },
  fallback: { padding: Spacing.md, borderRadius: Radius.medium, borderWidth: 1, borderColor: withAlpha(Colors.amber, 0.4), backgroundColor: withAlpha(Colors.amber, 0.08), gap: Spacing.sm },
  fallbackText: { fontFamily: Fonts.ui.regular, fontSize: 13.5, lineHeight: 19, color: Colors.foamMuted },
  inlineButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
  inlineButtonText: { fontFamily: Fonts.ui.semibold, fontSize: 13.5, color: Colors.amberLight },
  secondaryButton: { minHeight: 50, borderRadius: Radius.medium, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.stout2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryButtonText: { fontFamily: Fonts.ui.semibold, fontSize: 15, color: Colors.foam },
  primaryButton: { minHeight: 52, borderRadius: Radius.medium, backgroundColor: Colors.amber, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontFamily: Fonts.ui.bold, fontSize: 16, color: Colors.stout },
  clearButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  clearButtonText: { fontFamily: Fonts.ui.medium, fontSize: 13.5, color: Colors.foamMuted },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
