/**
 * Global leaderboards — pushed route `/leaderboards` (Žebříčky).
 *
 * Three countrywide boards (Pivaři · Objevitelé · Mapéři) over three windows
 * (week · year · all-time; Mapér is all-time only). The data client remains
 * responsible for per-board caching and force refreshes; this screen only
 * composes that data in the app's Tácek language.
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

import {
  BeerIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  MapPinIcon,
  PencilIcon,
} from '@/components/shared/IconGlyph';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { CounterCta } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import {
  fetchLeaderboard,
  type Leaderboard,
  type LeaderboardCategory,
  type LeaderboardPeriod,
} from '@/data/leaderboardsClient';
import { trackClientEvent } from '@/data/telemetryClient';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { cs } from '@/i18n/cs';
import { GlobalBoardRow } from '@/leaderboards/GlobalBoardRow';
import { PodiumMats } from '@/leaderboards/PodiumMats';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

type LoadState = 'loading' | 'loaded' | 'error';

interface BoardOption {
  key: string;
  category: LeaderboardCategory;
  period: LeaderboardPeriod;
  icon: MoreRow['icon'];
}

const BOARD_OPTIONS: readonly BoardOption[] = [
  { key: 'beers-week', category: 'beers', period: 'week', icon: BeerIcon },
  { key: 'beers-year', category: 'beers', period: 'year', icon: BeerIcon },
  { key: 'beers-all', category: 'beers', period: 'all', icon: BeerIcon },
  { key: 'pubs-week', category: 'pubs', period: 'week', icon: MapPinIcon },
  { key: 'pubs-year', category: 'pubs', period: 'year', icon: MapPinIcon },
  { key: 'pubs-all', category: 'pubs', period: 'all', icon: MapPinIcon },
  { key: 'mapper-all', category: 'mapper', period: 'all', icon: PencilIcon },
];

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

export default function LeaderboardsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const profile = useAccountStore((s) => s.profile);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const { source } = useLocalSearchParams<{ source?: string }>();

  const [category, setCategory] = useState<LeaderboardCategory>('beers');
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [state, setState] = useState<LoadState>('loading');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [heroBodyHeight, setHeroBodyHeight] = useState(0);

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
      const result = await fetchLeaderboard(category, period, { force });
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setBoard(result);
      setState(result ? 'loaded' : 'error');
    },
    [category, period],
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

  const chooseBoard = useCallback(
    (option: BoardOption) => {
      setMoreOpen(false);
      if (option.category === category && option.period === period) return;
      if (hapticEnabled) fireLightImpactHaptic();
      setCategory(option.category);
      setPeriod(option.period);
      setState('loading');
    },
    [category, hapticEnabled, period],
  );

  const tableTitle = cs.leaderboards.tableTitle(category, period);
  const visibleBoard = state === 'loaded' && sameBoard(board, category, period) ? board : null;
  const entries = useMemo(() => visibleBoard?.entries ?? [], [visibleBoard]);
  const me = visibleBoard?.me ?? null;
  const hasNickname = Boolean(profile?.nickname);

  // Only full boards can produce a meaningful gap to their last visible row.
  const chaseGap = useMemo(() => {
    if (!me || me.listed || me.rank == null || entries.length === 0) return 0;
    const lastVisible = entries[entries.length - 1];
    const gap = lastVisible.score - me.score + 1;
    return gap > 0 ? gap : 0;
  }, [entries, me]);

  const moreRows = useMemo<MoreRow[]>(
    () =>
      BOARD_OPTIONS.map((option) => {
        const label = cs.leaderboards.tableTitle(option.category, option.period);
        const selected = option.category === category && option.period === period;
        return {
          key: option.key,
          label,
          icon: option.icon,
          selected,
          onPress: () => chooseBoard(option),
          accessibilityLabel: cs.leaderboards.selectTable(label, selected),
        };
      }),
    [category, chooseBoard, period],
  );

  const nudge = useMemo<Nudge | null>(() => {
    if (state === 'error') {
      return {
        kind: 'counted',
        text: cs.leaderboards.error,
        undoLabel: cs.leaderboards.retry,
        onUndo: retry,
        actionAccessibilityLabel: cs.leaderboards.retry,
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
  }, [category, chaseGap, retry, state]);

  const cta = useMemo(() => {
    if (state === 'error') {
      return {
        label: cs.leaderboards.retry,
        subLabel: cs.leaderboards.retrySub,
        onPress: retry,
      };
    }
    if (me && !me.eligible) {
      return {
        label: hasNickname ? cs.leaderboards.ghostCta : cs.leaderboards.ghostAnonCta,
        subLabel: cs.leaderboards.ghostCtaSub,
        onPress: openVisibility,
      };
    }
    if (category === 'beers') {
      return {
        label: cs.leaderboards.ctaBeers,
        subLabel: cs.leaderboards.ctaBeersSub,
        onPress: () => router.replace('/(tabs)/beer' as Href),
      };
    }
    if (category === 'pubs') {
      return {
        label: cs.leaderboards.ctaPubs,
        subLabel: cs.leaderboards.ctaPubsSub,
        onPress: () => router.replace('/(tabs)' as Href),
      };
    }
    return {
      label: cs.leaderboards.ctaMapper,
      subLabel: cs.leaderboards.ctaMapperSub,
      onPress: () => router.replace('/(tabs)' as Href),
    };
  }, [category, hasNickname, me, openVisibility, retry, router, state]);

  const handleHeroBodyLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setHeroBodyHeight((previous) => (Math.abs(previous - height) > 0.5 ? height : previous));
  }, []);

  const rank = me?.rank ?? null;
  const rankLabel = rank == null ? cs.leaderboards.noRank : rank.toLocaleString('cs-CZ');
  const numeralSize = rankFontSize(rank);
  const podiumWidth =
    heroBodyHeight > 0 ? Math.max(64, Math.min(112, (heroBodyHeight - 16) * 0.66)) : 88;
  const scoreLabel =
    me && me.score > 0
      ? cs.leaderboards.score(category, me.score.toLocaleString('cs-CZ'), me.score)
      : cs.leaderboards.noScore;
  const totalLabel = cs.leaderboards.totalInBoard(
    visibleBoard ? visibleBoard.totalRanked.toLocaleString('cs-CZ') : null,
  );

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
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={cs.leaderboards.back}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>

        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
          accessibilityLabel={cs.leaderboards.tablePickerLabel(category, period)}
        >
          {tableTitle}
        </Text>

        <Pressable
          onPress={() => setMoreOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.leaderboards.openTablePicker}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
        >
          <EllipsisIcon size={20} color={Colors.mutedText} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.amber} />
        }
      >
        <Pressable
          disabled
          accessibilityRole="text"
          accessibilityLabel={cs.leaderboards.heroA11y(
            tableTitle,
            rankLabel,
            scoreLabel,
            visibleBoard?.totalRanked ?? null,
          )}
          style={styles.heroCard}
        >
          <Text
            style={styles.eyebrow}
            numberOfLines={2}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.leaderboards.subtitle(category, category === 'mapper' ? 'all' : period)}
          </Text>

          <View style={styles.heroBody} onLayout={handleHeroBodyLayout}>
            <View style={styles.rankColumn}>
              <Text
                style={[styles.rank, { fontSize: numeralSize, lineHeight: numeralSize * 1.24 }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                maxFontSizeMultiplier={FontScaleCap.display}
              >
                {rankLabel}
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

          <View style={styles.heroFooter}>
            <Text
              style={styles.scoreFact}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {scoreLabel}
            </Text>
            <Text
              style={styles.totalFact}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {totalLabel}
            </Text>
          </View>
        </Pressable>

        <Text style={styles.listLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.leaderboards.listLabel}
        </Text>

        {state === 'loading' ? (
          <View style={styles.rowsCard}>
            {[0, 1, 2].map((item) => (
              <SkeletonBlock
                key={item}
                width="100%"
                height={56}
                reduceMotion={reduceMotion}
              />
            ))}
          </View>
        ) : state === 'loaded' && entries.length === 0 ? (
          <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.leaderboards.empty(category)}
          </Text>
        ) : entries.length > 0 ? (
          <View style={styles.rowsCard}>
            {entries.map((entry, index) => (
              <GlobalBoardRow
                key={entry.account.id}
                entry={entry}
                divided={index > 0}
                unit={unitFor(category, entry.score)}
                onPress={
                  entry.isMe || !entry.account.id ? undefined : () => openProfile(entry.account.id)
                }
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <NudgeSlot nudge={nudge} />

      <CounterCta
        label={cta.label}
        subLabel={cta.subLabel}
        onPress={cta.onPress}
        accessibilityLabel={cta.label}
      />

      <MoreSheet
        visible={moreOpen}
        title={cs.leaderboards.sheetTitle}
        rows={moreRows}
        onClose={() => setMoreOpen(false)}
      />
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
    marginBottom: 8,
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
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 12,
  },

  heroCard: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
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
  heroFooter: {
    marginTop: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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
  emptyText: {
    paddingHorizontal: 12,
    paddingVertical: 24,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
