import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerIcon, CircleDotIcon, GlassWaterIcon, XIcon } from '@/components/shared/IconGlyph';
import type { ScannedDrink } from '@/data/menuScanClient';
import { cs, formatVolume } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
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
  return <CircleDotIcon size={19} color={Colors.amber} />;
}

export function ScannedDrinkPicker({ visible, drinks, priceCurrency, onClose, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.counter.scanDrinksTitle}
              </Text>
              <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.scanDrinksHint}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={cs.counter.cancel}
            >
              <XIcon size={18} color={Colors.mutedText} />
            </Pressable>
          </View>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {drinks.map((drink, index) => {
              const meta = [
                cs.counter.drinkTypeLabel(drink.drinkType),
                typeof drink.priceCzk === 'number' ? formatPrice(drink.priceCzk, priceCurrency) : null,
                typeof drink.volumeMl === 'number' ? formatVolume(drink.volumeMl) : null,
              ].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={`${drink.drinkType}|${drink.name}|${drink.volumeMl ?? ''}|${index}`}
                  onPress={() => onSelect(drink)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${drink.name}, ${meta}`}
                >
                  <View style={styles.icon}><TypeIcon drink={drink} /></View>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {drink.name}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {meta}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.72) },
  card: {
    maxHeight: '76%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginBottom: Spacing.md },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.display.extrabold, fontSize: 24, color: Colors.foam },
  hint: { marginTop: 4, fontFamily: Fonts.ui.regular, fontSize: 14, lineHeight: 20, color: Colors.mutedText },
  close: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 0 },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowPressed: { opacity: 0.68 },
  icon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  rowText: { flex: 1 },
  name: { fontFamily: Fonts.ui.semibold, fontSize: 16, color: Colors.foam },
  meta: { marginTop: 2, fontFamily: Fonts.ui.regular, fontSize: 13, color: Colors.mutedText },
});
