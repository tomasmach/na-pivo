/**
 * "Kolik jich už bylo?" — every lifetime number, one tap deep.
 *
 * The one design rule this file enforces: this sheet ONLY shows. It replaces
 * five sections that used to sit permanently on the Deník surface (records,
 * totals, pace, years, your pubs) with a single panel behind a single intent —
 * "ukaž mi moje čísla za celou dobu". Nothing inside changes state, so there is
 * no action here except closing: no filters, no segments, no edit, no chart.
 *
 * It is the canonical bottom sheet (see DrinkPickSheet): backdrop as an
 * absolute sibling of the card, fixed header → scroll → pinned footer, so the
 * footnote never scrolls away and the card always sits flush on the bottom
 * edge. Purely presentational — the parent formats every string it passes in.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { XIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

/** The big amber numeral. Fixed at 56 — this is a list, not the hero screen. */
const TOTAL_FONT_SIZE = 56;

export interface StatRow {
  /** Stable identity key. */
  key: string;
  /** Left-hand label, already declined ("Večerů", "U Hrocha", "2026"). */
  label: string;
  /** Right-hand figure, already formatted ("1 240", "3 210 Kč", "Zatím nic"). */
  value: string;
  /** Optional second line under the label ("průměr 3,4 na večer"). */
  meta?: string | null;
}

export interface DiaryStatsSheetProps {
  visible: boolean;
  /** Lifetime beers, pre-formatted with thin spaces ("1 240"). */
  totalBeers: string;
  /** Headline rows: evenings, pubs, money, this month. */
  rows: StatRow[];
  /** "REKORDY" section. Empty array hides the section and its caption. */
  records: StatRow[];
  /** "NEJVÍC JSI VYPIL" section — label is the pub name. */
  topPubs: StatRow[];
  /** "ROKY" section, newest first. */
  years: StatRow[];
  onClose: () => void;
}

export function DiaryStatsSheet({
  visible,
  totalBeers,
  rows,
  records,
  topPubs,
  years,
  onClose,
}: DiaryStatsSheetProps) {
  const insets = useSafeAreaInsets();

  // Rows are read-only, so they are grouped text nodes rather than controls:
  // VoiceOver announces "Večerů · 128" as one item instead of two fragments.
  const renderRow = (row: StatRow, isFirstOfGroup: boolean) => (
    <View
      key={row.key}
      style={[styles.row, !isFirstOfGroup && styles.rowDivider]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={cs.diary.nightMeta([row.label, row.value, row.meta ?? ''])}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {row.label}
        </Text>
        {row.meta ? (
          <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {row.meta}
          </Text>
        ) : null}
      </View>
      <Text style={styles.rowValue} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {row.value}
      </Text>
    </View>
  );

  // A section with nothing in it drops its caption too — an amber heading over
  // empty space is the exact decoration the design system bans.
  const renderSection = (caption: string, sectionRows: StatRow[]) =>
    sectionRows.length > 0 ? (
      <>
        <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
          {caption}
        </Text>
        {sectionRows.map((row, index) => renderRow(row, index === 0))}
      </>
    ) : null;

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* The backdrop is a dismiss target behind the card, not its parent —
            wrapping the card would stop it from sitting flush on the bottom
            edge and would swallow the sheet's own gestures. It stays out of the
            a11y tree so VoiceOver hears "Zavřít" once, from the real button. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          {/* The card swallows presses so a tap inside never falls through. */}
          <Pressable
            style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={() => undefined}
          >
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.diary.statsTitle}
              </Text>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.diaryStatsClose}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Same numeral + wide caption pair as the night card, so the
                  sheet reads as the same family rather than a second system. */}
              <View
                style={styles.total}
                accessible
                accessibilityRole="text"
                accessibilityLabel={cs.diary.nightMeta([totalBeers, cs.diary.statsTotalCaption])}
              >
                <Text
                  style={styles.totalCount}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.display}
                >
                  {totalBeers}
                </Text>
                <Text
                  style={styles.totalCaption}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.diary.statsTotalCaption}
                </Text>
              </View>

              {rows.map((row, index) => renderRow(row, index === 0))}
              {renderSection(cs.diary.statsRecordsCaption, records)}
              {renderSection(cs.diary.statsPubsCaption, topPubs)}
              {renderSection(cs.diary.statsYearsCaption, years)}
            </ScrollView>

            {/* Pinned below the scroll area: the footnote explains what the
                numbers do and do not count, so it must never scroll off. */}
            <View style={styles.footer}>
              <Text style={styles.footerCopy} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.diary.statsFooter}
              </Text>
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
  // The height bounds live HERE, not on the card, and that difference matters:
  // a percentage resolves against the parent's height, and `cardWrap` has an
  // auto height, so `maxHeight: '92%'` written on the card resolves against
  // nothing and is silently dropped. The card then grows past the screen, the
  // ScrollView inside never gets a bounded box, and everything below the fold
  // becomes unreachable — no scrolling, no error, just missing content.
  // `backdrop` is `flex: 1`, so percentages resolve properly one level up.
  // 72 %, not the usual 56 %: this sheet is a dozen rows in four sections, and
  // at 56 % it opened as a strip showing four of them.
  cardWrap: {
    width: '100%',
    minHeight: '72%',
    maxHeight: '92%',
  },
  card: {
    // Fills whatever cardWrap was clamped to, which is what bounds the scroll.
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
  // Bounded so a long history scrolls instead of pushing the footnote out.
  list: {
    flex: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  total: {
    alignItems: 'flex-start',
  },
  // The line box must clear the extrabold glyph's overshoot, or iOS shaves the
  // top off the digits; the caption's negative margin closes the gap below, so
  // the two read as one object instead of two stacked labels.
  totalCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: TOTAL_FONT_SIZE,
    lineHeight: TOTAL_FONT_SIZE * 1.24,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  totalCaption: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  caption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
    includeFontPadding: false,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
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
  },
  rowValue: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  footerCopy: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
});
