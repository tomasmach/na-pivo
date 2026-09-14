/**
 * "Tvůj účet" — the counter's receipt bottom sheet.
 *
 * One design rule: this sheet ONLY removes drinks and closes the evening.
 * There is no way to add anything from here — adding lives in "Co si dáš?".
 * Presentational only: props in, callbacks out, no store or network access.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { t } from '@/i18n';
import { MinusIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { MockLayout, MockType } from '@/mocks/mockTheme';

export interface ReceiptItem {
  key: string; // identity key
  name: string;
  meta: string | null; // "0,5 l" or null
  count: number;
  totalLabel: string | null; // "186 Kč" or null when unknown (outside a pub without prices)
}

export interface ReceiptSheetProps {
  visible: boolean;
  /** Pre-composed t.counter.receiptStarted('19:40'). */
  startedAtLabel: string | null;
  beerItems: ReceiptItem[];
  otherItems: ReceiptItem[];
  /** null → hide the Celkem row entirely. */
  totalLabel: string | null;
  onRemove: (item: ReceiptItem) => void;
  onDone: () => void;
  onClose: () => void;
}

function ReceiptRow({ item, onRemove }: { item: ReceiptItem; onRemove: (item: ReceiptItem) => void }) {
  const countLine = `${t.counter.perBeerCount(item.count)}${item.meta ? ' · ' + item.meta : ''}`;

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {countLine}
        </Text>
      </View>
      {item.totalLabel != null && (
        <Text style={styles.rowTotal} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {item.totalLabel}
        </Text>
      )}
      <Pressable
        onPress={() => onRemove(item)}
        style={({ pressed }) => [styles.minusButton, pressed && styles.pressedDim]}
        accessibilityRole="button"
        accessibilityLabel={t.a11y.counterRemoveIdentity(item.name)}
      >
        <MinusIcon size={18} color={Colors.foam} />
      </Pressable>
    </View>
  );
}

export function ReceiptSheet({
  visible,
  startedAtLabel,
  beerItems,
  otherItems,
  totalLabel,
  onRemove,
  onDone,
  onClose,
}: ReceiptSheetProps) {
  const insets = useSafeAreaInsets();

  const hasItems = beerItems.length > 0 || otherItems.length > 0;

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      {/* The backdrop is a dismiss target, not an announced control: the real
          close button carries the label so VoiceOver hears "Zavřít" once. */}
        {/* The backdrop is a dismiss target behind the card, not its parent —
            wrapping the card would stop it from sitting flush on the bottom
            edge and would swallow the sheet's own gestures. */}
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.grabber} />

            <View style={styles.header}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.counter.receiptTitle}
              </Text>
              <CloseButton onPress={onClose} label={t.a11y.counterCloseModal} />
            </View>

            {startedAtLabel != null && (
              <Text style={styles.startedAt} maxFontSizeMultiplier={FontScaleCap.body}>
                {startedAtLabel}
              </Text>
            )}

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {hasItems && (
                <>
                  {beerItems.map((item) => (
                    <ReceiptRow key={item.key} item={item} onRemove={onRemove} />
                  ))}
                  {beerItems.length > 0 && otherItems.length > 0 && <View style={styles.hairline} />}
                  {otherItems.map((item) => (
                    <ReceiptRow key={item.key} item={item} onRemove={onRemove} />
                  ))}
                </>
              )}
            </ScrollView>

            {/* The total and the close button are the bill's bottom line, so
                they stay pinned: a long evening scrolls above them and neither
                can be scrolled away or clipped by the card's max height. */}
            {totalLabel != null && hasItems && (
              <View style={styles.totalRow}>
                <Text style={styles.totalText} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {t.counter.receiptTotal}
                </Text>
                <Text style={styles.totalText} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {totalLabel}
                </Text>
              </View>
            )}

            <View style={styles.footer}>
              <GlowButton
                label={t.counter.receiptClose}
                variant="secondary"
                glow="none"
                onPress={onDone}
                accessibilityLabel={t.a11y.counterDone}
              />
            </View>
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
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  startedAt: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 2,
  },
  // Bounded so a long evening scrolls inside the sheet instead of pushing the
  // pinned footer off the bottom of the card.
  list: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  // Two lines of text plus a 44pt control need real height, or the second
  // line collides with the row below.
  row: {
    minHeight: 64,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
  },
  rowMeta: {
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    marginTop: 2,
  },
  rowTotal: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  minusButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xs,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  totalText: {
    fontWeight: '800',
    fontSize: 17,
    color: Colors.foam,
    includeFontPadding: false,
  },
  footer: {
    marginTop: Spacing.md,
  },
  pressedDim: {
    opacity: 0.75,
  },
});
