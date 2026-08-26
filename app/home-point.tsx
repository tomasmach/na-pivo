import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, type MapPressEvent, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon, HouseIcon, MapPinIcon, TargetIcon, Trash2Icon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import { geocodePubLocation } from '@/data/mapyClient';
import { t } from '@/i18n';
import { leaveRoute } from '@/navigation/leaveRoute';
import { useSettingsStore, type HomePoint } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { openHomeInMaps } from '@/utils/maps';

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

async function geocodeHomeAddress(query: string, signal: AbortSignal): Promise<HomePoint | null> {
  try {
    const [nativeResult] = await Location.geocodeAsync(query);
    if (
      !signal.aborted &&
      nativeResult &&
      Number.isFinite(nativeResult.latitude) &&
      Number.isFinite(nativeResult.longitude)
    ) {
      return { lat: nativeResult.latitude, lng: nativeResult.longitude };
    }
  } catch {
    // Android's native geocoder requires foreground location permission. Do
    // not prompt just for an address lookup; use the existing backend fallback.
  }

  if (signal.aborted) return null;
  const result = await geocodePubLocation({ name: '', address: query }, signal);
  return result ? { lat: result.lat, lng: result.lng } : null;
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
  const [addressQuery, setAddressQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchAbortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const resetScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
      if (resetScrollTimerRef.current) clearTimeout(resetScrollTimerRef.current);
    },
    [],
  );

  const dirty = useMemo(
    () => draftPoint?.lat !== savedPoint?.lat || draftPoint?.lng !== savedPoint?.lng,
    [draftPoint, savedPoint],
  );

  const handleMapPress = useCallback((event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setDraftPoint({ lat: latitude, lng: longitude });
    setPermissionDenied(false);
    setSearchError('');
  }, []);

  const handleAddressChange = useCallback((value: string) => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearching(false);
    setAddressQuery(value);
    setSearchError('');
  }, []);

  const handleFindOnMap = useCallback(async () => {
    const query = addressQuery.trim();
    if (!query || searching) {
      if (!query) setSearchError(t.homePoint.emptyQueryError);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setSearchError('');
    Keyboard.dismiss();

    try {
      const result = await geocodeHomeAddress(query, controller.signal);
      if (controller.signal.aborted) return;
      if (!result) {
        setSearchError(t.homePoint.notFoundError);
        return;
      }

      setDraftPoint(result);
      setRegion(regionFor(result));
      setPermissionDenied(false);
      if (resetScrollTimerRef.current) clearTimeout(resetScrollTimerRef.current);
      resetScrollTimerRef.current = setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        resetScrollTimerRef.current = null;
      }, 350);
    } catch {
      if (!controller.signal.aborted) {
        setSearchError(t.homePoint.searchFailedError);
      }
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setSearching(false);
      }
    }
  }, [addressQuery, searching]);

  const handleUseCurrentLocation = useCallback(async () => {
    if (locating) return;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearching(false);
    setLocating(true);
    setSearchError('');
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
    } catch {
      setSearchError(t.addPub.locationUnavailable);
    } finally {
      setLocating(false);
    }
  }, [locating]);

  const save = useCallback(() => {
    if (!draftPoint) return;
    setHomePoint(draftPoint);
    leaveRoute(router);
  }, [draftPoint, router, setHomePoint]);

  const clear = useCallback(() => {
    setHomePoint(null);
    leaveRoute(router);
  }, [router, setHomePoint]);

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => leaveRoute(router)} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t.a11y.vycepBack}>
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.homePoint.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.addressSection}>
          <Text style={styles.lead}>{t.homePoint.lead}</Text>
          <Text style={styles.label}>{t.homePoint.addressLabel}</Text>
          <TextInput
            value={addressQuery}
            onChangeText={handleAddressChange}
            onSubmitEditing={() => void handleFindOnMap()}
            placeholder={t.homePoint.addressPlaceholder}
            placeholderTextColor={Colors.mutedText}
            returnKeyType="search"
            autoCapitalize="sentences"
            autoCorrect={false}
            maxLength={150}
            style={styles.input}
            accessibilityLabel={t.homePoint.addressA11y}
          />
          <Pressable
            onPress={() => void handleFindOnMap()}
            disabled={searching}
            style={({ pressed }) => [styles.primaryButton, searching && styles.disabled, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.homePoint.findOnMapA11y}
          >
            {searching ? <ActivityIndicator color={Colors.stout} /> : <MapPinIcon size={18} color={Colors.stout} />}
            <Text style={styles.primaryButtonText}>{searching ? t.homePoint.searching : t.homePoint.findOnMap}</Text>
          </Pressable>

          <View style={styles.alternativeRow}>
            <View style={styles.alternativeLine} />
            <Text style={styles.alternativeText}>{t.homePoint.or}</Text>
            <View style={styles.alternativeLine} />
          </View>

          <Pressable onPress={() => void handleUseCurrentLocation()} disabled={locating} style={({ pressed }) => [styles.secondaryButton, locating && styles.disabled, pressed && styles.pressed]} accessibilityRole="button">
            {locating ? <ActivityIndicator color={Colors.foam} /> : <TargetIcon size={18} color={Colors.foam} />}
            <Text style={styles.secondaryButtonText}>{t.homePoint.useCurrentLocation}</Text>
          </Pressable>

          <Text style={styles.privacy}>{t.homePoint.privacy}</Text>
        </View>

        {searchError ? <Text style={styles.error}>{searchError}</Text> : null}

        <View style={styles.mapFrame}>
          <MapView
            style={StyleSheet.absoluteFill}
            region={region}
            onRegionChangeComplete={setRegion}
            onPress={handleMapPress}
            showsUserLocation={false}
            showsMyLocationButton={false}
            accessibilityLabel={t.homePoint.mapA11y}
          >
            {draftPoint ? <Marker coordinate={{ latitude: draftPoint.lat, longitude: draftPoint.lng }} /> : null}
          </MapView>
          {!draftPoint ? (
            <View pointerEvents="none" style={styles.mapHint}>
              <MapPinIcon size={18} color={Colors.amber} />
              <Text style={styles.mapHintText}>{t.homePoint.mapHint}</Text>
            </View>
          ) : null}
        </View>

        {draftPoint ? (
          <Text style={styles.refineHint}>{t.homePoint.refineHint}</Text>
        ) : null}

        {permissionDenied ? (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>{t.homePoint.permissionDenied}</Text>
            <Pressable onPress={() => void openSystemSettings()} accessibilityRole="button" style={styles.inlineButton}>
              <Text style={styles.inlineButtonText}>{t.empty.openSettings}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* The point exists to be walked to. Without this the app could store a
            home and never take you there — `openHomeInMaps` had no caller at
            all. Outlined, not amber: saving is still what this screen is for. */}
        {savedPoint ? (
          <Pressable
            onPress={() => void openHomeInMaps(savedPoint)}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.compass.moreHome}
          >
            <HouseIcon size={18} color={Colors.foam} />
            <Text style={styles.secondaryButtonText}>{t.compass.moreHome}</Text>
          </Pressable>
        ) : null}

        {savedPoint ? (
          <Pressable onPress={clear} style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]} accessibilityRole="button">
            <Trash2Icon size={16} color={Colors.foamMuted} />
            <Text style={styles.clearButtonText}>{t.homePoint.clear}</Text>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.saveBar, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <Pressable onPress={save} disabled={!draftPoint || !dirty} style={({ pressed }) => [styles.primaryButton, (!draftPoint || !dirty) && styles.disabled, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>{savedPoint ? t.homePoint.saveChange : t.homePoint.save}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.stout },
  header: { position: 'relative', zIndex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, backgroundColor: Colors.stout },
  headerButton: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: Colors.stout2, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 24, color: Colors.foam },
  headerSpacer: { width: 44 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  saveBar: { paddingTop: Spacing.sm, paddingHorizontal: Spacing.lg, backgroundColor: Colors.stout },
  addressSection: { gap: Spacing.sm },
  lead: { fontWeight: '600', fontSize: 17, lineHeight: 23, color: Colors.foam },
  label: { marginTop: Spacing.xs, fontWeight: '600', fontSize: 13.5, color: Colors.foamMuted },
  input: { minHeight: 52, borderRadius: Radius.medium, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.stout2, paddingHorizontal: Spacing.md, paddingVertical: 12, fontWeight: '400', fontSize: 16, letterSpacing: 0, color: Colors.foam },
  privacy: { marginTop: 2, fontWeight: '400', fontSize: 13, lineHeight: 18, color: Colors.foamMuted, maxWidth: 520 },
  error: { fontWeight: '500', fontSize: 13.5, lineHeight: 19, color: Colors.amberLight },
  mapFrame: { height: 320, overflow: 'hidden', borderRadius: Radius.card, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.stout2 },
  mapHint: { position: 'absolute', alignSelf: 'center', top: 16, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: Colors.stout, borderWidth: 1, borderColor: withAlpha(Colors.amber, 0.45) },
  mapHintText: { fontWeight: '600', fontSize: 12.5, color: Colors.foam },
  refineHint: { marginTop: -4, fontWeight: '400', fontSize: 13.5, lineHeight: 19, color: Colors.foamMuted },
  fallback: { padding: Spacing.md, borderRadius: Radius.medium, borderWidth: 1, borderColor: withAlpha(Colors.amber, 0.4), backgroundColor: withAlpha(Colors.amber, 0.08), gap: Spacing.sm },
  fallbackText: { fontWeight: '400', fontSize: 13.5, lineHeight: 19, color: Colors.foamMuted },
  inlineButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
  inlineButtonText: { fontWeight: '600', fontSize: 13.5, color: Colors.amberLight },
  secondaryButton: { minHeight: 50, borderRadius: Radius.medium, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.stout2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryButtonText: { fontWeight: '600', fontSize: 15, color: Colors.foam },
  alternativeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: 2 },
  alternativeLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  alternativeText: { fontWeight: '500', fontSize: 12.5, color: Colors.mutedText },
  primaryButton: { minHeight: 52, borderRadius: Radius.medium, backgroundColor: Colors.amber, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButtonText: { fontWeight: '700', fontSize: 16, color: Colors.stout },
  clearButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  clearButtonText: { fontWeight: '500', fontSize: 13.5, color: Colors.foamMuted },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
