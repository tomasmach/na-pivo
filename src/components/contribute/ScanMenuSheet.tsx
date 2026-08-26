/**
 * ScanMenuSheet — source picker for AI menu scanning.
 *
 * Replaces a stock OS action sheet with a Brass Taproom bottom sheet: a stout
 * card spring-sliding over a dimmed scrim, two large tactile choices (snap a
 * photo / pick from the gallery). Each row scales on press and fires a light
 * haptic. Matches the shared compass sheet treatment so the app feels of one piece.
 *
 * Pure presentation: it reports the chosen source up; the parent owns the picker
 * + upload flow.
 */

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { CameraIcon, ImagesIcon } from '@/components/shared/IconGlyph';
import { BetaBadge } from '@/components/shared/BetaBadge';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { t } from '@/i18n';
import type { MenuPhotoSource } from '@/data/menuPhotoPicker';
import { MockLayout, MockType } from '@/mocks/mockTheme';

/** Single source of truth — the sheet emits exactly what the picker accepts. */
export type MenuScanSource = MenuPhotoSource;

interface ScanMenuSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (source: MenuScanSource) => void;
}

interface OptionRowProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}

function OptionRow({ icon, label, onPress, accessibilityLabel }: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.optionIcon}>{icon}</View>
      <Text style={styles.optionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
}

function ScanMenuSheetImpl({ visible, onClose, onPick }: ScanMenuSheetProps) {
  const insets = useSafeAreaInsets();

  const pick = (source: MenuScanSource) => {
    fireLightImpactHaptic();
    onPick(source);
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.handle} />

            <View style={styles.titleRow}>
              <View style={styles.titleLine}>
                <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {t.contribute.scanMenu.sheetTitle}
                </Text>
                <BetaBadge tone="amber" />
              </View>
              <CloseButton onPress={onClose} label={t.contribute.scanMenu.cancel} />
            </View>

            <View style={styles.options}>
              <OptionRow
                icon={<CameraIcon size={22} color={Colors.amber} />}
                label={t.contribute.scanMenu.camera}
                onPress={() => pick('camera')}
                accessibilityLabel={t.contribute.scanMenu.camera}
              />
              <OptionRow
                icon={<ImagesIcon size={22} color={Colors.amber} />}
                label={t.contribute.scanMenu.library}
                onPress={() => pick('library')}
                accessibilityLabel={t.contribute.scanMenu.library}
              />
            </View>
          </View>
      </View>
    </BottomSheetModal>
  );
}

export const ScanMenuSheet = memo(ScanMenuSheetImpl);

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
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    marginBottom: Spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  options: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 64,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  optionRowPressed: {
    transform: [{ scale: 0.98 }],
    borderColor: withAlpha(Colors.amber, 0.5),
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  optionIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  optionLabel: {
    flex: 1,
    fontWeight: '600',
    fontSize: 16,
    color: Colors.foam,
  },
});
