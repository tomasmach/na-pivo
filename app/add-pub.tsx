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
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { ChevronLeftIcon, MapPinIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { generateUuidV4 } from '@/data/account';
import { buildAddedPubEntry } from '@/data/addedPubsClient';
import { enqueueAddedPub } from '@/data/addedPubsQueue';
import { clearPubsSnapshot, upsertLocalPub } from '@/data/pubs';
import { usePubStore } from '@/stores/pubStore';
import { useToastStore } from '@/stores/toastStore';
import { fireSuccessHaptic } from '@/utils/haptics';

function parseStringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parseCoordParam(value: string | string[] | undefined): string {
  const raw = parseStringParam(value);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

function parseCoordInput(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function pubIdForCoords(lat: number, lng: number): string {
  return `mapy:${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export default function AddPubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const bumpCatalogRevision = usePubStore((s) => s.bumpCatalogRevision);
  const showToast = useToastStore((s) => s.show);

  const initialLat = useMemo(() => parseCoordParam(params.lat), [params.lat]);
  const initialLng = useMemo(() => parseCoordParam(params.lng), [params.lng]);

  const [name, setName] = useState('');
  const [city, setCity] = useState(parseStringParam(params.city));
  const [address, setAddress] = useState('');
  const [latText, setLatText] = useState(initialLat);
  const [lngText, setLngText] = useState(initialLng);
  const [submitted, setSubmitted] = useState(false);

  const lat = parseCoordInput(latText);
  const lng = parseCoordInput(lngText);
  const coordsValid =
    lat !== null &&
    lng !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;
  const canSubmit = name.trim().length > 0 && coordsValid && !submitted;

  const handleSubmit = useCallback(() => {
    if (!canSubmit || lat === null || lng === null) return;
    setSubmitted(true);

    const trimmedName = name.trim().slice(0, 200);
    const trimmedCity = city.trim();
    const trimmedAddress = address.trim();
    const entry = buildAddedPubEntry(
      {
        name: trimmedName,
        lat,
        lng,
        city: trimmedCity || undefined,
        address: trimmedAddress || undefined,
      },
      generateUuidV4(),
    );

    upsertLocalPub({
      id: pubIdForCoords(lat, lng),
      name: trimmedName,
      lat,
      lng,
      ...(trimmedCity ? { city: trimmedCity } : {}),
      ...(trimmedAddress ? { address: trimmedAddress } : {}),
      venueKind: 'pub',
    });
    bumpCatalogRevision();
    void clearPubsSnapshot();
    void enqueueAddedPub(entry);
    void fireSuccessHaptic();
    showToast(cs.addPub.savedToast);
    router.back();
  }, [address, bumpCatalogRevision, canSubmit, city, lat, lng, name, router, showToast]);

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

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
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

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{cs.addPub.nameLabel}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={cs.addPub.namePlaceholder}
              placeholderTextColor={Colors.mutedText}
              maxLength={200}
              accessibilityLabel={cs.a11y.addPubNameInput}
            />
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

          <View style={styles.coordCard}>
            <Text style={styles.coordHeader}>{cs.addPub.coordsHeader}</Text>
            <View style={styles.twoColumn}>
              <View style={styles.column}>
                <Text style={styles.label}>{cs.addPub.latLabel}</Text>
                <TextInput
                  style={styles.input}
                  value={latText}
                  onChangeText={setLatText}
                  placeholder="50.0812"
                  placeholderTextColor={Colors.mutedText}
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={cs.a11y.addPubLatInput}
                />
              </View>
              <View style={styles.column}>
                <Text style={styles.label}>{cs.addPub.lngLabel}</Text>
                <TextInput
                  style={styles.input}
                  value={lngText}
                  onChangeText={setLngText}
                  placeholder="14.4182"
                  placeholderTextColor={Colors.mutedText}
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={cs.a11y.addPubLngInput}
                />
              </View>
            </View>
            {!coordsValid && (
              <Text style={styles.invalidText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.addPub.invalidCoords}
              </Text>
            )}
          </View>

          <View style={styles.submitButton}>
            <GlowButton
              label={cs.addPub.save}
              onPress={handleSubmit}
              glow={canSubmit ? 'soft' : 'none'}
              accessibilityLabel={cs.a11y.addPubSaveButton}
            />
            {!canSubmit && <View style={styles.submitDisabledOverlay} />}
          </View>
        </ScrollView>
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
  coordCard: {
    gap: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: withAlpha(Colors.stout2, 0.78),
    padding: Spacing.lg,
  },
  coordHeader: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
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
