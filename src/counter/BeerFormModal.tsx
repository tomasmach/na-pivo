/**
 * One modal used for three counter flows:
 *   • add a brand-new beer (name + price + volume),
 *   • prompt for a missing price on a menu beer (price + volume; name locked),
 *   • edit the price of a menu beer (price + volume; name locked).
 *
 * Mirrors the ContributeScreen beer-entry precedent: name max 80, number-pad
 * price digits-only 1..1000, volume pills 0,3 l / 0,5 l / Jiné.
 */

import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import type { CommunityBeer } from '@/data/communityHours';

const VOLUME_SMALL = 300;
const VOLUME_DEFAULT = 500;

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

const VOLUME_OPTIONS: { value: number | undefined; labelKey: 'volumeSmall' | 'volumeLarge' | 'volumeOther' }[] = [
  { value: VOLUME_SMALL, labelKey: 'volumeSmall' },
  { value: VOLUME_DEFAULT, labelKey: 'volumeLarge' },
  { value: undefined, labelKey: 'volumeOther' },
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
  const nameLocked = mode !== 'add';

  // Initialized once at mount from props (the body is remounted per open).
  const [name, setName] = useState(beer?.name ?? '');
  const [priceText, setPriceText] = useState(
    typeof beer?.priceCzk === 'number' ? String(beer.priceCzk) : '',
  );
  const [volumeMl, setVolumeMl] = useState<number | undefined>(
    beer?.volumeMl ?? (mode === 'add' ? VOLUME_DEFAULT : beer?.volumeMl),
  );

  const trimmedName = name.trim();
  const price = Number(priceText);
  const priceValid = priceText.trim() !== '' && Number.isFinite(price) && price >= 1 && price <= 1000;
  const nameValid = nameLocked || trimmedName.length > 0;
  const canSubmit = priceValid && nameValid;

  const title =
    mode === 'add' ? cs.counter.addModalTitle : mode === 'edit' ? cs.counter.editModalTitle : cs.counter.priceModalTitle;

  const submitLabel = mode === 'edit' ? cs.counter.confirmSave : cs.counter.confirmCount;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const result: BeerFormResult = {
      name: nameLocked ? (beer?.name ?? '') : trimmedName.slice(0, 80),
      priceCzk: Math.round(price),
    };
    if (typeof volumeMl === 'number') result.volumeMl = volumeMl;
    onSubmit(result);
  };

  return (
    <View style={styles.backdrop}>
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
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
              onChangeText={(v) => setPriceText(v.replace(/\D/g, '').slice(0, 4))}
              placeholder={cs.counter.pricePlaceholder}
              placeholderTextColor={Colors.mutedText}
              keyboardType="number-pad"
              maxLength={4}
              autoFocus={nameLocked}
              accessibilityLabel={cs.counter.pricePlaceholder}
            />
            <Text style={styles.priceSuffix} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.counter.currencySuffix}
            </Text>
          </View>

          <Text style={styles.volumeLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.counter.priceLabel}
          </Text>
          <View style={styles.volumeGroup}>
            {VOLUME_OPTIONS.map((opt) => {
              const isSelected = volumeMl === opt.value;
              return (
                <Pressable
                  key={opt.labelKey}
                  onPress={() => setVolumeMl(opt.value)}
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
          </View>

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
