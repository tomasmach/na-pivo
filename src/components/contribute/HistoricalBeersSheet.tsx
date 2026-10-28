import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { BottomSheetScrollView } from '@/components/shared/BottomSheetScrollView';
import { PlusIcon, XIcon } from '@/components/shared/IconGlyph';
import type { CommunityBeer } from '@/data/communityClient';
import { normalizeBeerName } from '@/data/communityHours';
import { formatVolume, t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { formatPrice, type PriceCurrency } from '@/utils/currency';

interface HistoricalBeersSheetProps {
  visible: boolean;
  beers: CommunityBeer[];
  priceCurrency: PriceCurrency;
  canRestore: boolean;
  onRestore: (beer: CommunityBeer) => void;
  onClose: () => void;
}

export function HistoricalBeersSheet({
  visible,
  beers,
  priceCurrency,
  canRestore,
  onRestore,
  onClose,
}: HistoricalBeersSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onClose} underlayColor={styles.card.backgroundColor}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <Pressable
          style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
          onPress={() => undefined}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.contribute.historicalBeersHeader}
              </Text>
              <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.contribute.historicalBeersHint}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.contribute.closeSheet}
            >
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <BottomSheetScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {beers.map((beer, index) => {
              const meta = [
                beer.volumeMl ? formatVolume(beer.volumeMl) : null,
                typeof beer.priceCzk === 'number'
                  ? formatPrice(beer.priceCzk, priceCurrency)
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Pressable
                  key={`${normalizeBeerName(beer.name)}:${beer.volumeMl ?? ''}`}
                  onPress={() => onRestore(beer)}
                  disabled={!canRestore}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowDivider,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canRestore }}
                  accessibilityLabel={t.a11y.contributeRestoreHistoricalBeer(beer.name)}
                >
                  <View style={styles.rowCopy}>
                    <Text
                      style={styles.rowName}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {beer.name}
                    </Text>
                    {meta ? (
                      <Text
                        style={styles.rowMeta}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                  <PlusIcon
                    size={16}
                    color={canRestore ? Colors.amber : Colors.mutedText}
                  />
                </Pressable>
              );
            })}
          </BottomSheetScrollView>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    minHeight: '44%',
    maxHeight: '92%',
  },
  card: {
    flex: 1,
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
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: Spacing.sm,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  closeButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  rowMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.6,
  },
});
