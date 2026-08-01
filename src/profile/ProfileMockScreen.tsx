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

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrophyIcon } from '@/components/shared/IconGlyph';
import { FeedCard } from '@/feed/FeedMockScreen';
import { MOCK_FEED } from '@/feed/mockFeed';
import { BarChart } from '@/mocks/BarChart';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Segmented } from '@/mocks/Segmented';
import { StatGrid } from '@/mocks/StatGrid';
import { RECORDS, SERIES, STREAK, type StatPeriod } from '@/profile/mockStats';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { useAccountStore } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const AVATAR = 'https://i.pravatar.cc/240?img=57';

const TABS = ['Statistiky', 'Aktivita'] as const;
const PERIODS: StatPeriod[] = ['Týden', 'Měsíc', 'Rok'];

const BADGES = [
  { title: 'Sto piv', earned: true },
  { title: 'Deset hospod', earned: true },
  { title: 'Tři čtvrtky', earned: true },
  { title: 'První Oktoberfest', earned: false },
  { title: 'Padesát večerů', earned: false },
  { title: 'Mapér', earned: false },
];

export default function ProfileMockScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Statistiky');
  const [period, setPeriod] = useState<StatPeriod>('Týden');
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const series = SERIES[period];
  // The header follows your finger. With nothing held it shows the whole window.
  const point = scrubbed === null ? null : series.points[scrubbed];
  const totals = point?.totals ?? series.totals;
  const session = useAccountStore((s) => s.session);
  const profile = useAccountStore((s) => s.profile);
  const signedIn = Boolean(session);

  const handle = profile?.nickname ? `@${profile.nickname}` : '@sudík';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* Who you are: a face and a handle. Nothing else competes up here. */}
      <View style={styles.identity}>
        <Image source={{ uri: AVATAR }} style={styles.avatar} />
        <View style={styles.grow}>
          <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {handle}
          </Text>
          <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
            {signedIn ? 'Pije s Na pivo od června' : 'Zatím bez účtu'}
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
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Založ si profil
          </Text>
        </Pressable>
      )}

      {/* Two jobs, two tabs. Statistiky is the default because a profile is
          first a place you check where you stand; Aktivita is the same posts the
          feed shows, so a night looks identical wherever you meet it. */}
      <View style={styles.tabs}>
        {TABS.map((option) => (
          <Pressable
            key={option}
            onPress={() => setTab(option)}
            style={styles.tab}
            accessibilityRole="button"
            accessibilityState={{ selected: option === tab }}
            accessibilityLabel={option}
          >
            <Text
              style={[styles.tabText, option === tab && styles.tabTextOn]}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {option}
            </Text>
            <View style={[styles.tabRule, option === tab && styles.tabRuleOn]} />
          </Pressable>
        ))}
      </View>

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
            {STREAK.current}
            <Text style={styles.streakUnit}> týdny v řadě</Text>
          </Text>
          <Text style={styles.streakBest} maxFontSizeMultiplier={FontScaleCap.body}>
            Nejlepší {STREAK.best} týdnů · {STREAK.weeks.reduce((sum, w) => sum + w.nights, 0)}{' '}
            večerů za {STREAK.weeks.length} týdnů
          </Text>
          {/* Columns, not dots: the height says how many nights that week had and
              a gap says you missed it, which is the difference between a streak
              you can read and a row of identical ticks. */}
          <View style={styles.weeks}>
            {STREAK.weeks.map((week) => (
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
          {RECORDS.map((record) => (
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

          <SectionBreak title="Odznaky" />
          <View style={styles.badges}>
            {BADGES.map((badge) => (
              <View key={badge.title} style={[styles.badge, !badge.earned && styles.badgeLocked]}>
                <View style={[styles.badgeDisc, !badge.earned && styles.badgeDiscLocked]}>
                  <TrophyIcon size={18} color={badge.earned ? Colors.stout : Colors.mutedText} />
                </View>
                <Text
                  style={[styles.badgeTitle, !badge.earned && styles.badgeTitleLocked]}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {badge.title}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        MOCK_FEED.map((entry) => <FeedCard key={entry.id} entry={entry} />)
      )}

      <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
        Design mock — data jsou napevno.
      </Text>
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

  totals: {
    marginTop: MockLayout.sectionGap,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  window: { fontSize: 13, fontWeight: '700', color: Colors.amber, marginBottom: Spacing.sm },
  chart: { marginTop: Spacing.xl },
  periodRow: { marginTop: Spacing.lg },

  streakValue: {
    fontSize: 40,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -1.2,
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

  tabs: { flexDirection: 'row', marginTop: MockLayout.sectionGap },
  tab: { flex: 1, alignItems: 'center', gap: 6 },
  tabText: { fontSize: 17, fontWeight: '600', color: Colors.mutedText },
  tabTextOn: { color: Colors.foam, fontWeight: '700' },
  tabRule: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent', borderRadius: 1 },
  tabRuleOn: { backgroundColor: Colors.amber },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.sm },
  badge: { width: '28%', alignItems: 'center', gap: 6 },
  badgeLocked: { opacity: 0.45 },
  badgeDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  badgeDiscLocked: { backgroundColor: withAlpha(Colors.foam, 0.08) },
  badgeTitle: { fontSize: 12, fontWeight: '600', color: Colors.foam, textAlign: 'center' },
  badgeTitleLocked: { color: Colors.mutedText },


  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
