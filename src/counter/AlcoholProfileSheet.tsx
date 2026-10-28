/**
 * The body numbers the blood alcohol estimate needs. Opens on first use and from
 * "Upravit" in the estimate sheet. Saving is also the user's acknowledgement
 * that the result is only a guess, so the warning sits right above the button.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { GlowButton } from '@/components/shared/GlowButton';
import { InfoIcon, XIcon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { BODY_LIMITS, isBodyValueValid, type BodyProfile, type BodySex } from '@/drinks/alcoholEstimate';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

type NumberField = keyof typeof BODY_LIMITS;

const FIELDS: { key: NumberField; label: () => string; unit: () => string; missing: () => string }[] = [
  { key: 'age', label: () => t.alcohol.ageLabel, unit: () => t.alcohol.ageUnit, missing: () => t.alcohol.missingAge },
  {
    key: 'heightCm',
    label: () => t.alcohol.heightLabel,
    unit: () => t.alcohol.heightUnit,
    missing: () => t.alcohol.missingHeight,
  },
  {
    key: 'weightKg',
    label: () => t.alcohol.weightLabel,
    unit: () => t.alcohol.weightUnit,
    missing: () => t.alcohol.missingWeight,
  },
];

type Draft = Record<NumberField, string>;

function draftFrom(profile: BodyProfile | null): Draft {
  return {
    age: profile ? String(profile.age) : '',
    heightCm: profile ? String(profile.heightCm) : '',
    weightKg: profile ? String(profile.weightKg) : '',
  };
}

export interface AlcoholProfileSheetProps {
  visible: boolean;
  profile: BodyProfile | null;
  onSave: (profile: BodyProfile) => void;
  onClose: () => void;
}

export function AlcoholProfileSheet({ visible, profile, onSave, onClose }: AlcoholProfileSheetProps) {
  const insets = useSafeAreaInsets();
  const [sex, setSex] = useState<BodySex | null>(profile?.sex ?? null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(profile));
  const [touched, setTouched] = useState<Record<NumberField, boolean>>({
    age: false,
    heightCm: false,
    weightKg: false,
  });

  // Every opening starts from what is saved, so a cancelled edit leaves no trace.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setSex(profile?.sex ?? null);
      setDraft(draftFrom(profile));
      setTouched({ age: false, heightCm: false, weightKg: false });
    }
  }

  const values = {
    age: Number(draft.age),
    heightCm: Number(draft.heightCm),
    weightKg: Number(draft.weightKg),
  };
  const invalid = (key: NumberField) => draft[key] !== '' && !isBodyValueValid(key, values[key]);
  const firstMissing = sex === null ? t.alcohol.missingSex : FIELDS.find((f) => draft[f.key] === '')?.missing();
  const firstInvalid = FIELDS.find((f) => invalid(f.key));
  const blocker =
    firstMissing ??
    (firstInvalid
      ? t.alcohol.fixField(
          firstInvalid.label(),
          BODY_LIMITS[firstInvalid.key].min,
          BODY_LIMITS[firstInvalid.key].max,
        )
      : undefined);

  const save = () => {
    if (blocker || sex === null) return;
    onSave({ sex, ...values });
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose} underlayColor={styles.card.backgroundColor}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.alcohol.title}
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.counterCloseModal}
            >
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <KeyboardAwareScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.lead} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.alcohol.setupLead}
            </Text>

            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.alcohol.sexLabel}
            </Text>
            <View style={styles.sexGroup} accessibilityRole="radiogroup">
              {(['male', 'female'] as const).map((option) => {
                const selected = sex === option;
                return (
                  <Pressable
                    key={option}
                    testID={`alcohol-sex-${option}`}
                    onPress={() => setSex(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[styles.sexPill, selected && styles.sexPillSelected]}
                  >
                    <Text
                      style={[styles.sexLabel, selected && styles.sexLabelSelected]}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {option === 'male' ? t.alcohol.male : t.alcohol.female}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.fields}>
              {FIELDS.map((field) => {
                const showError = touched[field.key] && invalid(field.key);
                const { min, max } = BODY_LIMITS[field.key];
                return (
                  <View key={field.key} style={styles.field}>
                    <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
                      {field.label()}
                    </Text>
                    <View style={[styles.inputRow, showError && styles.inputRowError]}>
                      <TextInput
                        testID={`alcohol-${field.key}`}
                        style={styles.input}
                        value={draft[field.key]}
                        onChangeText={(text) =>
                          setDraft((d) => ({ ...d, [field.key]: text.replace(/[^0-9]/g, '').slice(0, 3) }))
                        }
                        onBlur={() => setTouched((s) => ({ ...s, [field.key]: true }))}
                        keyboardType="number-pad"
                        maxLength={3}
                        accessibilityLabel={field.label()}
                        maxFontSizeMultiplier={FontScaleCap.heading}
                      />
                      <Text style={styles.unit} maxFontSizeMultiplier={FontScaleCap.body}>
                        {field.unit()}
                      </Text>
                    </View>
                    {showError ? (
                      <Text style={styles.error} maxFontSizeMultiplier={FontScaleCap.body}>
                        {t.alcohol.outOfRange(min, max)}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <Text style={styles.note} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.alcohol.privacyNote}
            </Text>

            <View style={styles.warning}>
              <InfoIcon size={18} color={Colors.foamMuted} />
              <Text style={styles.warningText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.alcohol.setupWarning}
              </Text>
            </View>

            <View style={styles.footer}>
              <GlowButton
                testID="alcohol-profile-save"
                label={blocker ?? t.alcohol.save}
                glow="none"
                disabled={blocker !== undefined}
                onPress={save}
              />
            </View>
          </KeyboardAwareScrollView>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  scroll: {
    flexGrow: 0,
  },
  lead: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
  },
  label: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
    marginBottom: 6,
  },
  sexGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  sexPill: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sexPillSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  sexLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
  sexLabelSelected: {
    color: Colors.stout,
  },
  fields: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Spacing.md,
  },
  field: {
    flex: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 12,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.small,
  },
  inputRowError: {
    borderColor: Colors.amber,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    fontFamily: Fonts.display.bold,
    fontSize: 20,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  error: {
    marginTop: 4,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.amber,
  },
  note: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.stout3,
    borderRadius: Radius.medium,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  warningText: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  footer: {
    marginTop: Spacing.lg,
  },
});
