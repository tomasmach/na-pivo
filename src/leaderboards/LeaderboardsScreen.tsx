/**
 * Global leaderboards (Žebříčky) — the Community tab, and still the pushed
 * route `/leaderboards` that the counter, the profile and Parta link into.
 *
 * Three countrywide boards (Pivaři · Objevitelé · Mapéři) over three windows
 * (week · year · all-time; Mapér is all-time only). The data client remains
 * responsible for per-board caching and force refreshes; this screen only
 * composes that data in the app's Tácek language.
 *
 * `embedded` is the whole difference between the two homes: a tab is not a
 * place you came from, so it has no back chevron. Everything else — the boards,
 * the filters, the podium — is identical, because a leaderboard that looked
 * different depending on which door you used would just be two leaderboards.
 *
 * Community deliberately IS this screen rather than a hub of links to it. A row
 * that says "Žebříčky →" is chrome telling you the content lives elsewhere; the
 * tab should open on the actual standings (§0.1 — one primary thing, and it is
 * the content).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { CounterCta } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import {
  fetchLeaderboard,
  type Leaderboard,
  type LeaderboardCategory,
  type LeaderboardPeriod,
} from '@/data/leaderboardsClient';
import { trackClientEvent } from '@/data/telemetryClient';
import { cs } from '@/i18n/cs';
import { PeopleSuggestions } from '@/community/PeopleSuggestions';
import BoardSegmented from '@/leaderboards/BoardSegmented';
import { HeroFooterSkeleton, HeroSkeleton, RowsSkeleton } from '@/leaderboards/BoardSkeleton';
import { GlobalBoardRow } from '@/leaderboards/GlobalBoardRow';
import PeriodChips from '@/leaderboards/PeriodChips';
import { PodiumMats } from '@/leaderboards/PodiumMats';
import { useAccountStore } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

type LoadState = 'loading' | 'loaded' | 'error';

// Which board and which window are two separate questions, so they get two
// visually different controls: a solid segmented track with a sliding thumb for
// the metric, and a quiet underlined text row for the window. Two controls in
// the same voice were the thing that blurred together.
const CATEGORIES: readonly LeaderboardCategory[] = ['beers', 'pubs', 'mapper'];
const CATEGORY_LABELS = CATEGORIES.map((key) => cs.leaderboards.categoryTab(key));

const PERIODS: readonly { key: LeaderboardPeriod; label: string }[] = (
  ['week', 'year', 'all'] as const
).map((key) => ({ key, label: cs.leaderboards.periodTab(key) }));

function unitFor(category: LeaderboardCategory, score: number): string {
  if (category === 'beers') return cs.leaderboards.unitBeers(score);
  if (category === 'pubs') return cs.leaderboards.unitPubs(score);
  return cs.leaderboards.unitXp;
}

function rankFontSize(rank: number | null): number {
  if (rank == null || rank < 100) return 88;
  if (rank < 1000) return 72;
  return 56;
}

function sameBoard(
  board: Leaderboard | null,
  category: LeaderboardCategory,
  period: LeaderboardPeriod,
): board is Leaderboard {
  if (!board || board.category !== category) return false;
  return board.period === (category === 'mapper' ? 'all' : period);
}

export interface LeaderboardsScreenProps {
  /** Rendered as the Community tab: no back chevron, nothing to return to. */
  embedded?: boolean;
}

export default function LeaderboardsScreen({ embedded = false }: LeaderboardsScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const profile = useAccountStore((s) => s.profile);
  const { source } = useLocalSearchParams<{ source?: string }>();

  const [category, setCategory] = useState<LeaderboardCategory>('beers');
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [state, setState] = useState<LoadState>('loading');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [heroBodyHeight, setHeroBodyHeight] = useState(0);

  // Mapér XP has one window only. The picked window survives the detour, so
  // switching to Mapéři and back does not silently reset it to „Týden“.
  const effectivePeriod: LeaderboardPeriod = category === 'mapper' ? 'all' : period;

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    void trackClientEvent({
      event: 'leaderboards_opened',
      context: { source: typeof source === 'string' && source ? source : 'unknown' },
    });
    // The source param cannot change under this pushed screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A later board choice always outranks an older response.
  const requestRef = useRef(0);
  const load = useCallback(
    async (force = false) => {
      const requestId = ++requestRef.current;
      const result = await fetchLeaderboard(category, effectivePeriod, { force });
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setBoard(result);
      setState(result ? 'loaded' : 'error');
    },
    [category, effectivePeriod],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState('loading');
    void load(true);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      await load(true);
      if (mountedRef.current) setRefreshing(false);
    })();
  }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/friends' as Href);
  }, [router]);

  const openProfile = useCallback(
    (accountId: string) => {
      router.push({ pathname: '/parta/[id]', params: { id: accountId } } as Href);
    },
    [router],
  );

  const openVisibility = useCallback(() => {
    router.push('/profile/edit' as Href);
  }, [router]);

  // Both controls own their own haptic, so the screen only moves the state.
  const chooseCategory = useCallback(
    (index: number) => {
      const next = CATEGORIES[index] ?? 'beers';
      if (next === category) return;
      setCategory(next);
      setState('loading');
    },
    [category],
  );

  const choosePeriod = useCallback(
    (next: LeaderboardPeriod) => {
      if (next === period) return;
      setPeriod(next);
      setState('loading');
    },
    [period],
  );

  const tableTitle = cs.leaderboards.tableTitle(category, effectivePeriod);
  const visibleBoard =
    state === 'loaded' && sameBoard(board, category, effectivePeriod) ? board : null;
  const entries = useMemo(() => visibleBoard?.entries ?? [], [visibleBoard]);
  const me = visibleBoard?.me ?? null;
  const hasNickname = Boolean(profile?.nickname);
  const isGhost = Boolean(me && !me.eligible);

  // Only full boards can produce a meaningful gap to their last visible row.
  const chaseGap = useMemo(() => {
    if (!me || me.listed || me.rank == null || entries.length === 0) return 0;
    const lastVisible = entries[entries.length - 1];
    const gap = lastVisible.score - me.score + 1;
    return gap > 0 ? gap : 0;
  }, [entries, me]);

  const nudge = useMemo<Nudge | null>(() => {
    // The failure is stated by the card and undone by the button; a strip
    // between them would be the same sentence a third time.
    if (state === 'error') return null;
    // The ghost's "why" used to hang under the button as a second line; it is a
    // state note, not a description of the tap, so it belongs in the strip.
    if (isGhost) {
      return {
        kind: 'dopito',
        label: cs.leaderboards.ghostNudge,
        onPress: openVisibility,
      };
    }
    if (chaseGap > 0) {
      return {
        kind: 'dopito',
        label: cs.leaderboards.chase(category, chaseGap),
        onPress: () => undefined,
      };
    }
    return null;
  }, [category, chaseGap, isGhost, openVisibility, state]);

  const cta = useMemo(() => {
    if (state === 'error') {
      return { label: cs.leaderboards.retry, onPress: retry };
    }
    if (isGhost) {
      return {
        label: hasNickname ? cs.leaderboards.ghostCta : cs.leaderboards.ghostAnonCta,
        onPress: openVisibility,
      };
    }
    if (category === 'beers') {
      return {
        label: cs.leaderboards.ctaBeers,
        onPress: () => router.replace('/(tabs)/beer' as Href),
      };
    }
    if (category === 'pubs') {
      return {
        label: cs.leaderboards.ctaPubs,
        onPress: () => router.replace('/(tabs)' as Href),
      };
    }
    return {
      label: cs.leaderboards.ctaMapper,
      onPress: () => router.replace('/(tabs)' as Href),
    };
  }, [category, hasNickname, isGhost, openVisibility, retry, router, state]);

  const handleHeroBodyLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setHeroBodyHeight((previous) => (Math.abs(previous - height) > 0.5 ? height : previous));
  }, []);

  const rank = me?.rank ?? null;
  const rankLabel = rank == null ? '' : rank.toLocaleString('cs-CZ');
  const numeralSize = rankFontSize(rank);
  const podiumWidth =
    heroBodyHeight > 0 ? Math.max(64, Math.min(112, (heroBodyHeight - 16) * 0.66)) : 88;
  const scoreLabel =
    me && me.score > 0
      ? cs.leaderboards.score(category, me.score.toLocaleString('cs-CZ'), me.score)
      : cs.leaderboards.noScore;
  const totalRanked = visibleBoard?.totalRanked ?? null;
  const totalLabel = cs.leaderboards.totalInBoard(totalRanked?.toLocaleString('cs-CZ') ?? null);

  // A rank is what the hero draws: the numeral, the podium and the score fact
  // all mean nothing without one. Without a rank the card carries copy instead
  // of a dash rendered at 88pt and a podium with no lit mat.
  const boardEmpty = state === 'loaded' && entries.length === 0;
  const blankTitle =
    state === 'error'
      ? cs.leaderboards.errorTitle
      : boardEmpty
        ? cs.leaderboards.emptyBoardTitle
        : cs.leaderboards.notRankedTitle;
  const blankBody =
    state === 'error'
      ? cs.leaderboards.errorBody
      : boardEmpty
        ? cs.leaderboards.emptyBoardBody(category)
        : cs.leaderboards.notRankedBody(category);
  // With no rows under it the card is the whole screen, so it takes the space
  // the list would have used instead of leaving a brown hole above the button.
  const showList = state === 'loading' || entries.length > 0;
  const showWeeklyReset = effectivePeriod === 'week';

  // The footer carries at most two facts and never an empty slot: whatever is
  // known lands left first, so a lone fact is not stranded on the right edge.
  // The blank card that owns the whole screen states the reset in its rules, so
  // repeating it in the footer would be the same fact twice.
  const [footerLeft, footerRight] = (
    rank != null
      ? [scoreLabel, totalLabel]
      : showList
        ? [totalRanked ? totalLabel : null, showWeeklyReset ? cs.leaderboards.weeklyReset : null]
        : []
  ).filter(Boolean) as (string | undefined)[];

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      {embedded ? null : (
      <View style={styles.header}>
        {(
          <Pressable
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.leaderboards.back}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <ChevronLeftIcon size={26} color={Colors.foam} />
          </Pressable>
        )}

        <Text
          style={[styles.headerTitle, embedded && styles.headerTitleEmbedded]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.leaderboards.screenTitle}
        </Text>

        {/* The back chevron's twin, so the title stays optically centred.
            Without the chevron there is nothing to balance, and the title moves
            to the left edge like every other tab's title. */}
        <View style={styles.headerSpacer} />
      </View>
      )}

      {/* One filter block, two questions asked in two different voices: the
          metric is a solid track with one sliding thumb, the window is quiet
          underlined text. They sit 8 pt apart and 16 pt above the card, so they
          read as one control group, not two stray rows. */}
      {embedded ? <PeopleSuggestions /> : null}

      <View style={styles.filters}>
        <BoardSegmented
          options={CATEGORY_LABELS}
          value={Math.max(0, CATEGORIES.indexOf(category))}
          onChange={chooseCategory}
          describeOption={cs.leaderboards.selectCategory}
          accessibilityLabel={cs.a11y.leaderboardCategory}
        />

        {/* Fixed-height slot, so switching to Mapéři swaps the row for its note
            without shifting the card under it (§14.8). */}
        <View style={styles.periodSlot}>
          {category === 'mapper' ? (
            <Text style={styles.periodNote} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.leaderboards.mapperPeriodNote}
            </Text>
          ) : (
            <PeriodChips
              options={PERIODS}
              value={period}
              onChange={choosePeriod}
              describeOption={cs.leaderboards.selectPeriod}
              accessibilityLabel={cs.a11y.leaderboardPeriod}
            />
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, !showList && styles.scrollContentCentered]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.amber} />
        }
      >
        <View
          accessibilityRole="text"
          accessibilityLabel={
            rank != null
              ? cs.leaderboards.heroA11y(tableTitle, rankLabel, scoreLabel, totalRanked)
              : cs.leaderboards.blankA11y(tableTitle, blankTitle, blankBody)
          }
          style={styles.heroCard}
        >
          <CardSheen />

          <Text style={styles.eyebrow} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.leaderboards.subtitle(category, effectivePeriod)}
          </Text>

          {state === 'loading' ? (
            <HeroSkeleton reduceMotion={reduceMotion} />
          ) : rank != null ? (
            <View style={styles.heroBody} onLayout={handleHeroBodyLayout}>
              <View style={styles.rankColumn}>
                <Text
                  style={[styles.rank, { fontSize: numeralSize, lineHeight: numeralSize * 1.24 }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={FontScaleCap.display}
                >
                  {`${rankLabel}.`}
                </Text>
                <Text
                  style={styles.rankNoun}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.leaderboards.rankNoun}
                </Text>
              </View>

              <PodiumMats rank={rank} width={podiumWidth} />
            </View>
          ) : (
            <View style={[styles.blankBody, showList && styles.blankBodyCompact]}>
              <View style={styles.blankLead}>
                <Text style={styles.blankTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {blankTitle}
                </Text>
                <Text style={styles.blankText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {blankBody}
                </Text>
              </View>

              {showList || state === 'error' ? null : (
                <View style={styles.rules}>
                  <Text style={styles.rulesCaption} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.leaderboards.rulesCaption}
                  </Text>
                  {cs.leaderboards.rules(category, effectivePeriod, hasNickname).map((rule) => (
                    <Text
                      key={rule}
                      style={styles.ruleText}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {rule}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          {state === 'loading' ? <HeroFooterSkeleton reduceMotion={reduceMotion} /> : null}

          {state !== 'loading' && footerLeft ? (
            <View style={styles.heroFooter}>
              <Text
                style={rank != null ? styles.scoreFact : styles.totalFact}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {footerLeft}
              </Text>
              {footerRight ? (
                <Text
                  style={styles.totalFact}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {footerRight}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {showList ? (
          <>
            <Text style={styles.listLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.leaderboards.listLabel}
            </Text>

            <View style={styles.rowsCard}>
              {state === 'loading' ? (
                <RowsSkeleton reduceMotion={reduceMotion} />
              ) : (
                entries.map((entry, index) => (
                  <GlobalBoardRow
                    key={entry.account.id}
                    entry={entry}
                    divided={index > 0}
                    unit={unitFor(category, entry.score)}
                    onPress={
                      entry.isMe || !entry.account.id
                        ? undefined
                        : () => openProfile(entry.account.id)
                    }
                  />
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      <NudgeSlot nudge={nudge} collapseWhenEmpty />

      <CounterCta label={cta.label} onPress={cta.onPress} accessibilityLabel={cta.label} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  /** As a tab there is no chevron to centre against, so the title reads as a
   *  screen title: left-aligned and bigger, like every other tab's. */
  headerTitleEmbedded: {
    textAlign: 'left',
    fontSize: 26,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  pressed: {
    opacity: 0.6,
  },

  // The filter group: track and chips 8 pt apart, 16 pt of air to the card.
  // Related things sit close, unrelated things sit far.
  filters: {
    gap: 8,
    marginBottom: 4,
  },
  periodSlot: {
    minHeight: 32,
    justifyContent: 'center',
  },
  // Mapéři has one window, so the slot states it instead of offering a choice
  // that does nothing. Same height and axis as the chips it replaces.
  periodNote: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  // With no rows the card is the only block on the screen. Stretching it to the
  // full height would just make the hole inside it bigger, so it keeps its own
  // size and sits in the middle instead.
  scrollContentCentered: {
    justifyContent: 'center',
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
    flex: 1,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  rankColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  rank: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  rankNoun: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  // The card's own body when there is no rank to draw: one line that names the
  // situation and one that says what changes it. No numeral, no podium — both
  // would be placeholders for data that does not exist yet.
  blankBody: {
    flex: 1,
    minHeight: 132,
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 12,
    gap: 24,
  },
  // With the board under it the card is a caption, not the screen: it hugs its
  // two lines instead of holding the height the numeral would have needed.
  blankBodyCompact: {
    minHeight: 0,
    paddingBottom: 4,
  },
  blankLead: {
    gap: 8,
  },
  // What a newcomer is actually missing: the rules of the race, in the space
  // the podium would have taken if there were anything to draw on it.
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
});
