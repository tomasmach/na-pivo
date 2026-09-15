/**
 * BeerPhotoSourceSheet — camera-or-library picker for the beer photo diary.
 *
 * Structurally a sibling of ScanMenuSheet (contribute): a stout bottom card
 * spring-sliding over a dimmed scrim with two large tactile option rows. Pure
 * presentation — the parent owns the picker + compose flow, this only reports
 * the chosen source up.
 */

import React, { memo, useEffect } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { BeerIcon, CameraIcon, ImagesIcon, XIcon } from '@/components/shared/IconGlyph';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { cs } from '@/i18n/cs';
import type { BeerPhotoSource } from '@/data/beerPhotoPicker';

interface BeerPhotoSourceSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (source: BeerPhotoSource) => void;
}

interface OptionRowProps {
  icon: React.ReactNode;
  label: string;
  helper: string;
  onPress: () => void;
}

function OptionRow({ icon, label, helper, onPress }: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.optionIcon}>{icon}</View>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {label}
        </Text>
        <Text style={styles.optionHelper} maxFontSizeMultiplier={FontScaleCap.body}>
          {helper}
        </Text>
      </View>
    </Pressable>
  );
}

function BeerPhotoSourceSheetImpl({ visible, onClose, onPick }: BeerPhotoSourceSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  // Spring the card up over the scrim (Reanimated shared value — not React state).
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = reduceMotion
        ? withTiming(1, { duration: 0 })
        : withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : 140 });
    }
  }, [visible, reduceMotion, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  const pick = (source: BeerPhotoSource) => {
    fireLightImpactHaptic();
    onPick(source);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        {/* Stop backdrop dismissal when tapping inside the card */}
        <Pressable onPress={() => undefined}>
          <Animated.View
            style={[
              styles.card,
              softDrop(),
              { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
              cardAnim,
            ]}
          >
            <View style={styles.handle} />

            <View style={styles.titleRow}>
              <View style={styles.titleTextWrap}>
                <View style={styles.titleLine}>
                  <BeerIcon size={18} color={Colors.amber} />
                  <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.photoDiary.sheetTitle}
                  </Text>
                </View>
                <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.photoDiary.sheetSubtitle}
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.photoViewerClose}
              >
                <XIcon size={18} color={Colors.foamMuted} />
              </Pressable>
            </View>

            <View style={styles.options}>
              <OptionRow
                icon={<CameraIcon size={22} color={Colors.amber} />}
                label={cs.photoDiary.takePhoto}
                helper={cs.photoDiary.cameraHelper}
                onPress={() => pick('camera')}
              />
              <OptionRow
                icon={<ImagesIcon size={22} color={Colors.amber} />}
                label={cs.photoDiary.pickFromLibrary}
                helper={cs.photoDiary.libraryHelper}
                onPress={() => pick('library')}
              />
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const BeerPhotoSourceSheet = memo(BeerPhotoSourceSheetImpl);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  titleTextWrap: {
    flex: 1,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 4,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  closeBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Spacing.xs,
    marginTop: -Spacing.xs,
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
  optionText: {
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 16,
    color: Colors.foam,
  },
  optionHelper: {
    marginTop: 2,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
  },
});
