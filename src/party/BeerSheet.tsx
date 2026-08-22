/**
 * DESIGN MOCK — the running order, as a sheet.
 *
 * It was a tab in the hub, which put a bar tab next to "Statistiky" and "Log" as
 * if it were a third way of looking at the night. It is not a view of anything —
 * it is the thing the "+1 pivo" button writes into. So it lives one tap behind
 * that button, under the chip naming what you are currently drinking.
 *
 * Presented rather than pushed because it is a correction: you came here to fix
 * a count or switch taps, and you want to be back at the table immediately.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';

import { BeerList } from '@/party/BeerList';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

export function BeerSheet({
  visible,
  rows,
  onTaps,
  title = 'Co piješ',
  subtitle = 'Uprav počty nebo si dej něco jiného.',
  onClose,
  onAdd,
}: {
  title?: string;
  subtitle?: string;
  visible: boolean;
  rows: { beer: string; count: number }[];
  onTaps: { name: string; priceCzk: number | null }[];
  onClose: () => void;
  onAdd: (beer: string) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.grow}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {title}
              </Text>
              <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
                {subtitle}
              </Text>
            </View>
            <CloseButton onPress={onClose} />
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            <BeerList rows={rows} onTaps={onTaps} onAdd={onAdd} />
          </ScrollView>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
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
    paddingBottom: Spacing.sm,
  },
  title: { ...MockType.titleS, fontSize: 22, color: Colors.foam },
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.sm },
  sub: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.mutedText,
    marginTop: 2,
  },
});
