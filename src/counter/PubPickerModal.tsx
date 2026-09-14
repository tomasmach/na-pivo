/**
 * "Where are you?" picker — a bottom-sheet list of the nearest pubs with
 * distances, used when GPS auto-detect is wrong or the user wants to switch
 * pubs, plus the "Mimo hospodu" section (home / outdoors / elsewhere) and the
 * quiet recovery rows (retry detection, add a missing pub). Design rule it
 * enforces: this sheet is the ONE place a lost user recovers — the counter
 * screen itself never shows a "detecting" or "no pub" full screen.
 */

import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import {
  HouseIcon,
  MapPinIcon,
  MapPinPlusIcon,
  RefreshCwIcon,
  TreePineIcon,
} from '@/components/shared/IconGlyph';
import { formatDistanceCs } from '@/compass/distance';
import { t } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
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
  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.counter.pickerTitle}
            </Text>
            <CloseButton onPress={onClose} label={t.a11y.counterCloseModal} />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {candidates.length > 0 ? (
              <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.counter.pickerNearbyHeader}
              </Text>
            ) : null}
            {candidates.map((candidate, index) => {
              const isSelected = candidate.pubKey === selectedKey;
              const distance = formatDistanceCs(candidate.distanceMeters);
              return (
                <Pressable
                  key={candidate.pubKey}
                  onPress={() => onSelect(candidate.pub)}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={t.a11y.counterPickPub(candidate.pub.name, distance)}
                >
                  <MapPinIcon size={18} color={Colors.amber} />
                  <Text
                    style={[styles.rowName, isSelected && styles.rowNameSelected]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {candidate.pub.name}
                  </Text>
                  <Text style={styles.rowDistance} maxFontSizeMultiplier={FontScaleCap.body}>
                    {distance}
                  </Text>
                </Pressable>
              );
            })}
            {onRetry ? (
              <Pressable
                onPress={onRetry}
                style={({ pressed }) => [
                  styles.quietRow,
                  candidates.length > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t.a11y.counterRetry}
              >
                <RefreshCwIcon size={18} color={Colors.foamMuted} />
                <Text
                  style={styles.quietRowLabel}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {t.counter.retry}
                </Text>
              </Pressable>
            ) : null}

            {onSelectOutside ? (
              <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.counter.pickerOutsideHeader}
              </Text>
            ) : null}
            {onSelectOutside
              ? OUTSIDE_PLACE_CONTEXTS.map((context, index) => {
                  const isSelected = contextPubKey(context) === selectedKey;
                  const Icon = OUTSIDE_ICONS[context];
                  const label = t.counter.outsideLabel(context);
                  return (
                    <Pressable
                      key={context}
                      onPress={() => onSelectOutside(context)}
                      style={({ pressed }) => [
                        styles.row,
                        index > 0 && styles.rowDivider,
                        pressed && styles.rowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={label}
                    >
                      <Icon size={18} color={Colors.amber} />
                      <Text
                        style={[styles.rowName, isSelected && styles.rowNameSelected]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })
              : null}

            {onAddPub ? (
              <Pressable
                onPress={onAddPub}
                style={({ pressed }) => [
                  styles.quietRow,
                  styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t.counter.noPubAddPub}
              >
                <MapPinPlusIcon size={18} color={Colors.foamMuted} />
                <Text
                  style={styles.quietRowLabel}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {t.counter.noPubAddPub}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
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
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  sectionHeader: {
    ...MockType.titleS,
    color: Colors.foam,
    marginTop: Spacing.xs,
    marginBottom: 2,
    marginLeft: 4,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm + 2,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowPressed: {
    opacity: 0.65,
  },
  rowName: {
    flex: 1,
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
  },
  rowNameSelected: {
    color: Colors.amber,
  },
  rowDistance: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
  },
  // Recovery rows: same shape as a pub row but visually quiet — no fill, no
  // amber, muted label — so they read as escape hatches, not destinations.
  quietRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm + 2,
  },
  quietRowLabel: {
    flex: 1,
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foamMuted,
  },
});
