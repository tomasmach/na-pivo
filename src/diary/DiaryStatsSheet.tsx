/**
 * "Kolik jich už bylo?" — every lifetime number, one tap deep.
 *
 * The one rule this file enforces: this sheet ONLY shows. It replaces five
 * sections that used to sit permanently on the diary surface (records, totals,
 * pace, years, your pubs) with a single panel behind a single intent — "ukaž mi
 * moje čísla za celou dobu". Nothing inside changes state, so there is no action
 * here except closing: no filters, no segments, no edit, no chart.
 *
 * 3.0 pass: the label→value table it used to be read as an export of a
 * database. A lifetime of evenings is a reward, so the numbers arrive the way
 * every other number in the app does — a big amber numeral, then `StatGrid`
 * (Baloo, §3), then sections separated by `SectionBreak` rather than by amber
 * micro-kickers (§0.5, §4.1). The rows that remain are the ones that genuinely
 * are a list: your pubs and your years.
 *
 * It is the canonical bottom sheet (§7): backdrop as an absolute sibling of the
 * card, height bounds on `cardWrap` and not on the card (§7.5), fixed header →
 * scroll → pinned footer, so the footnote never scrolls away. Purely
 * presentational — the parent formats every string it passes in.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { cs } from '@/i18n/cs';
import { MockLayout } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { StatGrid, type Stat } from '@/mocks/StatGrid';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

/** The big amber numeral. Fixed at 56 — this is a panel, not the hero screen. */
const TOTAL_FONT_SIZE = 56;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export interface StatRow {
  /** Stable identity key. */
  key: string;
  /** Left-hand label, already declined ("U Hrocha", "2026"). */
  label: string;
  /** Right-hand figure, already formatted ("1 240", "3 210 Kč", "Zatím nic"). */
  value: string;
  /** Optional second line under the label ("U Hrocha", "průměr 3,4 na večer"). */
  meta?: string | null;
}

export interface DiaryStatsSheetProps {
  visible: boolean;
  /** Lifetime beers, pre-formatted with thin spaces ("1 240"). */
  totalBeers: string;
  /** Lifetime grid: evenings, pubs, money — plus ratings and distance if known. */
  totals: Stat[];
  /** "Tenhle měsíc" grid, or null when nothing has landed in it yet. */
  month: Stat[] | null;
  /** "Rekordy" section. An empty array hides the section and its heading. */
  records: StatRow[];
  /** "Tvoje hospody" — label is the pub name. */
  topPubs: StatRow[];
  /** "Roky", newest first. */
  years: StatRow[];
  onClose: () => void;
}

export function DiaryStatsSheet({
  visible,
  totalBeers,
  totals,
  month,
  records,
  topPubs,
  years,
  onClose,
}: DiaryStatsSheetProps) {
  const insets = useSafeAreaInsets();

  // Rows are read-only, so they are grouped text nodes rather than controls:
  // VoiceOver announces "U Hrocha · 128 piv" as one item, not two fragments.
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
      <Text style={styles.rowValue} numberOfLines={1} allowFontScaling={false}>
        {row.value}
      </Text>
    </View>
  );

  // A section with nothing in it drops its heading too — a title over empty
  // space is the exact decoration the design system bans.
  const renderSection = (title: string, sectionRows: StatRow[]) =>
    sectionRows.length > 0 ? (
      <>
        <SectionBreak title={title} inset={MockLayout.screenPad} />
        {sectionRows.map((row, index) => renderRow(row, index === 0))}
      </>
    ) : null;

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      {/* The backdrop is a dismiss target behind the card, not its parent —
          wrapping the card would stop it from sitting flush on the bottom edge
          and would swallow the sheet's own gestures. It stays out of the a11y
          tree so VoiceOver hears "Zavřít" once, from the real button. */}
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
            <CloseButton onPress={onClose} label={cs.a11y.diaryStatsClose} />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Same numeral + wide caption pair as the night card, so the sheet
                reads as the same family rather than as a second system. */}
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

            {/* Chunked into rows of three rather than handed to one wrapping
                grid: `StatGrid` only spaces wrapped rows in its two-column
                shape, so a five-stat lifetime block came out with its second
                row welded to the first. */}
            {chunk(totals, 3).map((row) => (
              <View key={row.map((stat) => stat.label).join('|')} style={styles.totals}>
                <StatGrid columns={3} stats={row} />
              </View>
            ))}

            {month ? (
              <>
                <SectionBreak title={cs.diary.statsThisMonth} inset={MockLayout.screenPad} />
                {/* The two-column grid spaces its own rows with a bottom margin
                    on every cell; here there is only one row, so that margin is
                    dead air before the next band. */}
                <View style={styles.monthGrid}>
                  <StatGrid columns={2} stats={month} />
                </View>
              </>
            ) : null}

            {renderSection(cs.diary.statsRecordsTitle, records)}
            {renderSection(cs.diary.statsPubsTitle, topPubs)}
            {renderSection(cs.diary.statsYearsTitle, years)}
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
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  // The height bounds live HERE, not on the card, and that difference matters:
  // a percentage resolves against the parent's height, and `cardWrap` has an
  // auto height, so `maxHeight: '92%'` written on the card resolves against
  // nothing and is silently dropped. The card then grows past the screen, the
  // ScrollView inside never gets a bounded box, and everything below the fold
  // becomes unreachable — no scrolling, no error, just missing content (§7.5).
  // 72 %, not the usual 56 %: this sheet is four sections, and at 56 % it opened
  // as a strip showing the numeral and nothing else.
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
    paddingHorizontal: MockLayout.screenPad,
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
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 22,
    letterSpacing: -0.3,
    color: Colors.foam,
    includeFontPadding: false,
  },
  // Bounded so a long history scrolls instead of pushing the footnote out.
  list: { flex: 1, marginTop: Spacing.sm },
  listContent: { paddingBottom: Spacing.xl },

  total: { alignItems: 'flex-start' },
  // The line box must clear the extrabold glyph's overshoot, or iOS shaves the
  // top off the digits; the caption's negative margin closes the gap below, so
  // the two read as one object instead of two stacked labels.
  totalCount: {
    fontFamily: Fonts.numeral,
    fontSize: TOTAL_FONT_SIZE,
    lineHeight: TOTAL_FONT_SIZE * 1.24,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  totalCaption: {
    marginTop: -8,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  totals: { marginTop: Spacing.lg },
  monthGrid: { marginBottom: -Spacing.lg },

  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.08),
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: {
    fontWeight: '600',
    fontSize: 16,
    color: Colors.foam,
    includeFontPadding: false,
  },
  rowMeta: {
    marginTop: 2,
    fontWeight: '400',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  // The figure carries the app's one custom face, exactly as it does in
  // `StatGrid` — a lifetime record read in SF is a spreadsheet cell (§3).
  rowValue: {
    flexShrink: 0,
    fontFamily: Fonts.numeral,
    fontSize: 20,
    lineHeight: 25,
    letterSpacing: -0.2,
    color: Colors.amber,
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
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
});
