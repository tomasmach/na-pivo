/**
 * One modal used for three counter flows:
 *   • add a brand-new beer (name + price + volume),
 *   • prompt for a missing price on a menu beer (price + volume; name locked),
 *   • edit the price of a menu beer (price + volume; name locked).
 *
 * Mirrors the ContributeScreen beer-entry precedent: name max 80, number-pad
 * price digits-only 1..1000, volume pills 0,3 l / 0,4 l / 0,5 l / Jiné (custom ml).
 *
 * Keyboard handling: a React Native `Modal` hosts its own UIWindow, so
 * `KeyboardAvoidingView` measures the keyboard against the wrong window on iOS
 * and the lower inputs end up hidden behind the keyboard. Instead we track the
 * real keyboard height via `Keyboard` events and lift the bottom sheet above
 * it, capping it with `maxHeight` + an inner `ScrollView` so it always fits.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Keyboard,
  useWindowDimensions,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import type { CommunityBeer } from '@/data/communityHours';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  currencySuffix,
  formatPriceInputFromCzk,
  parsePriceInputToCzk,
  pricePlaceholder,
  sanitizePriceInput,
} from '@/utils/currency';

const VOLUME_SMALL = 300;
const VOLUME_MEDIUM = 400;
const VOLUME_DEFAULT = 500;
const VOLUME_PRESETS = [VOLUME_SMALL, VOLUME_MEDIUM, VOLUME_DEFAULT];

/** Sanitize a free-typed custom volume to a sane ml value (50..3000), else undefined. */
function parseCustomMl(text: string): number | undefined {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 50 || n > 3000) return undefined;
  return n;
}

/** Live keyboard height (0 when hidden). Reliable inside a Modal where KAV is not. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setHeight(0);
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return height;
}

export type BeerFormMode = 'add' | 'price' | 'edit';

export interface BeerFormResult {
  name: string;
  priceCzk: number;
  volumeMl?: number;
}

interface BeerFormModalProps {
  visible: boolean;
  mode: BeerFormMode;
  /** Prefilled beer (name locked in 'price'/'edit'; price/volume seed the form). */
  beer?: CommunityBeer | null;
  /** Changes per open so the form body remounts with fresh, prop-seeded state. */
  formKey?: string | number;
  onCancel: () => void;
  onSubmit: (result: BeerFormResult) => void;
}

const VOLUME_OPTIONS: { value: number; labelKey: 'volumeSmall' | 'volumeMedium' | 'volumeLarge' }[] = [
  { value: VOLUME_SMALL, labelKey: 'volumeSmall' },
  { value: VOLUME_MEDIUM, labelKey: 'volumeMedium' },
  { value: VOLUME_DEFAULT, labelKey: 'volumeLarge' },
];

/**
 * Outer shell: owns the RN Modal + visibility. The inner form body is keyed by
 * the open instance (`formKey`) so every open mounts a FRESH body whose state is
 * initialized from props — no re-seeding effect, no setState-in-effect.
 */
export function BeerFormModal({ visible, mode, beer, formKey, onCancel, onSubmit }: BeerFormModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      {visible ? (
        <BeerFormBody
          key={formKey ?? 0}
          mode={mode}
          beer={beer}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      ) : null}
    </Modal>
  );
}

interface BeerFormBodyProps {
  mode: BeerFormMode;
  beer?: CommunityBeer | null;
  onCancel: () => void;
  onSubmit: (result: BeerFormResult) => void;
}

function BeerFormBody({ mode, beer, onCancel, onSubmit }: BeerFormBodyProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const nameLocked = mode !== 'add';
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);

  // Initialized once at mount from props (the body is remounted per open).
  const [name, setName] = useState(beer?.name ?? '');
  const [priceText, setPriceText] = useState(
    typeof beer?.priceCzk === 'number' ? formatPriceInputFromCzk(beer.priceCzk, priceCurrency) : '',
  );

  // Volume: either a preset pill (300/400/500) or a free-typed custom ml ("Jiné").
  const seedVolume = beer?.volumeMl ?? (mode === 'add' ? VOLUME_DEFAULT : undefined);
  const seedIsPreset = typeof seedVolume === 'number' && VOLUME_PRESETS.includes(seedVolume);
  const [selectedPreset, setSelectedPreset] = useState<number | undefined>(seedIsPreset ? seedVolume : undefined);
  const [customActive, setCustomActive] = useState<boolean>(typeof seedVolume === 'number' && !seedIsPreset);
  const [customMl, setCustomMl] = useState<string>(
    typeof seedVolume === 'number' && !seedIsPreset ? String(seedVolume) : '',
  );

  const trimmedName = name.trim();
  const priceCzk = parsePriceInputToCzk(priceText, priceCurrency);
  const priceValid = priceCzk !== null;
  const nameValid = nameLocked || trimmedName.length > 0;
  const canSubmit = priceValid && nameValid;
  const placeholder = pricePlaceholder(priceCurrency);

  // The effective volume: custom ml when "Jiné" is active, otherwise the pill.
  // Volume stays optional — an empty/invalid custom field simply omits it.
  const volumeMl = customActive ? parseCustomMl(customMl) : selectedPreset;

  const title =
    mode === 'add' ? cs.counter.addModalTitle : mode === 'edit' ? cs.counter.editModalTitle : cs.counter.priceModalTitle;

  const submitLabel = mode === 'edit' ? cs.counter.confirmSave : cs.counter.confirmCount;

  const selectPreset = (value: number) => {
    setSelectedPreset(value);
    setCustomActive(false);
  };

  const selectCustom = () => {
    setCustomActive(true);
    setSelectedPreset(undefined);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const result: BeerFormResult = {
      name: nameLocked ? (beer?.name ?? '') : trimmedName.slice(0, 80),
      priceCzk: priceCzk as number,
    };
    if (typeof volumeMl === 'number') result.volumeMl = volumeMl;
    onSubmit(result);
  };

  // Lift the whole sheet above the keyboard; keep bottom padding for safe-area
  // comfort only. Padding the card by the keyboard height grows the hidden part
  // of the sheet instead of moving inputs into view inside a modal UIWindow.
  const sheetBottomOffset = keyboardHeight > 0 ? keyboardHeight : 0;
  const bottomPad = Math.max(insets.bottom, Spacing.lg);
  const maxHeight = windowHeight - insets.top - sheetBottomOffset - Spacing.lg;

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel={cs.counter.cancel} />
      <View style={[styles.card, { marginBottom: sheetBottomOffset, paddingBottom: bottomPad, maxHeight }]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.cardContent}
          bounces={false}
        >
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {title}
          </Text>

          {nameLocked && beer?.name ? (
            <Text style={styles.lockedName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
              {beer.name}
            </Text>
          ) : (
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder={cs.counter.beerNamePlaceholder}
              placeholderTextColor={Colors.mutedText}
              maxLength={80}
              autoFocus
              accessibilityLabel={cs.counter.beerNamePlaceholder}
            />
          )}

          <View style={styles.priceRow}>
            <TextInput
              style={styles.priceInput}
              value={priceText}
              onChangeText={(v) => setPriceText(sanitizePriceInput(v, priceCurrency))}
              placeholder={placeholder}
              placeholderTextColor={Colors.mutedText}
              keyboardType={priceCurrency === 'EUR' ? 'decimal-pad' : 'number-pad'}
              maxLength={priceCurrency === 'EUR' ? 6 : 4}
              autoFocus={nameLocked}
              accessibilityLabel={placeholder}
            />
            <Text style={styles.priceSuffix} maxFontSizeMultiplier={FontScaleCap.heading}>
              {currencySuffix(priceCurrency)}
            </Text>
          </View>

          <Text style={styles.volumeLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.counter.priceLabel}
          </Text>
          <View style={styles.volumeGroup}>
            {VOLUME_OPTIONS.map((opt) => {
              const isSelected = !customActive && selectedPreset === opt.value;
              return (
                <Pressable
                  key={opt.labelKey}
                  onPress={() => selectPreset(opt.value)}
                  style={[styles.volumePill, isSelected && styles.volumePillSelected]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={cs.counter[opt.labelKey]}
                >
                  <Text
                    style={[styles.volumePillText, isSelected && styles.volumePillTextSelected]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.counter[opt.labelKey]}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={selectCustom}
              style={[styles.volumePill, customActive && styles.volumePillSelected]}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ selected: customActive }}
              accessibilityLabel={cs.counter.volumeOther}
            >
              <Text
                style={[styles.volumePillText, customActive && styles.volumePillTextSelected]}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.counter.volumeOther}
              </Text>
            </Pressable>
          </View>

          {customActive && (
            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                value={customMl}
                onChangeText={(v) => setCustomMl(v.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder={cs.counter.volumeCustomPlaceholder}
                placeholderTextColor={Colors.mutedText}
                keyboardType="number-pad"
                maxLength={4}
                autoFocus
                accessibilityLabel={cs.counter.volumeCustomPlaceholder}
              />
              <Text style={styles.customSuffix} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.counter.volumeUnitMl}
              </Text>
            </View>
          )}

          <View style={styles.submitWrap}>
            <GlowButton
              label={submitLabel}
              onPress={handleSubmit}
              glow={canSubmit ? 'soft' : 'none'}
              accessibilityLabel={submitLabel}
            />
            {!canSubmit && <View style={styles.submitDisabledOverlay} pointerEvents="none" />}
          </View>

          <Pressable
            onPress={onCancel}
            style={styles.cancelButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.counter.cancel}
          >
            <Text style={styles.cancelText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.cancel}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.7),
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  cardContent: {
    gap: Spacing.md,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  lockedName: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.amber,
  },
  nameInput: {
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priceInput: {
    flex: 1,
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontFamily: Fonts.display.bold,
    fontSize: 22,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    textAlign: 'center',
  },
  priceSuffix: {
    fontFamily: Fonts.display.bold,
    fontSize: 22,
    color: Colors.foamMuted,
  },
  volumeLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
    marginBottom: -6,
  },
  volumeGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  volumePill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  volumePillSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  volumePillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  volumePillTextSelected: {
    color: Colors.stout,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customInput: {
    flex: 1,
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontFamily: Fonts.display.bold,
    fontSize: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    textAlign: 'center',
  },
  customSuffix: {
    fontFamily: Fonts.display.bold,
    fontSize: 20,
    color: Colors.foamMuted,
  },
  submitWrap: {
    position: 'relative',
    marginTop: Spacing.xs,
  },
  submitDisabledOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.stout,
    opacity: 0.5,
    borderRadius: Radius.pill,
  },
  cancelButton: {
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
  },
  cancelText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.mutedText,
  },
});
