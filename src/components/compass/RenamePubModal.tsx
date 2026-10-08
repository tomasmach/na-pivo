/**
 * The "Opravit název" dialog: one field, cancel and save. The host owns the
 * draft and the submit, so the compass and the pub page share one look.
 */

import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PencilIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

export interface RenamePubModalProps {
  visible: boolean;
  currentName: string;
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RenamePubModal({
  visible,
  currentName,
  value,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: RenamePubModalProps) {
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName.trim() && !submitting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.renameOverlay}
      >
        <Pressable style={styles.renameScrim} onPress={onCancel} />
        <View style={styles.renamePanel}>
          <View style={styles.renameIconWell}>
            <PencilIcon size={19} color={Colors.amber} />
          </View>
          <Text style={styles.renameTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.compass.renameTitle}
          </Text>
          <Text style={styles.renameBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.compass.renameBody(currentName)}
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            style={styles.renameInput}
            placeholder={t.compass.renamePlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={200}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSubmit) onSubmit();
            }}
            accessibilityLabel={t.a11y.renamePubInput}
          />
          <View style={styles.renameActions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.renameSecondaryButton, pressed && { opacity: 0.72 }]}
              accessibilityRole="button"
              accessibilityLabel={t.common.cancel}
            >
              <Text style={styles.renameSecondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.common.cancel}
              </Text>
            </Pressable>
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.renamePrimaryButton,
                !canSubmit && styles.renamePrimaryDisabled,
                pressed && canSubmit && { opacity: 0.86, transform: [{ scale: 0.98 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.renamePubSaveButton}
            >
              <Text style={styles.renamePrimaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {submitting ? t.compass.renameSaving : t.compass.renameSave}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  renameOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  renameScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(Colors.black, 0.58),
  },
  renamePanel: {
    marginHorizontal: 14,
    marginBottom: 14,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    backgroundColor: Colors.stout2,
    padding: 20,
    gap: 14,
  },
  renameIconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.07),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  renameTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 30,
    color: Colors.foam,
  },
  renameBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  renameInput: {
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.38),
    backgroundColor: Colors.stout3,
    paddingHorizontal: 14,
    fontFamily: Fonts.ui.medium,
    fontSize: 17,
    color: Colors.foam,
  },
  renameActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  renameSecondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: withAlpha(Colors.stout, 0.42),
  },
  renameSecondaryText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
  renamePrimaryButton: {
    flex: 1.35,
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  renamePrimaryDisabled: {
    opacity: 0.42,
  },
  renamePrimaryText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 16,
    color: Colors.stout,
  },
});
