/**
 * Add missing pub screen.
 *
 * Lets a user submit a pub that the nearby search did not return. The write is
 * queued for retry and also inserted into the current in-memory pub index so the
 * compass can target it immediately after returning.
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import {
  CheckIcon,
  ChevronLeftIcon,
  MapPinIcon,
  TargetIcon,
} from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import { generateUuidV4 } from '@/data/account';
import { buildAddedPubEntry } from '@/data/addedPubsClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { enqueueAddedPub, enqueueAddedPubEdit } from '@/data/addedPubsQueue';
import { clearPubsSnapshot, pubIdForCoords, upsertLocalPub } from '@/data/pubs';
import { usePubStore } from '@/stores/pubStore';
import { useToastStore } from '@/stores/toastStore';
import { fireSuccessHaptic } from '@/utils/haptics';

function parseStringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parseCoordParam(value: string | string[] | undefined): number | null {
  const raw = parseStringParam(value);
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
  source: 'current' | 'pin';
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
          displayLocation: cs.addPub.mapPinSelectedBody,
          source: 'pin',
        }
      : null,
  );
  const nameChanged = name.trim() !== initialName;
  const locationCorrectionSelected = selectedLocation !== null;
  const canSubmit =
    name.trim().length > 0 &&
    (isEditing
      ? (nameChanged || locationCorrectionSelected) &&
        (!locationCorrectionSelected || (city.trim().length > 0 && address.trim().length > 0))
      : city.trim().length > 0 && address.trim().length > 0 && locationCorrectionSelected) &&
    !locating &&
    !submitted;
  const currentLocationSelected = locationCorrectionSelected;

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

    setLocating(true);
    setLocationError('');
    try {
      // Creation receives the compass' fresh position as a shortcut. A location
      // correction deliberately requires a new fix taken at the pub.
      let coords: Coordinates | null = isEditing ? null : initialCoords;
      if (!coords) {
        const permission = await ensureLocationPermission();
        if (permission !== 'granted') {
          setLocationError(cs.addPub.locationPermissionDenied);
          showToast(cs.addPub.locationPermissionDenied);
          if (permission === 'denied') await openSystemSettings();
          return;
        }

        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        coords = {
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
        };
      }

      setSelectedLocation({
        ...coords,
        displayLocation: fromMapPin
          ? cs.addPub.mapPinSelectedBody
          : cs.addPub.currentLocationSelectedBody,
        source: fromMapPin ? 'pin' : 'current',
      });
    } catch {
      setLocationError(cs.addPub.locationUnavailable);
      showToast(cs.addPub.locationUnavailable);
    } finally {
      setLocating(false);
    }
  }, [currentLocationSelected, fromMapPin, initialAddress, initialCity, initialCoords, isEditing, showToast]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    trackUiInteraction('add_pub_submit', 'submit');
    setSubmitted(true);
    setLocationError('');

    const trimmedName = name.trim().slice(0, 200);
    const trimmedCity = city.trim();
    const trimmedAddress = address.trim();

    const location = selectedLocation ?? initialCoords;

    if (!isEditing && !location) {
      setSubmitted(false);
      setLocationError(cs.addPub.locationError);
      showToast(cs.addPub.locationError);
      return;
    }

    if (location) {
      upsertLocalPub({
        id: pubIdForCoords(location.lat, location.lng),
        name: trimmedName,
        lat: location.lat,
        lng: location.lng,
        city: trimmedCity,
        address: trimmedAddress,
        venueKind: 'pub',
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
          },
          generateUuidV4(),
        ));
    void sync.then((state) => {
      trackUiInteraction('add_pub_submit', state === 'failed' ? 'failure' : 'success');
      bumpCatalogRevision();
      showToast(
        state === 'synced'
          ? isEditing
            ? cs.addPub.editSavedToast
            : cs.addPub.savedToast
          : state === 'failed'
            ? cs.addPub.failedToast
            : cs.addPub.queuedToast,
      );
    });
    void fireSuccessHaptic();
    showToast(isEditing ? cs.addPub.editQueuedToast : cs.addPub.queuedToast);
    router.back();
  }, [
    address,
    bumpCatalogRevision,
    canSubmit,
    city,
    editedClientId,
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
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>

        <Text style={styles.headerTitle}>{isEditing ? cs.addPub.editTitle : cs.addPub.title}</Text>
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
            {isEditing ? cs.addPub.editIntro : cs.addPub.intro}
          </Text>
        </View>

        <View style={styles.locationCard}>
          <Text style={styles.locationHeader}>{isEditing ? cs.addPub.editLocationHeader : cs.addPub.locationHeader}</Text>
          <Text style={styles.locationBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {isEditing
              ? cs.addPub.editLocationBody
              : fromMapPin
                ? cs.addPub.mapPinLocationBody
                : cs.addPub.locationBody}
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
                    ? cs.a11y.addPubMapPinSelected
                    : cs.a11y.addPubCurrentLocationSelected
                  : cs.a11y.addPubUseCurrentLocationButton
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
                    ? cs.addPub.locating
                    : isEditing
                      ? cs.addPub.editUseCurrentLocation
                      : fromMapPin
                        ? cs.addPub.useMapPin
                        : cs.addPub.useCurrentLocation}
                </Text>
                <Text
                  style={styles.currentLocationBody}
                  maxFontSizeMultiplier={FontScaleCap.body}
                  numberOfLines={3}
                >
                  {isEditing
                    ? cs.addPub.editUseCurrentLocationHint
                    : fromMapPin
                      ? cs.addPub.useMapPinHint
                      : cs.addPub.useCurrentLocationHint}
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
          <Text style={styles.label}>{cs.addPub.nameLabel}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(value) => {
              setName(value);
              setLocationError('');
            }}
            placeholder={cs.addPub.namePlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={200}
            accessibilityLabel={cs.a11y.addPubNameInput}
          />
          {selectedLocation && (
            <View style={styles.suggestions}>
              <View
                style={[styles.selectedSuggestion, styles.selectedCurrentLocation]}
                accessibilityLabel={
                  selectedLocation.source === 'pin'
                    ? cs.a11y.addPubMapPinSelected
                    : cs.a11y.addPubCurrentLocationSelected
                }
              >
                <MapPinIcon size={16} color={Colors.amber} />
                <View style={styles.suggestionText}>
                  <Text style={styles.suggestionName} maxFontSizeMultiplier={FontScaleCap.body}>
                    {selectedLocation.source === 'pin'
                      ? cs.addPub.mapPinSelectedTitle
                      : cs.addPub.currentLocationSelectedTitle}
                  </Text>
                  <Text
                    style={styles.suggestionLocation}
                    maxFontSizeMultiplier={FontScaleCap.body}
                    numberOfLines={2}
                  >
                    {selectedLocation.displayLocation}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{cs.addPub.cityLabel}</Text>
          <TextInput
            style={[styles.input, isEditing && !locationCorrectionSelected && styles.inputDisabled]}
            value={city}
            onChangeText={setCity}
            editable={!isEditing || locationCorrectionSelected}
            placeholder={cs.addPub.cityPlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={128}
            accessibilityLabel={cs.a11y.addPubCityInput}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{cs.addPub.addressLabel}</Text>
          <TextInput
            style={[styles.input, isEditing && !locationCorrectionSelected && styles.inputDisabled]}
            value={address}
            onChangeText={setAddress}
            editable={!isEditing || locationCorrectionSelected}
            placeholder={cs.addPub.addressPlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={255}
            accessibilityLabel={cs.a11y.addPubAddressInput}
          />
        </View>

        {!!locationError && (
          <Text style={styles.invalidText} maxFontSizeMultiplier={FontScaleCap.body}>
            {locationError}
          </Text>
        )}

        <View style={styles.submitButton}>
          <GlowButton
            label={submitted ? cs.addPub.saving : isEditing ? cs.addPub.editSave : cs.addPub.save}
            onPress={handleSubmit}
            glow="none"
            accessibilityLabel={cs.a11y.addPubSaveButton}
          />
          {!canSubmit && <View style={styles.submitDisabledOverlay} />}
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
    fontWeight: '800',
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
    fontWeight: '400',
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
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
  },
  suggestionLocation: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foamMuted,
  },
  label: {
    fontWeight: '700',
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
    fontWeight: '400',
    fontSize: 16,
    letterSpacing: 0,
    color: Colors.foam,
  },
  inputDisabled: {
    opacity: 0.55,
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
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
    marginBottom: Spacing.md,
  },
  locationBody: {
    fontWeight: '400',
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
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 19,
    color: Colors.foam,
  },
  currentLocationBody: {
    fontWeight: '400',
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
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amberLight,
  },
  submitButton: {
    position: 'relative',
    marginTop: Spacing.sm,
  },
  submitDisabledOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.42),
  },
});
