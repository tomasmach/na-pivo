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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';

import { XIcon } from '@/components/shared/IconGlyph';
import { BeerList } from '@/party/BeerList';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export function BeerSheet({
  visible,
  rows,
  onTaps,
  onClose,
  onAdd,
  onRemove,
}: {
  visible: boolean;
  rows: { beer: string; count: number }[];
  onTaps: { name: string; priceCzk: number | null }[];
  onClose: () => void;
  onAdd: (beer: string) => void;
  onRemove: (beer: string) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View
        style={[
          styles.card,
          { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text
              style={styles.title}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              Co piješ
            </Text>
            <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
              Uprav počty nebo si dej něco jiného.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Zavřít"
            hitSlop={8}
          >
            <XIcon size={17} color={Colors.mutedText} />
          </Pressable>
        </View>

        <BeerList
          rows={rows}
          onTaps={onTaps}
          onTap={onAdd}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 6,
    borderTopRightRadius: MockLayout.cardRadius + 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingBottom: Spacing.sm,
  },
  title: { ...MockType.titleS, fontSize: 22, color: Colors.foam },
  sub: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.mutedText,
    marginTop: 2,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
});
