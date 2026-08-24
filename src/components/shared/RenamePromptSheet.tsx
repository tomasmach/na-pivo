import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

interface RenamePromptSheetProps {
  visible: boolean;
  title: string;
  value: string;
  placeholder: string;
  inputLabel: string;
  cancelLabel: string;
  saveLabel: string;
  savingLabel?: string;
  submitting?: boolean;
  maxLength?: number;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RenamePromptSheet({
  visible,
  title,
  value,
  placeholder,
  inputLabel,
  cancelLabel,
  saveLabel,
  savingLabel,
  submitting = false,
  maxLength = 200,
  canSubmit,
  onChange,
  onCancel,
  onSubmit,
}: RenamePromptSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onCancel} keyboardLift>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {title}
            </Text>
            <CloseButton onPress={onCancel} label={cancelLabel} />
          </View>

          <TextInput
            value={value}
            onChangeText={onChange}
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor={MockColors.fieldHint}
            maxLength={maxLength}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSubmit) onSubmit();
            }}
            accessibilityLabel={inputLabel}
          />

          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.primaryButton,
              !canSubmit && styles.primaryDisabled,
              pressed && canSubmit && styles.primaryPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={saveLabel}
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {submitting && savingLabel ? savingLabel : saveLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: MockLayout.controlGap,
  },
  title: { flex: 1, ...MockType.titleS, color: Colors.foam },
  input: {
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.38),
    backgroundColor: Colors.stout3,
    paddingHorizontal: Spacing.md,
    fontWeight: '500',
    fontSize: 17,
    color: Colors.foam,
  },
  primaryButton: {
    minHeight: 56,
    marginTop: Spacing.lg,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.amber,
  },
  primaryDisabled: { opacity: 0.42 },
  primaryPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  primaryText: { ...MockType.buttonLabel, color: Colors.stout },
});
