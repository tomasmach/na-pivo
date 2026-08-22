import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlusIcon } from '@/components/shared/IconGlyph';
import { CloseButton } from '@/components/shared/CloseButton';
import type { CommunityBeer } from '@/data/communityClient';
import { normalizeBeerName } from '@/data/communityHours';
import { cs, formatVolume } from '@/i18n/cs';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { MockLayout, MockType } from '@/mocks/mockTheme';
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
    <BottomSheetModal visible={visible} onClose={onClose}>
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.contribute.historicalBeersHeader}
              </Text>
              <CloseButton onPress={onClose} label={cs.contribute.closeSheet} />
            </View>

            <ScrollView
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
                    accessibilityLabel={cs.a11y.contributeRestoreHistoricalBeer(beer.name)}
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
            </ScrollView>
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
    gap: 12,
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
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
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  rowMeta: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.6,
  },
});
