/**
 * DESIGN MOCK — the profile, rebuilt as Strava's "You".
 *
 * The Tácek profile stacked a hero card, a level ring, a four-up stat strip, a
 * nudge, a primary CTA and a secondary button — six competing blocks before you
 * reached anything you did. This is the same information in the order Strava
 * uses: who you are, your numbers, then your activities.
 *
 * What went, and why:
 *   level ring       a locked padlock is a screen advertising its own emptiness
 *   "Založ si profil" a CTA is only earned when there is no account (below)
 *   "Pivní fotky"    a button to a place; the photos belong IN the list
 *   nudge strip      one more thing shouting on a screen about your history
 *
 * The only CTA left is sign-in, and only when signed out — that is the one
 * moment the screen genuinely has something to ask for.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { EMPTY_ACHIEVEMENTS } from '@/data/achievements';
import { fetchMyNights, type PublishedNight } from '@/data/nightsClient';
import { FeedCard } from '@/feed/FeedScreen';
import { loadNightFeedCache, saveNightFeedCache } from '@/feed/feedCache';
import { mergeNightPages } from '@/feed/feedModel';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { BarChart } from '@/mocks/BarChart';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Segmented } from '@/mocks/Segmented';
import { StatGrid } from '@/mocks/StatGrid';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { Avatar } from '@/profile/Avatar';
import {
  firstDrinkLabel,
  profileRecords,
  profileSeries,
  type ProfilePeriod,
} from '@/profile/profileStats';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import { useMyStatsState } from '@/stats/useMyStats';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const TABS = ['Statistiky', 'Aktivita'] as const;
const PERIODS: ProfilePeriod[] = ['Týden', 'Měsíc', 'Rok'];

function ProfileActivity({ accountId, reduceMotion }: { accountId: string; reduceMotion: boolean }) {
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const persist = useCallback(
    (nextNights: PublishedNight[], nextCursor: string | null) => {
      void saveNightFeedCache(accountId, 'mine', {
        nights: nextNights,
        nextCursor,
        savedAt: Date.now(),
      });
    },
    [accountId],
  );

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);

    const network = fetchMyNights();
    const cached = await loadNightFeedCache(accountId, 'mine');
    if (currentRequest !== requestId.current) return;
    if (cached && cached.nights.length > 0) {
      setNights(cached.nights);
      setCursor(cached.nextCursor);
      setLoading(false);
    }

    const result = await network;
    if (currentRequest !== requestId.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    setNights(result.nights);
    setCursor(result.nextCursor);
    persist(result.nights, result.nextCursor);
  }, [accountId, persist]);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(kickoff);
      requestId.current += 1;
    };
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const result = await fetchMyNights(cursor);
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    const merged = mergeNightPages(nights ?? [], result.nights);
    setNights(merged);
    setCursor(result.nextCursor);
    setError(null);
    persist(merged, result.nextCursor);
  }, [cursor, loadingMore, nights, persist]);

  if (loading && !nights) {
    return (
      <View style={styles.activityLoading} accessibilityLabel="Načítám tvoje večery">
        <SkeletonBlock width="100%" height={160} reduceMotion={reduceMotion} />
        <SkeletonBlock width="100%" height={160} reduceMotion={reduceMotion} />
      </View>
    );
  }

  if (!nights?.length) {
    return (
      <View style={styles.activityState}>
        <Text style={styles.activityTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {error ? 'Večery se teď nedotáhly' : 'Zatím žádný zveřejněný večer'}
        </Text>
        {error ? (
          <Pressable
            onPress={() => void load()}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Načíst svoje večery znovu"
          >
            <Text style={styles.retryText}>Zkusit znovu</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.activityList}>
      {error ? (
        <Pressable
          onPress={() => void load()}
          style={({ pressed }) => [styles.activityWarning, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Obnovit svoje večery"
        >
          <Text style={styles.activityWarningText}>Jedeš z posledního načtení · Obnovit</Text>
        </Pressable>
      ) : null}
      {nights.map((night, index) => (
        <FeedCard key={night.id} night={night} first={index === 0} />
      ))}
      {cursor ? (
        <Pressable
          onPress={() => void loadMore()}
          disabled={loadingMore}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Načíst starší večery"
        >
          <Text style={styles.moreText}>{loadingMore ? 'Dotahuju…' : 'Starší večery'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ProfileMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Statistiky');
  const [period, setPeriod] = useState<ProfilePeriod>('Týden');
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const { stats, status: statsStatus, retry: retryStats } = useMyStatsState();
  const series = useMemo(() => profileSeries(stats, period), [period, stats]);
  const records = useMemo(() => profileRecords(stats), [stats]);
  // The header follows your finger. With nothing held it shows the whole window.
  const point = scrubbed === null ? null : series.points[scrubbed];
  const totals = point?.totals ?? series.totals;
  const profile = useAccountStore((s) => s.profile);
  const signedIn = useAccountStore(selectIsSignedIn);

  const handle = profile?.nickname
    ? `@${profile.nickname}`
    : profile?.displayName?.trim() || 'Tvůj profil';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* Who you are: a face and a handle. Nothing else competes up here. */}
      <View style={styles.identity}>
        {/* The real photo when there is one, the initial when there is not.
            A stock face is a lie that reads as a bug the moment somebody
            notices it is not them — and most people never set a photo. */}
        <Avatar
          uri={profile?.avatarUrl}
          nickname={profile?.nickname}
          displayName={profile?.displayName}
          size={68}
        />
        <View style={styles.grow}>
          <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {handle}
          </Text>
          <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
            {signedIn ? firstDrinkLabel(stats?.firstDrinkAt) : 'Zatím bez účtu'}
          </Text>
        </View>
      </View>

      {/* Sign-in is the one thing this screen may ask for, and only when there
          is genuinely nothing to ask twice. */}
      {signedIn ? null : (
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Založit profil"
          onPress={() => router.push('/auth' as Href)}
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Založ si profil
          </Text>
        </Pressable>
      )}

      {/* Two jobs, two tabs. Statistiky is the default because a profile is
          first a place you check where you stand; Aktivita is the same posts the
          feed shows, so a night looks identical wherever you meet it. */}
      {signedIn ? <UnderlineTabs
                options={TABS}
                value={tab}
                onChange={setTab}
                inset={MockLayout.screenPad}
              /> : null}

      {signedIn && tab === 'Statistiky' ? (
        <>
          {statsStatus === 'loading' && !stats ? (
            <View style={styles.loading} accessibilityLabel="Načítám statistiky">
              <SkeletonBlock width="100%" height={72} reduceMotion={reduceMotion} />
              <SkeletonBlock width="100%" height={150} reduceMotion={reduceMotion} />
            </View>
          ) : null}
          {statsStatus === 'unavailable' && !stats ? (
            <Pressable
              onPress={retryStats}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Načíst statistiky znovu"
            >
              <Text style={styles.retryText}>Statistiky teď nedotekly. Zkusit znovu</Text>
            </Pressable>
          ) : null}
          {stats ? <>
          {/* Numbers first, then the shape of them, then the control that
              changes both. The segment used to lead, which meant the screen
              opened on a filter rather than on an answer — you look at a profile
              to see where you stand, not to pick a time window. */}
          <View style={styles.totals}>
            <Text style={styles.window} maxFontSizeMultiplier={FontScaleCap.body}>
              {point ? point.label : period}
            </Text>
            <StatGrid columns={4} compact stats={totals} />
          </View>

          <View style={styles.chart}>
            <BarChart points={series.points} onScrub={setScrubbed} />
          </View>

          <View style={styles.periodRow}>
            <Segmented options={PERIODS} value={period} onChange={setPeriod} />
          </View>

          {/* The streak, drawn rather than stated. "3 týdny" is a fact; twelve
              dots with two gaps in them is the thing you actually want to keep
              unbroken, and it shows the misses honestly. */}
          <SectionBreak title="Série" />
          {/* No flame disc. A 38pt amber circle beside the number pulled the eye
              to a decoration instead of to the streak, which is the only thing
              here worth looking at — so the number is the graphic. */}
          <Text style={styles.streakValue} allowFontScaling={false}>
            {stats.timeline?.streak.currentWeeks ?? 0}
            <Text style={styles.streakUnit}> týdny v řadě</Text>
          </Text>
          <Text style={styles.streakBest} maxFontSizeMultiplier={FontScaleCap.body}>
            Nejlepší {stats.timeline?.streak.bestWeeks ?? 0} týdnů
          </Text>
          {/* Columns, not dots: the height says how many nights that week had and
              a gap says you missed it, which is the difference between a streak
              you can read and a row of identical ticks. */}
          <View style={styles.weeks}>
            {(stats.timeline?.weeks ?? []).map((week) => (
              <View key={week.period} style={styles.week}>
                <Text style={styles.weekNights} allowFontScaling={false}>
                  {week.evenings > 0 ? week.evenings : ''}
                </Text>
                <View
                  style={[
                    styles.weekBar,
                    week.evenings > 0
                      ? { height: 10 + Math.min(week.evenings, 4) * 9, backgroundColor: Colors.amber }
                      : styles.weekMiss,
                  ]}
                />
                <Text style={styles.weekLabel} allowFontScaling={false} numberOfLines={1}>
                  {week.period.slice(5).replace('-', '.')}
                </Text>
              </View>
            ))}
          </View>

          <SectionBreak title="Rekordy" />
          {records.map((record) => (
            <View key={record.id} style={styles.record}>
              <View style={styles.grow}>
                <Text
                  style={styles.recordTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {record.title}
                </Text>
                <Text style={styles.recordWhen} maxFontSizeMultiplier={FontScaleCap.body}>
                  {record.when}
                </Text>
              </View>
              <Text style={styles.recordValue} allowFontScaling={false}>
                {record.value}
              </Text>
            </View>
          ))}

          {/* The REAL catalogue, not six invented ones. The app already has
              twenty badges with Czech names and locked hints
              (`badgeCatalog.tsx`), and they are better than anything a mock
              would make up — Štamgast, Noční sova, Poutník, Lahváčový filozof.
              Rendering the shipped grid too, so the mock cannot drift from what
              the profile actually shows. */}
          <SectionBreak title="Odznaky" />
          <AchievementGrid
            mapper={profile?.mapper}
            achievements={profile?.achievements ?? EMPTY_ACHIEVEMENTS}
          />
          </> : null}
        </>
      ) : null}
      {signedIn && tab === 'Aktivita' && profile?.id ? (
        <ProfileActivity accountId={profile.id} reduceMotion={reduceMotion} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.sm },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  handle: { fontSize: 24, fontWeight: '800', color: Colors.foam, letterSpacing: -0.4 },
  since: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },

  cta: {
    height: MockLayout.buttonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    marginTop: Spacing.lg,
  },
  ctaText: { ...MockType.buttonLabel, color: Colors.stout },

  // No rule and no section gap here: the tabs above already draw a baseline and
  // own their own bottom margin, so a second hairline 32pt below the first read
  // as an empty band with a stray line across it.
  totals: { marginTop: Spacing.xs },
  window: { fontSize: 13, fontWeight: '700', color: Colors.amber, marginBottom: Spacing.sm },
  chart: { marginTop: Spacing.xl },
  periodRow: { marginTop: Spacing.lg },
  loading: { gap: Spacing.md, marginTop: Spacing.lg },
  retry: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: Colors.foam, textAlign: 'center' },
  activityLoading: { gap: Spacing.md, marginTop: Spacing.md },
  activityState: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 19, fontWeight: '800', color: Colors.foam, textAlign: 'center' },
  activityList: { marginTop: Spacing.xs },
  activityWarning: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.1),
    marginVertical: Spacing.sm,
  },
  activityWarningText: { fontSize: 12, fontWeight: '700', color: Colors.amber },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '800', color: Colors.amber },

  streakValue: {
    fontFamily: Fonts.numeral,
    fontSize: 40,
    lineHeight: 50,
    color: Colors.foam,
    letterSpacing: -0.5,
    marginTop: Spacing.sm,
  },
  streakUnit: { fontSize: 19, fontWeight: '700', color: Colors.mutedText, letterSpacing: 0 },
  streakBest: { fontSize: 13, fontWeight: '500', color: Colors.mutedText, marginTop: 2 },
  weeks: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: Spacing.lg },
  week: { flex: 1, alignItems: 'center', gap: 4 },
  weekNights: { fontSize: 10, fontWeight: '700', color: Colors.mutedText, height: 13 },
  weekBar: { alignSelf: 'stretch', borderRadius: 4 },
  weekMiss: { height: 6, backgroundColor: withAlpha(Colors.foam, 0.1) },
  weekLabel: { fontSize: 9, fontWeight: '500', color: Colors.mutedText },

  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.08),
  },
  recordTitle: { fontSize: 15, fontWeight: '600', color: Colors.foam },
  recordWhen: { fontSize: 12, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
  recordValue: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
  },

  section: { ...MockType.titleS, color: Colors.foam, marginTop: MockLayout.sectionGap },

});
