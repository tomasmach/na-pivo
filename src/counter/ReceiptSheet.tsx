/**
 * "Tvůj účet" — the counter's receipt bottom sheet.
 *
 * One design rule: this sheet ONLY removes drinks and closes the evening.
 * There is no way to add anything from here — adding lives in "Co si dáš?".
 * Presentational only: props in, callbacks out, no store or network access.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { MinusIcon, XIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';

export interface ReceiptItem {
  key: string; // identity key
  name: string;
  meta: string | null; // "0,5 l" or null
  count: number;
  totalLabel: string | null; // "186 Kč" or null when unknown (outside a pub without prices)
}

export interface ReceiptSheetProps {
  visible: boolean;
  /** Pre-composed cs.counter.receiptStarted('19:40'). */
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
  const countLine = `${cs.counter.perBeerCount(item.count)}${item.meta ? ' · ' + item.meta : ''}`;

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
        accessibilityLabel={cs.a11y.counterRemoveIdentity(item.name)}
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
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* The backdrop is a dismiss target, not an announced control: the real
          close button carries the label so VoiceOver hears "Zavřít" once. */}
      <View style={styles.backdrop}>
        {/* The backdrop is a dismiss target behind the card, not its parent —
            wrapping the card would stop it from sitting flush on the bottom
            edge and would swallow the sheet's own gestures. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          {/* The card swallows presses so a row tap never falls through to the backdrop. */}
          <Pressable
            style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={() => undefined}
          >
            <View style={styles.grabber} />

            <View style={styles.header}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.counter.receiptTitle}
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressedDim]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
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
                  {cs.counter.receiptTotal}
                </Text>
                <Text style={styles.totalText} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {totalLabel}
                </Text>
              </View>
            )}

            <View style={styles.footer}>
              <GlowButton
                label={cs.counter.receiptClose}
                variant="secondary"
                glow="none"
                onPress={onDone}
                accessibilityLabel={cs.a11y.counterDone}
              />
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  cardWrap: {
    width: '100%',
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minHeight: '44%',
    maxHeight: '92%',
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
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
  startedAt: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 2,
  },
  // Bounded so a long evening scrolls inside the sheet instead of pushing the
  // pinned footer off the bottom of the card.
  list: {
    flex: 1,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  rowMeta: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    marginTop: 2,
  },
  rowTotal: {
    fontFamily: Fonts.ui.semibold,
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
    fontFamily: Fonts.display.extrabold,
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
