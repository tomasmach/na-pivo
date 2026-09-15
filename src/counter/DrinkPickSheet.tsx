/**
 * "Co si dáš?" — the counter's add sheet.
 *
 * The one design rule this file enforces: this sheet ONLY adds. There is no
 * minus, no remove, no close-the-evening anywhere in it — removing lives in
 * the "Tvůj účet" receipt sheet. It is also the only place in the app that
 * offers "add a new beer" while counting. Purely presentational: rows in,
 * callbacks out; the parent owns all counting logic.
 */

import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { CupSodaIcon, PlusIcon, RefreshCwIcon, XIcon } from '@/components/shared/IconGlyph';

export interface DrinkPickRow {
  /** Stable identity key. */
  key: string;
  name: string;
  /** Pre-composed "0,5 l · 62 Kč" or "Bez ceny" — parent builds it via cs.counter.beerMeta. */
  meta: string;
  /** How many of these tonight (0 = no badge). */
  count: number;
  /** false → tapping will ask for the price first (parent handles that). */
  hasPrice: boolean;
}

export function DrinkPickSheet({
  visible,
  isPub,
  beerMenuRotates = false,
  tonightRows,
  menuRows,
  onCountRow,
  onEditRow,
  onAddBeer,
  onAddOther,
  onClose,
}: {
  visible: boolean;
  isPub: boolean;
  /** The pub intentionally changes its tap list; rows are the latest snapshot. */
  beerMenuRotates?: boolean;
  /** What you've already had tonight, latest first. */
  tonightRows: DrinkPickRow[];
  /** The pub's community menu (empty outside a pub). */
  menuRows: DrinkPickRow[];
  onCountRow: (row: DrinkPickRow) => void;
  /** Long-press, pub only. */
  onEditRow: (row: DrinkPickRow) => void;
  onAddBeer: () => void;
  onAddOther: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  const isEmpty = tonightRows.length === 0 && menuRows.length === 0;
  const showCaptions = tonightRows.length > 0 && menuRows.length > 0;

  const renderRow = (row: DrinkPickRow, isFirstOfGroup: boolean) => (
    <Pressable
      key={row.key}
      onPress={() => onCountRow(row)}
      onLongPress={isPub ? () => onEditRow(row) : undefined}
      delayLongPress={300}
      style={({ pressed }) => [
        styles.row,
        !isFirstOfGroup && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        row.hasPrice
          ? cs.a11y.counterCountBeer(row.name, row.meta)
          : cs.a11y.counterCountBeerNoPrice(row.name)
      }
      // The long-press edit is invisible otherwise — a screen reader user would
      // never learn the pub's price can be fixed from here.
      accessibilityHint={isPub ? cs.a11y.counterEditBeer(row.name) : undefined}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {row.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {row.meta}
        </Text>
      </View>
      {row.count > 0 ? (
        <Text style={styles.rowBadge} maxFontSizeMultiplier={FontScaleCap.display}>
          {cs.counter.perBeerCount(row.count)}
        </Text>
      ) : null}
    </Pressable>
  );

  const renderActionRow = (
    key: string,
    Icon: typeof PlusIcon,
    label: string,
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.actionIcon}>
        <Icon size={18} color={Colors.amber} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );

  const addBeerLabel = isEmpty ? cs.counter.pickFirstBeer : cs.counter.pickAddBeer;

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
                {cs.counter.pickTitle}
              </Text>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>

            {isPub && beerMenuRotates ? (
              <View style={styles.rotatingHint}>
                <RefreshCwIcon size={13} color={Colors.amber} />
                <Text style={styles.rotatingHintText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.counter.rotatingMenuHint}
                </Text>
              </View>
            ) : null}

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {isEmpty ? (
                <Text style={styles.emptyCopy} maxFontSizeMultiplier={FontScaleCap.body}>
                  {isPub && beerMenuRotates
                    ? cs.counter.rotatingMenuBadge
                    : isPub
                      ? cs.counter.pickEmptyPub
                      : cs.counter.pickEmptyOutside}
                </Text>
              ) : (
                <>
                  {tonightRows.length > 0 ? (
                    <>
                      {showCaptions ? (
                        <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
                          {cs.counter.outsideMenuHeader}
                        </Text>
                      ) : null}
                      {tonightRows.map((row, index) => renderRow(row, index === 0))}
                    </>
                  ) : null}
                  {menuRows.length > 0 ? (
                    <>
                      {showCaptions ? (
                        <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
                          {cs.counter.menuHeader}
                        </Text>
                      ) : null}
                      {menuRows.map((row, index) => renderRow(row, index === 0))}
                    </>
                  ) : null}
                </>
              )}
            </ScrollView>

            {/* Pinned below the scroll area: the two ways to add something new
                must never scroll off or get clipped by the card's max height. */}
            <View style={styles.actions}>
              {renderActionRow('add-beer', PlusIcon, addBeerLabel, onAddBeer, cs.a11y.counterAddBeer)}
              {renderActionRow('add-other', CupSodaIcon, cs.counter.pickNonBeer, onAddOther, cs.counter.pickNonBeer)}
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
  // The height bounds live HERE, not on the card: a percentage resolves
  // against the parent's height, and the card's parent (this) is auto-height,
  // so bounds written on the card are silently dropped — the card then grows
  // past the screen and the ScrollView inside never scrolls. `backdrop` is
  // flex: 1, so percentages resolve properly one level up. See §7.5.
  cardWrap: {
    width: '100%',
    minHeight: '56%',
    maxHeight: '92%',
  },
  card: {
    // Fills whatever cardWrap was clamped to — that is what bounds the scroll.
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  rotatingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.24),
  },
  rotatingHintText: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.amber,
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
  // Bounded so a long menu scrolls instead of pushing the pinned actions out.
  list: {
    flex: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  caption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1 },
  rowName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  rowMeta: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 2,
  },
  rowBadge: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.amber,
    includeFontPadding: false,
  },
  emptyCopy: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  actions: {
    gap: 8,
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  actionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  actionLabel: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
});
