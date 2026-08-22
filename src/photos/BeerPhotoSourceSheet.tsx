/**
 * BeerPhotoSourceSheet — camera-or-library picker for the beer photo diary.
 *
 * Structurally a sibling of ScanMenuSheet (contribute): a stout bottom card
 * spring-sliding over a dimmed scrim with two large tactile option rows. Pure
 * presentation — the parent owns the picker + compose flow, this only reports
 * the chosen source up.
 */

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { CameraIcon, ImagesIcon } from '@/components/shared/IconGlyph';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { cs } from '@/i18n/cs';
import type { BeerPhotoSource } from '@/data/beerPhotoPicker';
import { MockLayout, MockType } from '@/mocks/mockTheme';

interface BeerPhotoSourceSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (source: BeerPhotoSource) => void;
}

interface OptionRowProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}

function OptionRow({ icon, label, onPress }: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.optionIcon}>{icon}</View>
      <Text style={styles.optionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
}

function BeerPhotoSourceSheetImpl({ visible, onClose, onPick }: BeerPhotoSourceSheetProps) {
  const insets = useSafeAreaInsets();

  const pick = (source: BeerPhotoSource) => {
    fireLightImpactHaptic();
    onPick(source);
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.handle} />

            <View style={styles.titleRow}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.photoDiary.sheetTitle}
              </Text>
              <CloseButton onPress={onClose} label={cs.a11y.photoViewerClose} />
            </View>

            <View style={styles.options}>
              <OptionRow
                icon={<CameraIcon size={22} color={Colors.amber} />}
                label={cs.photoDiary.takePhoto}
                onPress={() => pick('camera')}
              />
              <OptionRow
                icon={<ImagesIcon size={22} color={Colors.amber} />}
                label={cs.photoDiary.pickFromLibrary}
                onPress={() => pick('library')}
              />
            </View>
          </View>
      </View>
    </BottomSheetModal>
  );
}

export const BeerPhotoSourceSheet = memo(BeerPhotoSourceSheetImpl);

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
