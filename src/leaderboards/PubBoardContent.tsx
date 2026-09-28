/**
 * PubBoardContent — the Hospody board inside Žebříčky. Pubs, not people, so
 * there is no "my rank": the hero card holds the winning pub on the lit podium
 * and the rows card the rest. Every pub opens its detail; nothing here counts
 * or navigates on its own. Values follow the person boards on the same screen.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import type { PubBoard, PubBoardEntry } from '@/data/pubBoardClient';
import { intlLocale, t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

import { HeroFooterSkeleton, HeroSkeleton, RowsSkeleton } from './BoardSkeleton';
import { PodiumMats } from './PodiumMats';

type LoadState = 'loading' | 'loaded' | 'error';

interface PubBoardContentProps {
  state: LoadState;
  board: PubBoard | null;
  period: 'week' | 'year' | 'all';
  reduceMotion: boolean;
  onOpen: (entry: PubBoardEntry) => void;
}

function beersLabel(beers: number): string {
  return t.leaderboards.score('beers', beers.toLocaleString(intlLocale), beers);
}

function day(isoDate: string): string {
  const [year, month, date] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'numeric' }).format(
    new Date(year, month - 1, date),
  );
}

/** Which days the board covers, for the hero footer. */
function windowLabel(board: PubBoard): string {
  if (!board.periodStart) return t.leaderboards.venuesAllTime;
  if (board.period === 'week' && board.periodEnd) {
    return `${day(board.periodStart)} – ${day(board.periodEnd)}`;
  }
  return t.leaderboards.venuesSince(day(board.periodStart));
}

function PubBoardContentBase({ state, board, period, reduceMotion, onOpen }: PubBoardContentProps) {
  const entries = state === 'loaded' ? board?.entries ?? [] : [];
  // With one city picked, only a district under the name still says something.
  const place = (entry: PubBoardEntry) => (entry.city === board?.city ? '' : entry.city);
  const winner = entries[0] ?? null;
  const rest = entries.slice(1);

  if (state === 'error' || (state === 'loaded' && !winner)) {
    const title = state === 'error' ? t.leaderboards.errorTitle : t.leaderboards.venuesEmptyTitle;
    const body = state === 'error' ? t.leaderboards.errorBody : t.leaderboards.venuesEmptyBody(period);
    return (
      <View style={styles.heroCard} accessible accessibilityRole="text" accessibilityLabel={`${title}. ${body}`}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.leaderboards.venuesSubtitle(period)}
        </Text>
        <View style={styles.blankBody}>
          <View style={styles.blankLead}>
            <Text style={styles.blankTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {title}
            </Text>
            <Text style={styles.blankText} maxFontSizeMultiplier={FontScaleCap.body}>
              {body}
            </Text>
          </View>
          {state === 'error' ? null : (
            <View style={styles.rules}>
              <Text style={styles.rulesCaption} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.leaderboards.rulesCaption}
              </Text>
              {t.leaderboards.venuesRules(period).map((rule) => (
                <Text key={rule} style={styles.ruleText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {rule}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <>
      {winner && board ? (
        <Pressable
          onPress={() => onOpen(winner)}
          accessibilityRole="button"
          accessibilityLabel={t.leaderboards.venuesHeroA11y(
            winner.name,
            winner.city,
            beersLabel(winner.beers),
          )}
          style={({ pressed }) => [styles.heroCard, pressed && styles.pressed]}
        >
          <Text style={styles.eyebrow} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.leaderboards.venuesSubtitle(period)}
          </Text>
          <View style={styles.heroBody}>
            <View style={styles.winnerColumn}>
              <Text style={styles.rank} maxFontSizeMultiplier={FontScaleCap.display}>
                1.
              </Text>
              <View style={styles.winnerNameRow}>
                <Text style={styles.winnerName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {winner.name}
                </Text>
                <ChevronRightIcon size={18} color={Colors.foamMuted} />
              </View>
              {place(winner) ? (
                <Text style={styles.winnerCity} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {place(winner)}
                </Text>
              ) : null}
            </View>
            <PodiumMats rank={1} width={88} />
          </View>
          <View style={styles.heroFooter}>
            <Text style={styles.scoreFact} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {beersLabel(winner.beers)}
            </Text>
            <Text style={styles.totalFact} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {windowLabel(board)}
            </Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.leaderboards.venuesSubtitle(period)}
          </Text>
          <HeroSkeleton reduceMotion={reduceMotion} />
          <HeroFooterSkeleton reduceMotion={reduceMotion} />
        </View>
      )}

      {state === 'loading' || rest.length > 0 ? (
        <>
          <Text style={styles.listLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.leaderboards.venuesListLabel}
          </Text>
          <View style={styles.rowsCard}>
            {state === 'loading' ? (
              <RowsSkeleton reduceMotion={reduceMotion} />
            ) : (
              rest.map((entry, index) => (
                <Pressable
                  key={entry.key}
                  onPress={() => onOpen(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={t.leaderboards.venuesRowA11y(
                    entry.rank,
                    entry.name,
                    entry.city,
                    beersLabel(entry.beers),
                  )}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowDivider,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={entry.rank <= 3 ? styles.rankMedal : styles.rankPlain}
                    allowFontScaling={false}
                  >
                    {entry.rank}
                  </Text>
                  <View style={styles.nameCol}>
                    <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
                      {entry.name}
                    </Text>
                    {place(entry) ? (
                      <Text style={styles.city} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {place(entry)}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.score} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.display}>
                    {entry.beers.toLocaleString(intlLocale)}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </>
      ) : null}
    </>
  );
}

export const PubBoardContent = memo(PubBoardContentBase);

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  heroCard: {
    ...CardSurface.card,
  },
  eyebrow: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  heroBody: {
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  winnerColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  rank: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 72,
    lineHeight: 72 * 1.24,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  winnerNameRow: {
    marginTop: -8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  winnerName: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    lineHeight: 28,
    color: Colors.foam,
    includeFontPadding: false,
  },
  winnerCity: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  heroFooter: {
    ...CardSurface.footer,
  },
  scoreFact: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  totalFact: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  blankBody: {
    minHeight: 132,
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 12,
    gap: 24,
  },
  blankLead: {
    gap: 8,
  },
  blankTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: Colors.foam,
    includeFontPadding: false,
  },
  blankText: {
    maxWidth: 320,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  rules: {
    gap: 6,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rulesCaption: {
    marginBottom: 2,
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    includeFontPadding: false,
  },
  ruleText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  listLabel: {
    marginTop: 24,
    marginBottom: 8,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  rowsCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingVertical: 4,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rankMedal: {
    width: 28,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 16,
    lineHeight: 16 * 1.24,
    color: Colors.foamMuted,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  rankPlain: {
    width: 28,
    textAlign: 'center',
    fontFamily: Fonts.display.semibold,
    fontSize: 15,
    lineHeight: 15 * 1.24,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  nameCol: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  city: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  score: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    lineHeight: 18 * 1.24,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
});
