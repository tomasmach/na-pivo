import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { BeerIcon, CircleDotIcon, GlassWaterIcon, WineIcon } from '@/components/shared/IconGlyph';
import type { ScannedDrink } from '@/data/menuScanClient';
import { cs, formatVolume } from '@/i18n/cs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { formatPrice, type PriceCurrency } from '@/utils/currency';

interface Props {
  visible: boolean;
  drinks: ScannedDrink[];
  priceCurrency: PriceCurrency;
  onClose: () => void;
  onSelect: (drink: ScannedDrink) => void;
}

function TypeIcon({ drink }: { drink: ScannedDrink }) {
  if (drink.drinkType === 'beer') return <BeerIcon size={19} color={Colors.amber} />;
  if (drink.drinkType === 'soft_drink') return <GlassWaterIcon size={19} color={Colors.amber} />;
  if (drink.drinkType === 'wine') return <WineIcon size={19} color={Colors.amber} />;
  return <CircleDotIcon size={19} color={Colors.amber} />;
}

export function ScannedDrinkPicker({ visible, drinks, priceCurrency, onClose, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.counter.scanDrinksTitle}
            </Text>
            <CloseButton onPress={onClose} label={cs.counter.cancel} />
          </View>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {drinks.map((drink, index) => {
              const meta = [
                cs.counter.drinkTypeLabel(drink.drinkType),
                typeof drink.priceCzk === 'number'
                  ? formatPrice(drink.priceCzk, priceCurrency)
                  : null,
                typeof drink.volumeMl === 'number' ? formatVolume(drink.volumeMl) : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Pressable
                  key={`${drink.drinkType}|${drink.name}|${drink.volumeMl ?? ''}|${index}`}
                  onPress={() => onSelect(drink)}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowBorder,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${drink.name}, ${meta}`}
                >
                  <View style={styles.icon}>
                    <TypeIcon drink={drink} />
                  </View>
                  <View style={styles.rowText}>
                    <Text
                      style={styles.name}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {drink.name}
                    </Text>
                    <Text
                      style={styles.meta}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {meta}
                    </Text>
                  </View>
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
    alignItems: 'flex-start',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  title: { flex: 1, ...MockType.titleS, color: Colors.foam },
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowPressed: { opacity: 0.65 },
  icon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  rowText: { flex: 1 },
  name: { fontWeight: '600', fontSize: 16, color: Colors.foam },
  meta: {
    marginTop: 2,
    fontWeight: '400',
    fontSize: 13,
    color: Colors.mutedText,
  },
});
