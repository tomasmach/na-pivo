/**
 * DESIGN MOCK — somebody else's profile.
 *
 * Same object as your own profile, seen from outside: a face, a handle, the
 * numbers, the nights. Deliberately NOT a different screen design — a person
 * should look like a person wherever you meet them, and a stranger's page that
 * is laid out differently from yours reads as a different product.
 *
 * What changes when the profile is not yours:
 *
 *   - the identity block gains the relationship: whether you follow them, and
 *     how many nights you have actually been out together. That number is the
 *     honest version of "mutual friends" in a pub app;
 *   - two actions instead of none — follow, and "Na pivo?", which is the only
 *     thing this product really wants you to do with another person;
 *   - no records, no streak. Your own profile shows those to push YOU; on
 *     someone else's page a streak is a stat about their drinking that they did
 *     not choose to publish, and this app does not build that.
 *
 * Privacy (`AGENTS.md`): nothing here is derived from where they are, only from
 * what they published. Pub counts are aggregates — "12 hospod", never the list
 * of which ones, because a list of somebody's regular pubs is a schedule.
 */

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BeerIcon, CheckIcon, ChevronLeftIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { FeedCard } from '@/feed/FeedMockScreen';
import { MOCK_FEED } from '@/feed/mockFeed';
import { BarChart } from '@/mocks/BarChart';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Segmented } from '@/mocks/Segmented';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { MOCK_ACHIEVEMENTS, SERIES, type StatPeriod } from '@/profile/mockStats';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** Placeholder face — `pravatar.cc` is stock photography and MUST NOT ship. */
const AVATAR = 'https://i.pravatar.cc/240?img=41';

const TABS = ['Statistiky', 'Aktivita'] as const;
const PERIODS: StatPeriod[] = ['Týden', 'Měsíc', 'Rok'];

/** How many nights you two have actually shared. Mock — the real number comes
 *  from parties you were both in. */
const TOGETHER = 4;

export default function PublicProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ handle?: string }>();
  const handle = params.handle ? `@${params.handle}` : '@pěna';

  const [tab, setTab] = useState<(typeof TABS)[number]>('Statistiky');
  const [period, setPeriod] = useState<StatPeriod>('Měsíc');
  const [following, setFollowing] = useState(false);
  const series = SERIES[period];

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpět"
          hitSlop={8}
        >
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <Image source={{ uri: AVATAR }} style={styles.avatar} />
          <View style={styles.grow}>
            <Text
              style={styles.handle}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {handle}
            </Text>
            {/* The honest version of "12 mutual friends": how many evenings you
                two have actually shared. It is the only social number in this
                product that means anything. */}
            <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
              {TOGETHER > 0 ? `Byli jste spolu ${TOGETHER}× na pivu` : 'Ještě jste spolu nebyli'}
            </Text>
          </View>
        </View>

        {/* Two actions, and the second one is the point of the app. Following
            someone means their nights show up in Kocoviny; "Na pivo?" is the
            thing you actually came here to do. */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => setFollowing((current) => !current)}
            style={({ pressed }) => [
              styles.action,
              following ? styles.actionOn : styles.actionPrimary,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: following }}
            accessibilityLabel={following ? `Sleduješ ${handle}` : `Sledovat ${handle}`}
          >
            {following ? (
              <CheckIcon size={17} color={Colors.amber} />
            ) : (
              <PlusIcon size={17} color={Colors.stout} />
            )}
            <Text
              style={[styles.actionText, following && styles.actionTextOn]}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {following ? 'Sleduješ' : 'Sledovat'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.action, styles.actionGhost, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Pozvat ${handle} na pivo`}
          >
            <BeerIcon size={17} color={Colors.foam} />
            <Text
              style={[styles.actionText, styles.actionTextGhost]}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              Na pivo?
            </Text>
          </Pressable>
        </View>

        <UnderlineTabs
          options={TABS}
          value={tab}
          onChange={setTab}
          inset={MockLayout.screenPad}
        />

        {tab === 'Statistiky' ? (
          <>
            {/* Aggregates only. "12 hospod" is a fact about how much they get
                out; the list of WHICH twelve is a schedule, and this app does
                not hand one person another person's schedule. */}
            <View style={styles.totals}>
              <Text style={styles.window} maxFontSizeMultiplier={FontScaleCap.body}>
                {period}
              </Text>
              <StatGrid columns={4} compact stats={series.totals} />
            </View>

            <View style={styles.chart}>
              <BarChart points={series.points} />
            </View>

            <View style={styles.periodRow}>
              <Segmented options={PERIODS} value={period} onChange={setPeriod} />
            </View>

            {/* Badges yes, streak and records no: a badge is something they
                earned and chose to wear, a streak is a running tally of another
                person's drinking. */}
            <SectionBreak title="Odznaky" />
            <AchievementGrid mapper={undefined} achievements={MOCK_ACHIEVEMENTS} />
          </>
        ) : (
          MOCK_FEED.map((entry) => <FeedCard key={entry.id} entry={entry} />)
        )}

        <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
          Design mock — data jsou napevno.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  content: { paddingHorizontal: MockLayout.screenPad },

  top: { paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.sm },
  back: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },

  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.stout3 },
  handle: { ...MockType.titleXL, fontSize: 26, color: Colors.foam },
  since: { fontSize: 14, fontWeight: '500', color: Colors.mutedText, marginTop: 2 },

  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: Radius.pill,
  },
  actionPrimary: { backgroundColor: Colors.amber },
  actionOn: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  actionGhost: { backgroundColor: withAlpha(Colors.foam, 0.09) },
  actionText: { fontSize: 15, fontWeight: '800', color: Colors.stout },
  actionTextOn: { color: Colors.amber },
  actionTextGhost: { color: Colors.foam },

  totals: { marginTop: Spacing.lg, gap: Spacing.sm },
  window: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  chart: { marginTop: Spacing.lg },
  periodRow: { marginTop: Spacing.lg },

  mockNote: {
    marginTop: Spacing.xl,
    fontSize: 12,
    fontWeight: '500',
    color: withAlpha(Colors.mutedText, 0.7),
  },
});
