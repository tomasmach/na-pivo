/**
 * Add missing pub screen.
 *
 * Lets a user submit a pub that the nearby search did not return. The write is
 * queued for retry and also inserted into the current in-memory pub index so the
 * compass can target it immediately after returning.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import {
  CheckIcon,
  ChevronLeftIcon,
  MapPinIcon,
  TargetIcon,
} from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { generateUuidV4 } from '@/data/account';
import { buildAddedPubEntry } from '@/data/addedPubsClient';
import { enqueueAddedPub } from '@/data/addedPubsQueue';
import {
  geocodePubLocation,
  isSpecificGeocodeResult,
  suggestPubLocations,
  type PubLocationSuggestion,
} from '@/data/mapyClient';
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

interface SelectedLocation {
  lat: number;
  lng: number;
  city?: string;
  address?: string;
  displayLocation?: string;
  source?: 'suggestion' | 'current';
}

export default function AddPubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const bumpCatalogRevision = usePubStore((s) => s.bumpCatalogRevision);
  const showToast = useToastStore((s) => s.show);

  const initialLat = useMemo(() => parseCoordParam(params.lat), [params.lat]);
  const initialLng = useMemo(() => parseCoordParam(params.lng), [params.lng]);
  const initialCoords = useMemo<SelectedLocation | null>(
    () =>
      isUsableCoordPair(initialLat, initialLng)
        ? { lat: initialLat, lng: initialLng as number }
        : null,
    [initialLat, initialLng],
  );

  const [name, setName] = useState('');
  const [city, setCity] = useState(parseStringParam(params.city));
  const [address, setAddress] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null);
  const [suggestions, setSuggestions] = useState<PubLocationSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  // A concrete street address is what lets us geocode to an exact spot. City
  // alone only resolves to the municipality centroid, so it must not enable a
  // save on its own (see handleSubmit).
  const hasStreetAddress = address.trim().length > 0;
  const canSubmit =
    name.trim().length > 0 &&
    (selectedLocation !== null || hasStreetAddress) &&
    !submitted;
  const currentLocationSelected = selectedLocation?.source === 'current';

  useEffect(() => {
    const query = name.trim();
    // No search will run for this state — make sure a previously-shown spinner
    // does not stay visible. Done in an async tick to avoid a synchronous
    // setState inside the effect body.
    if (query.length < 2 || selectedLocation || submitted) {
      const reset = setTimeout(() => setSuggesting(false), 0);
      return () => clearTimeout(reset);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      suggestPubLocations({ name: query, near: initialCoords }, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setSuggestions(results);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSuggesting(false);
        });
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [initialCoords, name, selectedLocation, submitted]);

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      setLocationError('');
      if (value.trim().length < 2 || selectedLocation?.source === 'current') {
        setSuggestions([]);
        setSuggesting(false);
      } else {
        setSuggesting(true);
      }
      if (selectedLocation && selectedLocation.source !== 'current') setSelectedLocation(null);
    },
    [selectedLocation],
  );

  const handleSuggestionPress = useCallback((suggestion: PubLocationSuggestion) => {
    setSelectedLocation({
      lat: suggestion.lat,
      lng: suggestion.lng,
      city: suggestion.city,
      address: suggestion.address,
      displayLocation: suggestion.location,
      source: 'suggestion',
    });
    setName(suggestion.name);
    setCity(suggestion.city ?? '');
    setAddress(suggestion.address ?? '');
    setSuggestions([]);
    setLocationError('');
  }, []);

  const handleUseCurrentLocation = useCallback(() => {
    if (!initialCoords) return;
    setSelectedLocation({
      ...initialCoords,
      city: city.trim() || undefined,
      displayLocation: cs.addPub.currentLocationSelectedBody,
      source: 'current',
    });
    setSuggestions([]);
    setSuggesting(false);
    setLocationError('');
  }, [city, initialCoords]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitted(true);
    setLocationError('');
    setSuggestions([]);
    setSuggesting(false);

    const trimmedName = name.trim().slice(0, 200);
    const trimmedCity = city.trim();
    const trimmedAddress = address.trim();

    // Only geocode when there is a concrete street address. Geocoding from a
    // bare city name returns the municipality centroid, which must never be
    // saved as the pub's location. When the user did type an address, never
    // silently fall back to current GPS; that would put the pub under their feet.
    let geocodedLocation = null;
    if (!selectedLocation && trimmedAddress) {
      const result = await geocodePubLocation({
        name: trimmedName,
        city: trimmedCity || undefined,
        address: trimmedAddress,
        near: initialCoords,
      });
      // Reject area centroids (regional.municipality/region/…): if the typed
      // address cannot pin an exact place, ask for a precise pick.
      if (result && isSpecificGeocodeResult(result)) {
        geocodedLocation = result;
      } else {
        setSubmitted(false);
        setLocationError(cs.addPub.locationImprecise);
        showToast(cs.addPub.locationImprecise);
        return;
      }
    }

    const location = selectedLocation ?? geocodedLocation;

    if (!location) {
      setSubmitted(false);
      setLocationError(cs.addPub.locationError);
      showToast(cs.addPub.locationError);
      return;
    }

    const resolvedCity = trimmedCity || location.city || '';
    const resolvedAddress = trimmedAddress || location.address || '';
    const entry = buildAddedPubEntry(
      {
        name: trimmedName,
        lat: location.lat,
        lng: location.lng,
        city: resolvedCity || undefined,
        address: resolvedAddress || undefined,
      },
      generateUuidV4(),
    );

    upsertLocalPub({
      id: pubIdForCoords(location.lat, location.lng),
      name: trimmedName,
      lat: location.lat,
      lng: location.lng,
      ...(resolvedCity ? { city: resolvedCity } : {}),
      ...(resolvedAddress ? { address: resolvedAddress } : {}),
      venueKind: 'pub',
    });
    bumpCatalogRevision();
    void clearPubsSnapshot();
    void enqueueAddedPub(entry).then(() => bumpCatalogRevision());
    void fireSuccessHaptic();
    showToast(cs.addPub.savedToast);
    router.back();
  }, [
    address,
    bumpCatalogRevision,
    canSubmit,
    city,
    initialCoords,
    name,
    router,
    selectedLocation,
    showToast,
  ]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>

        <Text style={styles.headerTitle}>{cs.addPub.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
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
            {cs.addPub.intro}
          </Text>
        </View>

        <View style={styles.locationCard}>
          <Text style={styles.locationHeader}>{cs.addPub.locationHeader}</Text>
          <Text style={styles.locationBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {initialCoords ? cs.addPub.locationWithCurrent : cs.addPub.locationFromAddress}
          </Text>
          {initialCoords && (
            <Pressable
              onPress={handleUseCurrentLocation}
              style={({ pressed }) => [
                styles.currentLocationButton,
                currentLocationSelected && styles.currentLocationButtonSelected,
                pressed && styles.currentLocationButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                currentLocationSelected
                  ? cs.a11y.addPubCurrentLocationSelected
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
                <TargetIcon
                  size={18}
                  color={currentLocationSelected ? Colors.stout : Colors.amber}
                />
              </View>
              <View style={styles.currentLocationCopy}>
                <Text
                  style={styles.currentLocationTitle}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.addPub.useCurrentLocation}
                </Text>
                <Text
                  style={styles.currentLocationBody}
                  maxFontSizeMultiplier={FontScaleCap.body}
                  numberOfLines={3}
                >
                  {cs.addPub.useCurrentLocationHint}
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
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{cs.addPub.nameLabel}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={handleNameChange}
            placeholder={cs.addPub.namePlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={200}
            accessibilityLabel={cs.a11y.addPubNameInput}
          />
          {(suggestions.length > 0 || suggesting || selectedLocation) && (
            <View style={styles.suggestions}>
              {selectedLocation && (
                <View
                  style={[
                    styles.selectedSuggestion,
                    currentLocationSelected && styles.selectedCurrentLocation,
                  ]}
                  accessibilityLabel={
                    currentLocationSelected ? cs.a11y.addPubCurrentLocationSelected : undefined
                  }
                >
                  <MapPinIcon size={16} color={Colors.amber} />
                  <View style={styles.suggestionText}>
                    <Text style={styles.suggestionName} maxFontSizeMultiplier={FontScaleCap.body}>
                      {currentLocationSelected
                        ? cs.addPub.currentLocationSelectedTitle
                        : cs.addPub.selectedPlace}
                    </Text>
                    <Text
                      style={styles.suggestionLocation}
                      maxFontSizeMultiplier={FontScaleCap.body}
                      numberOfLines={2}
                    >
                      {selectedLocation.displayLocation || [address, city].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                </View>
              )}
              {!selectedLocation &&
                suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion.id}
                    onPress={() => handleSuggestionPress(suggestion)}
                    style={({ pressed }) => [styles.suggestionRow, pressed && styles.suggestionPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.a11y.addPubSuggestion(suggestion.name)}
                  >
                    <View style={styles.suggestionIcon}>
                      <MapPinIcon size={15} color={Colors.amber} />
                    </View>
                    <View style={styles.suggestionText}>
                      <Text
                        style={styles.suggestionName}
                        maxFontSizeMultiplier={FontScaleCap.body}
                        numberOfLines={1}
                      >
                        {suggestion.name}
                      </Text>
                      {!!suggestion.location && (
                        <Text
                          style={styles.suggestionLocation}
                          maxFontSizeMultiplier={FontScaleCap.body}
                          numberOfLines={2}
                        >
                          {suggestion.location}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              {!selectedLocation && suggesting && (
                <Text style={styles.suggestionHint} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.addPub.searchingPlaces}
                </Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.twoColumn}>
          <View style={styles.column}>
            <Text style={styles.label}>{cs.addPub.cityLabel}</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder={cs.addPub.cityPlaceholder}
              placeholderTextColor={Colors.mutedText}
              maxLength={128}
              accessibilityLabel={cs.a11y.addPubCityInput}
            />
          </View>
          <View style={styles.column}>
            <Text style={styles.label}>{cs.addPub.addressLabel}</Text>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholder={cs.addPub.addressPlaceholder}
              placeholderTextColor={Colors.mutedText}
              maxLength={255}
              accessibilityLabel={cs.a11y.addPubAddressInput}
            />
          </View>
        </View>

        {!!locationError && (
          <Text style={styles.invalidText} maxFontSizeMultiplier={FontScaleCap.body}>
            {locationError}
          </Text>
        )}

        <View style={styles.submitButton}>
          <GlowButton
            label={submitted ? cs.addPub.saving : cs.addPub.save}
            onPress={handleSubmit}
            glow={canSubmit ? 'soft' : 'none'}
            accessibilityLabel={cs.a11y.addPubSaveButton}
          />
          {!canSubmit && <View style={styles.submitDisabledOverlay} />}
        </View>
      </ScrollView>
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
  suggestionRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(Colors.border, 0.45),
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
  suggestionPressed: {
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  suggestionIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.1),
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
  suggestionHint: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
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
    fontFamily: Fonts.ui.medium,
    fontSize: 16,
    color: Colors.foam,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  column: {
    flex: 1,
    gap: Spacing.sm,
  },
  locationCard: {
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
