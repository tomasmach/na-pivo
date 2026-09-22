/**
 * Add missing pub screen.
 *
 * Lets a user submit a pub that the nearby search did not return. The write is
 * queued for retry and also inserted into the current in-memory pub index so the
 * compass can target it immediately after returning.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { t } from '@/i18n';
import {
  CheckIcon,
  ChevronLeftIcon,
  MapPinIcon,
  TargetIcon,
} from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { ensureLocationPermission } from '@/compass/permissions';
import { generateUuidV4 } from '@/data/account';
import { buildAddedPubEntry } from '@/data/addedPubsClient';
import { lookupAddedPubLocation, type AddedPubLocation } from '@/data/addedPubLocationClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { enqueueAddedPub, enqueueAddedPubEdit } from '@/data/addedPubsQueue';
import { clearPubsSnapshot, pubIdForCoords, upsertLocalPub } from '@/data/pubs';
import { usePubStore } from '@/stores/pubStore';
import { useToastStore } from '@/stores/toastStore';
import { fireSuccessHaptic } from '@/utils/haptics';
import { resetBeerMapLayerForAddedPub } from '@/map/BeerMapScreen';

function parseStringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parseCoordParam(value: string | string[] | undefined): number | null {
  const raw = parseStringParam(value);
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUsableCoordPair(lat: number | null, lng: number | null): lat is number {
  if (lat === null || lng === null) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001;
}

interface Coordinates {
  lat: number;
  lng: number;
}

interface SelectedLocation extends Coordinates {
  displayLocation?: string;
  source: 'pin' | 'address';
}

export default function AddPubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const editedClientId = useMemo(() => parseStringParam(params.clientId), [params.clientId]);
  const isEditing = editedClientId.length > 0;
  const bumpCatalogRevision = usePubStore((s) => s.bumpCatalogRevision);
  const showToast = useToastStore((s) => s.show);

  const initialLat = useMemo(() => parseCoordParam(params.lat), [params.lat]);
  const initialLng = useMemo(() => parseCoordParam(params.lng), [params.lng]);
  const initialCoords = useMemo<Coordinates | null>(
    () =>
      isUsableCoordPair(initialLat, initialLng)
        ? { lat: initialLat, lng: initialLng as number }
        : null,
    [initialLat, initialLng],
  );

  // The map hands over a pin the user aimed deliberately, so it arrives
  // pre-selected and the location card talks about the pin, not "current
  // location" — the user may be nowhere near the pub.
  const fromMapPin =
    !isEditing && parseStringParam(params.source) === 'map' && initialCoords !== null;

  const initialName = useMemo(() => parseStringParam(params.name).trim(), [params.name]);
  const initialCity = useMemo(() => parseStringParam(params.city).trim(), [params.city]);
  const initialAddress = useMemo(() => parseStringParam(params.address).trim(), [params.address]);
  const [name, setName] = useState(initialName);
  const [city, setCity] = useState(initialCity);
  const [address, setAddress] = useState(initialAddress);
  const [submitted, setSubmitted] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(() =>
    fromMapPin && initialCoords
      ? {
          ...initialCoords,
          displayLocation: t.addPub.mapPinSelectedBody,
          source: 'pin',
        }
      : null,
  );
  const [candidate, setCandidate] = useState<AddedPubLocation | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  useEffect(() => () => lookupRequest.current?.abort(), []);
  const addressChanged = city.trim() !== initialCity || address.trim() !== initialAddress;
  const nameChanged = name.trim() !== initialName;
  const locationCorrectionSelected = selectedLocation !== null;
  const canSubmit =
    name.trim().length > 0 &&
    (isEditing
      ? (nameChanged || locationCorrectionSelected) &&
        (!addressChanged || locationCorrectionSelected) &&
        (!locationCorrectionSelected || (city.trim().length > 0 && address.trim().length > 0))
      : city.trim().length > 0 && address.trim().length > 0 && locationCorrectionSelected) &&
    !locating &&
    !submitted;
  const currentLocationSelected = selectedLocation?.source === 'pin';

  const clearLookup = useCallback(() => {
    lookupRequest.current?.abort();
    lookupRequest.current = null;
    setLocating(false);
    setCandidate(null);
    setLocationError('');
    // An explicitly aimed map pin is independent of its text label. An address
    // result and a reverse-geocoded GPS point are valid only for those fields.
    setSelectedLocation((location) => location?.source === 'pin' ? location : null);
  }, []);

  const handleFindAddress = useCallback(async () => {
    clearLookup();
    setSelectedLocation(null);
    const request = new AbortController();
    lookupRequest.current = request;
    setLocating(true);
    const result = await lookupAddedPubLocation({ address: address.trim(), city: city.trim() }, request.signal);
    if (request.signal.aborted) return;
    setCandidate(result);
    if (!result) setLocationError(t.addPub.addressLookupFailed);
    setLocating(false);
  }, [address, city, clearLookup]);

  const handleUseCurrentLocation = useCallback(async () => {
    trackUiInteraction('add_pub_location', 'select');
    if (currentLocationSelected) {
      setSelectedLocation(null);
      if (isEditing) {
        setCity(initialCity);
        setAddress(initialAddress);
      }
      setLocationError('');
      return;
    }

    clearLookup();
    setSelectedLocation(null);
    if (fromMapPin && initialCoords) {
      setSelectedLocation({ ...initialCoords, source: 'pin', displayLocation: t.addPub.mapPinSelectedBody });
      return;
    }
    const request = new AbortController();
    lookupRequest.current = request;
    setLocating(true);
    try {
      const permission = await ensureLocationPermission({ openSettingsIfDenied: true });
      if (request.signal.aborted) return;
      if (permission !== 'granted') {
        setLocationError(t.addPub.locationPermissionDenied);
        return;
      }
      // Route coordinates may belong to another pub, or be an old GPS fix.
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (request.signal.aborted) return;
      const result = await lookupAddedPubLocation({ lat: fix.coords.latitude, lng: fix.coords.longitude }, request.signal);
      if (request.signal.aborted) return;
      setCandidate(result);
      if (!result) setLocationError(t.addPub.addressLookupFailed);
    } catch {
      if (!request.signal.aborted) setLocationError(t.addPub.locationUnavailable);
    } finally {
      if (!request.signal.aborted) setLocating(false);
    }
  }, [clearLookup, currentLocationSelected, fromMapPin, initialAddress, initialCity, initialCoords, isEditing]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    trackUiInteraction('add_pub_submit', 'submit');
    setSubmitted(true);
    setLocationError('');

    const trimmedName = name.trim().slice(0, 200);
    const trimmedCity = city.trim();
    const trimmedAddress = address.trim();
    const clientId = isEditing ? editedClientId : generateUuidV4();

    const location = selectedLocation ?? initialCoords;

    if (!isEditing && !location) {
      submitting.current = false;
      setSubmitted(false);
      setLocationError(t.addPub.locationError);
      showToast(t.addPub.locationError);
      return;
    }

    if (location) {
      if (fromMapPin) resetBeerMapLayerForAddedPub();
      upsertLocalPub({
        id: pubIdForCoords(location.lat, location.lng),
        name: trimmedName,
        lat: location.lat,
        lng: location.lng,
        city: trimmedCity,
        address: trimmedAddress,
        venueKind: 'pub',
        userAddedClientId: clientId,
      });
      bumpCatalogRevision();
      void clearPubsSnapshot();
    }
    const sync = isEditing
      ? enqueueAddedPubEdit({
          client_id: editedClientId,
          ...(nameChanged ? { name: trimmedName } : {}),
          ...(selectedLocation
            ? {
                lat: selectedLocation.lat,
                lng: selectedLocation.lng,
                city: trimmedCity,
                address: trimmedAddress,
              }
            : {}),
        })
      : enqueueAddedPub(buildAddedPubEntry(
          {
            name: trimmedName,
            lat: selectedLocation!.lat,
            lng: selectedLocation!.lng,
            city: trimmedCity,
            address: trimmedAddress,
            ...(selectedLocation!.source === 'pin' ? { locationSource: 'map_pin' as const } : {}),
          },
          clientId,
        ));
    void sync.then((state) => {
      trackUiInteraction('add_pub_submit', state === 'failed' ? 'failure' : 'success');
      bumpCatalogRevision();
      showToast(
        state === 'synced'
          ? isEditing
            ? t.addPub.editSavedToast
            : t.addPub.savedToast
          : state === 'failed'
            ? t.addPub.failedToast
            : t.addPub.queuedToast,
      );
    });
    void fireSuccessHaptic();
    showToast(isEditing ? t.addPub.editQueuedToast : t.addPub.queuedToast);
    router.back();
  }, [
    address,
    bumpCatalogRevision,
    canSubmit,
    city,
    editedClientId,
    fromMapPin,
    initialCoords,
    isEditing,
    nameChanged,
    name,
    router,
    selectedLocation,
    showToast,
  ]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            trackUiInteraction('add_pub_cancel', 'cancel');
            router.back();
          }}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>

        <Text style={styles.headerTitle}>{isEditing ? t.addPub.editTitle : t.addPub.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Android is edge-to-edge, so `adjustResize` no longer pushes content
          above the keyboard — pad it here (iOS pads via keyboard insets below). */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={Platform.OS === 'android'}>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 24, 32) },
        ]}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconRow}>
          <View style={styles.iconWell}>
            <MapPinIcon size={18} color={Colors.amber} />
          </View>
          <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
            {isEditing ? t.addPub.editIntro : t.addPub.intro}
          </Text>
        </View>

        <View style={styles.locationCard}>
          <Text style={styles.locationHeader}>{isEditing ? t.addPub.editLocationHeader : t.addPub.locationHeader}</Text>
          <Text style={styles.locationBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {isEditing
              ? t.addPub.editLocationBody
              : fromMapPin
                ? t.addPub.mapPinLocationBody
                : t.addPub.locationBody}
          </Text>
          <Pressable
              onPress={() => void handleUseCurrentLocation()}
              style={({ pressed }) => [
                styles.currentLocationButton,
                currentLocationSelected && styles.currentLocationButtonSelected,
                pressed && styles.currentLocationButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                currentLocationSelected
                  ? fromMapPin
                    ? t.a11y.addPubMapPinSelected
                    : t.a11y.addPubCurrentLocationSelected
                  : t.a11y.addPubUseCurrentLocationButton
              }
              accessibilityState={{ selected: currentLocationSelected }}
            >
              <View
                style={[
                  styles.currentLocationIcon,
                  currentLocationSelected && styles.currentLocationIconSelected,
                ]}
              >
                {fromMapPin ? (
                  <MapPinIcon
                    size={18}
                    color={currentLocationSelected ? Colors.stout : Colors.amber}
                  />
                ) : (
                  <TargetIcon
                    size={18}
                    color={currentLocationSelected ? Colors.stout : Colors.amber}
                  />
                )}
              </View>
              <View style={styles.currentLocationCopy}>
                <Text
                  style={styles.currentLocationTitle}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {locating
                    ? t.addPub.locating
                    : isEditing
                      ? t.addPub.editUseCurrentLocation
                      : fromMapPin
                        ? t.addPub.useMapPin
                        : t.addPub.useCurrentLocation}
                </Text>
                <Text
                  style={styles.currentLocationBody}
                  maxFontSizeMultiplier={FontScaleCap.body}
                  numberOfLines={3}
                >
                  {isEditing
                    ? t.addPub.editUseCurrentLocationHint
                    : fromMapPin
                      ? t.addPub.useMapPinHint
                      : t.addPub.useCurrentLocationHint}
                </Text>
              </View>
              <View
                style={[
                  styles.currentLocationStatus,
                  currentLocationSelected && styles.currentLocationStatusSelected,
                ]}
              >
                {currentLocationSelected ? (
                  <CheckIcon size={15} color={Colors.stout} />
                ) : (
                  <MapPinIcon size={15} color={Colors.amber} />
                )}
              </View>
            </Pressable>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.addPub.nameLabel}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(value) => {
              setName(value);
              setLocationError('');
            }}
            placeholder={t.addPub.namePlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={200}
            accessibilityLabel={t.a11y.addPubNameInput}
          />
          {selectedLocation && (
            <View style={styles.suggestions}>
              <View
                style={[styles.selectedSuggestion, styles.selectedCurrentLocation]}
                accessibilityLabel={
                  selectedLocation.source === 'pin'
                    ? t.a11y.addPubMapPinSelected
                    : t.addPub.addressConfirmed
                }
              >
                <MapPinIcon size={16} color={Colors.amber} />
                <View style={styles.suggestionText}>
                  <Text style={styles.suggestionName} maxFontSizeMultiplier={FontScaleCap.body}>
                    {selectedLocation.source === 'pin'
                      ? t.addPub.mapPinSelectedTitle
                      : t.addPub.addressConfirmed}
                  </Text>
                  <Text
                    style={styles.suggestionLocation}
                    maxFontSizeMultiplier={FontScaleCap.body}
                    numberOfLines={2}
                  >
                    {selectedLocation.displayLocation}
                  </Text>
                  {selectedLocation.source === 'address' && <Text style={styles.suggestionLocation}>Google Maps</Text>}
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.addPub.cityLabel}</Text>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={(value) => { clearLookup(); setCity(value); }}
            placeholder={t.addPub.cityPlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={128}
            accessibilityLabel={t.a11y.addPubCityInput}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.addPub.addressLabel}</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={(value) => { clearLookup(); setAddress(value); }}
            placeholder={t.addPub.addressPlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={255}
            accessibilityLabel={t.a11y.addPubAddressInput}
          />
        </View>

        <Pressable
          onPress={() => void handleFindAddress()}
          disabled={locating || !city.trim() || !address.trim()}
          accessibilityRole="button"
          accessibilityLabel={t.addPub.findAddress}
          accessibilityState={{ disabled: locating || !city.trim() || !address.trim(), busy: locating }}
          style={styles.lookupButton}
        >
          <Text style={styles.currentLocationTitle}>{locating ? t.addPub.locating : t.addPub.findAddress}</Text>
        </Pressable>

        {candidate && (
          <Pressable
            style={styles.selectedSuggestion}
            accessibilityRole="button"
            accessibilityLabel={`${t.addPub.confirmAddress}: ${candidate.address}, ${candidate.city}`}
            onPress={() => {
              lookupRequest.current?.abort();
              setCity(candidate.city);
              setAddress(candidate.address);
              setSelectedLocation({ ...candidate, source: 'address', displayLocation: `${candidate.address}, ${candidate.city}` });
              setCandidate(null);
              setLocationError('');
            }}
          >
            <MapPinIcon size={18} color={Colors.amber} />
            <View style={styles.suggestionText}>
              <Text style={styles.suggestionName}>{candidate.address}, {candidate.city}</Text>
              <Text style={styles.currentLocationTitle}>{t.addPub.confirmAddress}</Text>
              <Text style={styles.suggestionLocation}>Google Maps</Text>
            </View>
          </Pressable>
        )}

        {!!locationError && (
          <Text style={styles.invalidText} maxFontSizeMultiplier={FontScaleCap.body}>
            {locationError}
          </Text>
        )}

        <View style={styles.submitButton}>
          <GlowButton
            label={submitted ? t.addPub.saving : isEditing ? t.addPub.editSave : t.addPub.save}
            onPress={handleSubmit}
            glow="none"
            disabled={!canSubmit}
            accessibilityLabel={t.a11y.addPubSaveButton}
          />

        </View>
      </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 10,
    gap: Spacing.lg,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  iconWell: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: {
    flex: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
  },
  fieldGroup: {
    gap: Spacing.sm,
  },
  suggestions: {
    overflow: 'hidden',
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.24),
    backgroundColor: withAlpha(Colors.stout2, 0.9),
  },
  selectedSuggestion: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  selectedCurrentLocation: {
    backgroundColor: withAlpha(Colors.amber, 0.18),
  },
  suggestionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  suggestionName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  suggestionLocation: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foamMuted,
  },
  label: {
    fontFamily: Fonts.ui.bold,
    fontSize: 12,
    color: Colors.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 52,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    paddingHorizontal: 14,
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    letterSpacing: 0,
    color: Colors.foam,
  },
  locationCard: {
    overflow: 'hidden',
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: withAlpha(Colors.stout2, 0.78),
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  locationHeader: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    marginBottom: Spacing.md,
  },
  locationBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    marginBottom: Spacing.md,
  },
  currentLocationButton: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: -Spacing.lg,
    marginBottom: -Spacing.md,
    borderTopWidth: 1,
    borderTopColor: withAlpha(Colors.amber, 0.2),
    paddingHorizontal: Spacing.lg,
    paddingTop: 14,
    paddingBottom: 15,
  },
  currentLocationButtonSelected: {
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  currentLocationButtonPressed: {
    backgroundColor: withAlpha(Colors.amber, 0.16),
  },
  currentLocationIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.36),
    backgroundColor: withAlpha(Colors.amber, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationIconSelected: {
    borderColor: Colors.amber,
    backgroundColor: Colors.amber,
  },
  currentLocationCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  currentLocationTitle: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    lineHeight: 19,
    color: Colors.foam,
  },
  currentLocationBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foamMuted,
  },
  currentLocationStatus: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationStatusSelected: {
    backgroundColor: Colors.amber,
  },
  invalidText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amberLight,
  },
  submitButton: {
    position: 'relative',
    marginTop: Spacing.sm,
  },
  lookupButton: {
    minHeight: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
});
