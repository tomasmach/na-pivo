/**
 * Global leaderboards — pushed route `/leaderboards` (Žebříčky).
 *
 * Three countrywide boards (Pivaři · Objevitelé · Mapéři) over three windows
 * (Týden · Rok · Celkem; Mapér is all-time only). Only public profiles are
 * listed — a private user still sees their own would-be rank plus the "ukaž
 * se" nudge, which is the screen's quiet conversion lever. Rows push the
 * public profile at `/parta/<id>`, where a stranger can be added to the party.
 *
 * The week window resets every Monday, which is the retention loop: a fresh,
 * winnable race each week instead of one frozen all-time podium.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { GlowButton } from '@/components/shared/GlowButton';
import {
  ChevronLeftIcon,
  EyeOffIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import {
  fetchLeaderboard,
  type BoardEntry,
  type Leaderboard,
  type LeaderboardCategory,
  type LeaderboardPeriod,
} from '@/data/leaderboardsClient';
import { trackClientEvent } from '@/data/telemetryClient';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { GlobalBoardRow } from '@/leaderboards/GlobalBoardRow';
import BoardSegmented from '@/leaderboards/BoardSegmented';
import PeriodChips from '@/leaderboards/PeriodChips';
import { cs } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

type LoadState = 'loading' | 'loaded' | 'error';

const CATEGORIES: readonly LeaderboardCategory[] = ['beers', 'pubs', 'mapper'];
const PERIODS: readonly { key: LeaderboardPeriod; label: string }[] = [
  { key: 'week', label: cs.leaderboards.periodWeek },
  { key: 'year', label: cs.leaderboards.periodYear },
  { key: 'all', label: cs.leaderboards.periodAll },
];

/** Unit caption for a score, declined for the count where the unit is a noun. */
function unitFor(category: LeaderboardCategory, score: number): string {
  if (category === 'beers') return cs.leaderboards.unitBeers(score);
  if (category === 'pubs') return cs.leaderboards.unitPubs(score);
  return cs.leaderboards.unitXp;
}

export default function LeaderboardsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const profile = useAccountStore((s) => s.profile);

  const [category, setCategory] = useState<LeaderboardCategory>('beers');
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [state, setState] = useState<LoadState>('loading');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    void trackClientEvent({ event: 'leaderboards_opened' });
  }, []);

  // Remember the requested pair so a stale response can never win the race
  // against a quick category/period flip.
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

  const switchCategory = useCallback((index: number) => {
    const next = CATEGORIES[index] ?? 'beers';
    setCategory(next);
    setState('loading');
  }, []);

  const switchPeriod = useCallback((next: LeaderboardPeriod) => {
    setPeriod(next);
    setState('loading');
  }, []);

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

  const categoryIndex = CATEGORIES.indexOf(category);
  const showPeriods = category !== 'mapper';
  const subtitle = cs.leaderboards.subtitle(category, category === 'mapper' ? 'all' : period);

  const entries = useMemo(() => board?.entries ?? [], [board]);
  const me = board?.me ?? null;

  // My pinned row under the list when I'm ranked but outside the visible top.
  const pinnedMe: BoardEntry | null = useMemo(() => {
    if (!me || me.listed || me.rank == null) return null;
    return {
      rank: me.rank,
      score: me.score,
      isMe: true,
      isFriend: false,
      account: {
        id: profile?.id ?? '',
        nickname: profile?.nickname ?? null,
        displayName: profile?.displayName ?? '',
        avatarUrl: profile?.avatarUrl ?? null,
      },
    };
  }, [me, profile]);

  // "Do top žebříčku ti chybí X" — only when the board is full and I trail it.
  const chaseGap = useMemo(() => {
    if (!me || me.listed || me.rank == null || entries.length === 0) return 0;
    const lastVisible = entries[entries.length - 1];
    const gap = lastVisible.score - me.score + 1;
    return gap > 0 ? gap : 0;
  }, [entries, me]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      {/* Header — back · centred title · spacer */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.claimBack}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.leaderboards.title}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.controls}>
        <BoardSegmented
          options={[
            cs.leaderboards.categoryBeers,
            cs.leaderboards.categoryPubs,
            cs.leaderboards.categoryMapper,
          ]}
          value={categoryIndex < 0 ? 0 : categoryIndex}
          onChange={switchCategory}
          accessibilityLabel={cs.a11y.leaderboardCategory}
        />
        {showPeriods ? (
          <PeriodChips
            options={PERIODS}
            value={period}
            onChange={switchPeriod}
            accessibilityLabel={cs.a11y.leaderboardPeriod}
          />
        ) : (
          <Text style={styles.mapperWindowNote} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.leaderboards.mapperAllTimeNote}
          </Text>
        )}
        <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {subtitle}
        </Text>
      </View>

      {state === 'error' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.leaderboards.error}
          </Text>
          <View style={styles.errorCta}>
            <GlowButton
              label={cs.friends.retry}
              onPress={retry}
              variant="secondary"
              glow="none"
              height={50}
            />
          </View>
        </View>
      ) : state === 'loading' ? (
        <View style={styles.loadingWrap}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonBlock key={i} width="100%" height={52} reduceMotion={reduceMotion} />
          ))}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.amber} />
          }
        >
          {entries.length === 0 ? (
            <View style={styles.emptyBlock}>
              <TrophyIcon size={32} color={Colors.mutedText} />
              <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.leaderboards.empty(category)}
              </Text>
            </View>
          ) : (
            <View>
              {entries.map((entry) => (
                <GlobalBoardRow
                  key={entry.account.id}
                  entry={entry}
                  unit={unitFor(category, entry.score)}
                  onPress={
                    entry.isMe || !entry.account.id
                      ? undefined
                      : () => openProfile(entry.account.id)
                  }
                />
              ))}

              {pinnedMe ? (
                <>
                  <Text
                    style={styles.dividerDots}
                    allowFontScaling={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    …
                  </Text>
                  <GlobalBoardRow entry={pinnedMe} unit={unitFor(category, pinnedMe.score)} />
                  {chaseGap > 0 ? (
                    <Text style={styles.chaseLine} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.leaderboards.chase(category, chaseGap)}
                    </Text>
                  ) : null}
                </>
              ) : me && !me.listed && me.rank == null ? (
                <Text style={styles.noScoreLine} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.leaderboards.meNoScore(category)}
                </Text>
              ) : null}
            </View>
          )}

          {/* Ghost nudge — private profiles race invisibly. */}
          {me && !me.eligible ? (
            <View style={styles.ghostCard}>
              <View style={styles.ghostHeadRow}>
                <EyeOffIcon size={18} color={Colors.amber} />
                <Text style={styles.ghostTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {cs.leaderboards.ghostTitle}
                </Text>
              </View>
              <Text style={styles.ghostBody} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.leaderboards.ghostBody}
              </Text>
              <GlowButton
                label={cs.leaderboards.ghostCta}
                onPress={openVisibility}
                variant="secondary"
                glow="none"
                height={46}
              />
            </View>
          ) : null}

          {board && board.totalRanked > 0 ? (
            <Text style={styles.footerLine} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.leaderboards.totalRanked(board.totalRanked)}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  headerBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  dim: {
    opacity: 0.6,
  },

  controls: {
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  mapperWindowNote: {
    textAlign: 'center',
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  subtitle: {
    textAlign: 'center',
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },

  content: {
    paddingTop: Spacing.md,
  },

  // — Loading / error —
  loadingWrap: {
    gap: Spacing.sm,
    paddingTop: Spacing.lg,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  errorCta: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.xl,
  },

  // — Empty board —
  emptyBlock: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xxl,
  },
  emptyText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },

  // — My pinned row + chase line —
  dividerDots: {
    textAlign: 'center',
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.mutedText,
    paddingVertical: 2,
  },
  chaseLine: {
    marginTop: Spacing.sm,
    textAlign: 'center',
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  noScoreLine: {
    marginTop: Spacing.md,
    textAlign: 'center',
    fontFamily: Fonts.ui.medium,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
  },

  // — Ghost (private profile) nudge —
  ghostCard: {
    marginTop: Spacing.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.7),
  },
  ghostHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ghostTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  ghostBody: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.foamMuted,
  },

  footerLine: {
    marginTop: Spacing.xl,
    textAlign: 'center',
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
});
