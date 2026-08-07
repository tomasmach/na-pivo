/** The 3.0 profile layout backed by the private diary and published nights. */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import SkeletonBlock from '@/friends/SkeletonBlock';
import { Face, FeedCard } from '@/feed/FeedMockScreen';
import type { FeedEntry } from '@/feed/mockFeed';
import { fetchNightsFeed, type PublishedNight } from '@/data/nightsClient';
import { EMPTY_ACHIEVEMENTS } from '@/data/achievements';
import { cs } from '@/i18n/cs';
import { BarChart } from '@/mocks/BarChart';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Segmented } from '@/mocks/Segmented';
import { StatGrid } from '@/mocks/StatGrid';
import { AchievementGrid } from '@/profile/AchievementGrid';
import type { StatPeriod } from '@/profile/mockStats';
import {
  buildProfileDiary,
  computeProfileRecords,
  computeProfileSeries,
  computeProfileStreak,
} from '@/profile/profileStats';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import { useTallyStore } from '@/stores/tallyStore';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

const TABS = ['Statistiky', 'Aktivita'] as const;
const PERIODS: StatPeriod[] = ['Týden', 'Měsíc', 'Rok'];

const MONTH_GENITIVE = [
  'ledna',
  'února',
  'března',
  'dubna',
  'května',
  'června',
  'července',
  'srpna',
  'září',
  'října',
  'listopadu',
  'prosince',
];

function memberSince(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return null;
  return `Pije s Na pivo od ${MONTH_GENITIVE[date.getMonth()]} ${date.getFullYear()}`;
}

function durationLabel(minutes: number | null, startedAt: string, endedAt: string): string {
  const derived = (Date.parse(endedAt) - Date.parse(startedAt)) / 60_000;
  const value = minutes ?? (Number.isFinite(derived) ? derived : 0);
  const rounded = Math.max(0, Math.round(value));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

function nightToFeedEntry(night: PublishedNight): FeedEntry {
  const name = night.author.nickname
    ? `@${night.author.nickname}`
    : night.author.displayName || cs.profile.noDisplayName;
  const pubs = night.pubNames.length > 0 ? night.pubNames : ['Mimo hospodu'];
  const date = new Date(night.startedAt);
  const when = Number.isFinite(date.getTime())
    ? date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
    : night.drinkingDay;
  return {
    id: night.id,
    author: name,
    authorTint: Colors.amber,
    when,
    title: pubs.join(' → '),
    stops: pubs.map((name) => ({ name, lat: 0, lng: 0 })),
    beers: night.beerCount,
    duration: durationLabel(night.durationMinutes, night.startedAt, night.endedAt),
    people: [{ name, tint: Colors.amber, avatar: night.author.avatarUrl ?? '' }],
    photos: 0,
    cheers: night.rounds,
    comments: 0,
    cheered: night.myRound,
    highlight: { kind: 'record', title: 'Večer ve Výčepu', detail: pubs.join(' → ') },
    durationMinutes: night.durationMinutes ?? 0,
    games: 0,
    gamesWon: 0,
    usualPerHour: null,
    visitsToSamePub: 0,
  };
}

export default function ProfileMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Statistiky');
  const [period, setPeriod] = useState<StatPeriod>('Týden');
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const [activitySnapshot, setActivitySnapshot] = useState<{
    accountId: string;
    nights: PublishedNight[] | null;
  } | null>(null);
  const session = useAccountStore((state) => state.session);
  const profile = useAccountStore((s) => s.profile);
  const signedIn = useAccountStore(selectIsSignedIn);
  const diarySnapshot = useAccountStore((state) => {
    const snapshot = state.diarySnapshot;
    return snapshot && snapshot.accountId === state.session?.accountId ? snapshot.data : null;
  });
  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const entries = useMemo(
    () => buildProfileDiary(current, history, diarySnapshot),
    [current, diarySnapshot, history],
  );
  const allSeries = useMemo(() => computeProfileSeries(entries), [entries]);
  const streak = useMemo(() => computeProfileStreak(entries), [entries]);
  const records = useMemo(() => computeProfileRecords(entries), [entries]);
  const series = allSeries[period];
  const point = scrubbed === null ? null : series.points[scrubbed];
  const totals = point?.totals ?? series.totals;

  const handle = signedIn
    ? profile?.nickname
      ? `@${profile.nickname}`
      : cs.profile.noDisplayName
    : cs.profile.noAccountNick;
  const since = signedIn ? memberSince(profile?.createdAt) : cs.profile.noAccountNick;
  const activity =
    activitySnapshot && activitySnapshot.accountId === session?.accountId
      ? activitySnapshot.nights
      : undefined;

  useEffect(() => {
    const accountId = session?.accountId;
    if (tab !== 'Aktivita' || !accountId || activitySnapshot?.accountId === accountId) return;
    let active = true;
    void fetchNightsFeed('mine').then((result) => {
      if (!active) return;
      setActivitySnapshot({ accountId, nights: result.ok ? result.nights : null });
    });
    return () => {
      active = false;
    };
  }, [activitySnapshot?.accountId, session?.accountId, tab]);

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
        <Face name={handle} tint={Colors.amber} avatar={profile?.avatarUrl ?? undefined} size={68} />
        <View style={styles.grow}>
          <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {handle}
          </Text>
          <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
            {since ?? 'Načítám profil…'}
          </Text>
        </View>
      </View>

      {/* Sign-in is the one thing this screen may ask for, and only when there
          is genuinely nothing to ask twice. */}
      {signedIn ? null : (
        <Pressable
          onPress={() => router.push('/auth' as Href)}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Založit profil"
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Založ si profil
          </Text>
        </Pressable>
      )}

      {/* Two jobs, two tabs. Statistiky is the default because a profile is
          first a place you check where you stand; Aktivita is the same posts the
          feed shows, so a night looks identical wherever you meet it. */}
      <UnderlineTabs
        options={TABS}
        value={tab}
        onChange={setTab}
        inset={MockLayout.screenPad}
      />

      {tab === 'Statistiky' ? (
        <>
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
            {streak.current}
            <Text style={styles.streakUnit}> týdny v řadě</Text>
          </Text>
          <Text style={styles.streakBest} maxFontSizeMultiplier={FontScaleCap.body}>
            Nejlepší {streak.best} týdnů · {streak.weeks.reduce((sum, w) => sum + w.nights, 0)}{' '}
            večerů za {streak.weeks.length} týdnů
          </Text>
          {/* Columns, not dots: the height says how many nights that week had and
              a gap says you missed it, which is the difference between a streak
              you can read and a row of identical ticks. */}
          <View style={styles.weeks}>
            {streak.weeks.map((week) => (
              <View key={week.label} style={styles.week}>
                <Text style={styles.weekNights} allowFontScaling={false}>
                  {week.nights > 0 ? week.nights : ''}
                </Text>
                <View
                  style={[
                    styles.weekBar,
                    week.nights > 0
                      ? { height: 10 + week.nights * 9, backgroundColor: Colors.amber }
                      : styles.weekMiss,
                  ]}
                />
                <Text style={styles.weekLabel} allowFontScaling={false} numberOfLines={1}>
                  {week.label}
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
        </>
      ) : (
        activity !== undefined && activity !== null ? (
          activity.length > 0 ? (
            activity.map((night) => <FeedCard key={night.id} entry={nightToFeedEntry(night)} />)
          ) : (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
              Zatím jsi žádný večer nezveřejnil.
            </Text>
          )
        ) : activity === null ? (
          <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
            Výčep teď nedotáhl tvoje večery. Zkus to za chvíli.
          </Text>
        ) : (
          <View style={styles.activitySkeleton}>
            <SkeletonBlock width={44} height={44} radius={Radius.pill} reduceMotion={reduceMotion} />
            <View style={styles.grow}>
              <SkeletonBlock width="48%" height={15} reduceMotion={reduceMotion} />
              <View style={styles.skeletonGap} />
              <SkeletonBlock width="72%" height={22} reduceMotion={reduceMotion} />
            </View>
          </View>
        )
      )}
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



  empty: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
  activitySkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  skeletonGap: { height: Spacing.sm },
});
