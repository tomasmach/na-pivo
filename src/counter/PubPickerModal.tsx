/**
 * "Where are you?" picker — a bottom-sheet list of the nearest pubs with
 * distances, used when GPS auto-detect is wrong or the user wants to switch
 * pubs, plus the "Mimo hospodu" section (home / outdoors / elsewhere) and the
 * quiet recovery rows (retry detection, add a missing pub). Design rule it
 * enforces: this sheet is the ONE place a lost user recovers — the counter
 * screen itself never shows a "detecting" or "no pub" full screen.
 */

import React, { useEffect } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import {
  HouseIcon,
  MapPinIcon,
  MapPinPlusIcon,
  RefreshCwIcon,
  TreePineIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { formatDistanceCs } from '@/compass/distance';
import { cs } from '@/i18n/cs';
import type { Pub } from '@/data/pubs';
import type { NearbyCandidate } from '@/counter/useNearbyPub';
import {
  OUTSIDE_PLACE_CONTEXTS,
  contextPubKey,
  type OutsidePlaceContext,
} from '@/drinks/drinkTypes';

const OUTSIDE_ICONS: Record<OutsidePlaceContext, typeof HouseIcon> = {
  private: HouseIcon,
  outdoors: TreePineIcon,
  other: MapPinIcon,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PubPickerModalProps {
  visible: boolean;
  candidates: NearbyCandidate[];
  /** Selected pubKey — a geohash cell, or a `ctx:*` key for an outside choice. */
  selectedKey: string | null;
  onSelect: (pub: Pub) => void;
  /** Pick one of the "Mimo hospodu" contexts instead of a pub. When omitted
   *  (e.g. the photo compose pub tagger) the outside section doesn't render. */
  onSelectOutside?: (context: OutsidePlaceContext) => void;
  /** Re-run pub detection; renders a quiet row at the end of the nearby section. */
  onRetry?: () => void;
  /** Open the add-pub flow; renders a quiet row at the very end of the sheet. */
  onAddPub?: () => void;
  onClose: () => void;
}

export function PubPickerModal({
  visible,
  candidates,
  selectedKey,
  onSelect,
  onSelectOutside,
  onRetry,
  onAddPub,
  onClose,
}: PubPickerModalProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const genericOutsideSelected = contextPubKey('other') === selectedKey;

  // One-shot slide-up on open; no motion at all under reduced motion.
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = reduceMotion
        ? withTiming(1, { duration: 0 })
        : withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 });
    } else {
      progress.value = 0;
    }
  }, [visible, reduceMotion, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={cs.a11y.counterCloseModal}>
        {/* The card swallows presses so a row tap never falls through to the backdrop. */}
        <AnimatedPressable
          style={[styles.card, cardAnim, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
          onPress={() => undefined}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.counter.pickerTitle}
            </Text>
            <View style={styles.headerActions}>
              {onSelectOutside ? (
                <Pressable
                  onPress={() => onSelectOutside('other')}
                  style={({ pressed }) => [
                    styles.outsideButton,
                    genericOutsideSelected && styles.outsideButtonSelected,
                    pressed && styles.rowPressed,
                  ]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityState={{ selected: genericOutsideSelected }}
                  accessibilityLabel={cs.counter.outsideLabel('other')}
                >
                  <HouseIcon size={16} color={genericOutsideSelected ? Colors.stout : Colors.amber} />
                  <Text
                    style={[styles.outsideButtonText, genericOutsideSelected && styles.outsideButtonTextSelected]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.counter.outsideLabel('other')}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {candidates.length > 0 ? (
              <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.pickerNearbyHeader}
              </Text>
            ) : null}
            {candidates.map((candidate) => {
              const isSelected = candidate.pubKey === selectedKey;
              const distance = formatDistanceCs(candidate.distanceMeters);
              return (
                <Pressable
                  key={candidate.pubKey}
                  onPress={() => onSelect(candidate.pub)}
                  style={({ pressed }) => [
                    styles.row,
                    isSelected && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={cs.a11y.counterPickPub(candidate.pub.name, distance)}
                >
                  <MapPinIcon size={18} color={isSelected ? Colors.stout : Colors.amber} />
                  <Text
                    style={[styles.rowName, isSelected && styles.rowNameSelected]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {candidate.pub.name}
                  </Text>
                  <Text
                    style={[styles.rowDistance, isSelected && styles.rowDistanceSelected]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {distance}
                  </Text>
                </Pressable>
              );
            })}
            {onRetry ? (
              <Pressable
                onPress={onRetry}
                style={({ pressed }) => [styles.quietRow, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterRetry}
              >
                <RefreshCwIcon size={18} color={Colors.foamMuted} />
                <Text style={styles.quietRowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.counter.retry}
                </Text>
              </Pressable>
            ) : null}

            {onSelectOutside ? (
              <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.pickerOutsideHeader}
              </Text>
            ) : null}
            {onSelectOutside ? OUTSIDE_PLACE_CONTEXTS.filter((context) => context !== 'other').map((context) => {
              const isSelected = contextPubKey(context) === selectedKey;
              const Icon = OUTSIDE_ICONS[context];
              const label = cs.counter.outsideLabel(context);
              return (
                <Pressable
                  key={context}
                  onPress={() => onSelectOutside(context)}
                  style={({ pressed }) => [
                    styles.row,
                    isSelected && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={label}
                >
                  <Icon size={18} color={isSelected ? Colors.stout : Colors.amber} />
                  <Text
                    style={[styles.rowName, isSelected && styles.rowNameSelected]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            }) : null}

            {onAddPub ? (
              <Pressable
                onPress={onAddPub}
                style={({ pressed }) => [styles.quietRow, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.counter.noPubAddPub}
              >
                <MapPinPlusIcon size={18} color={Colors.foamMuted} />
                <Text style={styles.quietRowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.counter.noPubAddPub}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </AnimatedPressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    maxHeight: '80%',
    ...softDrop(),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  outsideButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  outsideButtonSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  outsideButtonText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foam,
  },
  outsideButtonTextSelected: {
    color: Colors.stout,
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
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 8,
    paddingBottom: Spacing.sm,
  },
  sectionHeader: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.mutedText,
    marginTop: Spacing.xs,
    marginBottom: 2,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  rowPressed: {
    opacity: 0.8,
  },
  rowName: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  rowNameSelected: {
    color: Colors.stout,
  },
  rowDistance: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  rowDistanceSelected: {
    color: Colors.stout,
  },
  // Recovery rows: same shape as a pub row but visually quiet — no fill, no
  // amber, muted label — so they read as escape hatches, not destinations.
  quietRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quietRowLabel: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
});
