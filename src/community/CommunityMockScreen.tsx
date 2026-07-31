/**
 * DESIGN MOCK — Komunita: challenges, standings and what is on.
 *
 * Three top-level sections, because they are three different jobs:
 *
 *   Výzvy      something to chase this month
 *   Žebříčky   where you stand
 *   Akce       what is happening near you
 *
 * Built as its own screen rather than by injecting sections into the real
 * `LeaderboardsScreen`: that screen owns a root View, a manual safe-area inset
 * and a pinned CTA, all of which fight a native large title (which needs the
 * screen's ScrollView to be the root).
 *
 * Inside Žebříčky there is ONE board, filtered by two chips — the metric and
 * the window. The previous version showed a segmented control AND a period row,
 * two controls in two different voices asking two questions, which is exactly
 * what the design system's §14.2 warns about.
 *
 * The top three get a podium. A leaderboard where first place looks like sixth
 * is a table, not a ranking.
 *
 * People suggestions are NOT here any more — they belong in search, where you
 * are already looking for someone.
 */

import React, { useState } from 'react';
import { ActionSheetIOS, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  ChevronDownIcon,
  ChevronRightIcon,
  SparklesIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
// Shared with the detail screen, so the card you tap and the screen you land on
// can never show different numbers.
import { CHALLENGES } from '@/community/mockChallenges';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const SECTIONS = ['Žebříčky', 'Výzvy', 'Akce'] as const;
const METRICS = ['Piva', 'Hospody', 'Mapér XP'] as const;

/** A bare 31 does not say what it counts. The chip picks the metric, so the
 *  unit follows it rather than being hard-coded next to the numeral. */
const UNITS: Record<string, string> = { Piva: 'piv', Hospody: 'hospod', 'Mapér XP': 'XP' };
const PERIODS = ['Týden', 'Letos', 'Celkem'] as const;

const AVATARS = 'https://i.pravatar.cc/160?img=';

const ROWS = [
  { rank: 1, handle: '@sudík', score: 31, avatar: `${AVATARS}57` },
  { rank: 2, handle: '@chmelák', score: 27, avatar: `${AVATARS}50` },
  { rank: 3, handle: '@pěna', score: 24, avatar: `${AVATARS}41` },
  { rank: 4, handle: '@klárka', score: 19, avatar: `${AVATARS}64` },
  { rank: 5, handle: '@ty', score: 17, avatar: `${AVATARS}12`, me: true },
  { rank: 6, handle: '@mišák', score: 14, avatar: `${AVATARS}26` },
];

const EVENTS = [
  { id: 'e1', title: 'Pivní slavnosti Žižkov', when: 'so 2. 8.', where: 'Parukářka' },
  { id: 'e2', title: 'Tankové pivo u Fleků', when: 'pá 8. 8.', where: 'U Fleků' },
  { id: 'e3', title: 'Pub kvíz', when: 'čt 14. 8.', where: 'Zlý časy' },
];

/** A chip that opens a native picker. One question, one answer. */
function FilterChip({
  value,
  options,
  title,
  onChange,
}: {
  value: string;
  options: readonly string[];
  title: string;
  onChange: (next: string) => void;
}) {
  const open = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...options, 'Zrušit'], cancelButtonIndex: options.length, title, userInterfaceStyle: 'dark' },
      (index) => {
        if (index < options.length) onChange(options[index]);
      },
    );
  };

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
    >
      <Text style={styles.chipText} allowFontScaling={false}>
        {value}
      </Text>
      <ChevronDownIcon size={14} color={Colors.amber} />
    </Pressable>
  );
}

/** The podium — first place has to look like first place. */
function Podium({ rows, unit }: { rows: typeof ROWS; unit: string }) {
  const order = [rows[1], rows[0], rows[2]].filter(Boolean);
  const heights = [64, 84, 56];

  return (
    <View style={styles.podium}>
      {order.map((row, index) => (
        <View key={row.handle} style={styles.podiumCol}>
          <Image
            source={{ uri: row.avatar }}
            style={[styles.podiumAvatar, index === 1 && styles.podiumAvatarFirst]}
          />
          <Text
            style={[styles.podiumHandle, index === 1 && styles.podiumHandleFirst]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {row.handle}
          </Text>
          <Text style={styles.podiumScore} allowFontScaling={false}>
            {row.score}
            <Text style={styles.podiumUnit}> {unit}</Text>
          </Text>
          <View style={[styles.podiumBlock, { height: heights[index] }, index === 1 && styles.podiumBlockFirst]}>
            <Text style={styles.podiumRank} allowFontScaling={false}>
              {row.rank}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function CommunityMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Žebříčky');
  const [metric, setMetric] = useState<string>(METRICS[0]);
  const [period, setPeriod] = useState<string>(PERIODS[0]);

  const rest = ROWS.slice(3);
  const top = ROWS[0]?.score ?? 1;

  return (
    // Root ScrollView: react-native-screens binds the native large title to the
    // screen's scrollable, and a wrapping View hides it.
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.tabs}>
        {SECTIONS.map((option) => (
          <Pressable
            key={option}
            onPress={() => setSection(option)}
            style={styles.tab}
            accessibilityRole="button"
            accessibilityState={{ selected: option === section }}
            accessibilityLabel={option}
          >
            <Text
              style={[styles.tabText, option === section && styles.tabTextOn]}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {option}
            </Text>
            <View style={[styles.tabRule, option === section && styles.tabRuleOn]} />
          </Pressable>
        ))}
      </View>

      {section === 'Žebříčky' ? (
        <>
          <View style={styles.chips}>
            <FilterChip value={metric} options={METRICS} title="Podle čeho" onChange={setMetric} />
            <FilterChip value={period} options={PERIODS} title="Za jaké období" onChange={setPeriod} />
          </View>

          <Podium rows={ROWS} unit={UNITS[metric] ?? ''} />

          {rest.map((row) => (
            <View key={row.handle} style={[styles.row, row.me && styles.rowMe]}>
              <Text style={styles.rank} allowFontScaling={false}>
                {row.rank}
              </Text>
              <Image source={{ uri: row.avatar }} style={styles.rowAvatar} />
              <View style={styles.body}>
                <Text
                  style={[styles.handle, row.me && styles.handleMe]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {row.handle}
                </Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.max(6, Math.round((row.score / top) * 100))}%`,
                        backgroundColor: row.me ? Colors.amber : withAlpha(Colors.amber, 0.35),
                      },
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.score} allowFontScaling={false}>
                {row.score}
                <Text style={styles.scoreUnit}> {UNITS[metric] ?? ''}</Text>
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {/* Challenges are cards, not rows: each one is a thing you are IN, with a
          detail behind it. A row would file them next to the leaderboard's
          entries, which is a different kind of object. */}
      {section === 'Výzvy'
        ? CHALLENGES.map((challenge) => (
            <Pressable
              key={challenge.id}
              onPress={() => router.push(`/community/challenge/${challenge.id}` as Href)}
              style={({ pressed }) => [styles.challenge, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={challenge.title}
            >
              <View style={styles.challengeHead}>
                <View style={styles.medallion}>
                  <SparklesIcon size={17} color={Colors.amber} />
                </View>
                <View style={styles.grow}>
                  <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                    {challenge.title}
                  </Text>
                  <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
                    {challenge.detail}
                  </Text>
                </View>
                <ChevronRightIcon size={18} color={Colors.mutedText} />
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${challenge.progress * 100}%`, backgroundColor: Colors.amber },
                  ]}
                />
              </View>
            </Pressable>
          ))
        : null}

      {section === 'Akce'
        ? EVENTS.map((event, index) => (
            <View key={event.id} style={[styles.row, index === 0 && styles.rowFirst]}>
              <View style={styles.medallion}>
                <TrophyIcon size={17} color={Colors.amber} />
              </View>
              <View style={styles.body}>
                <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {event.title}
                </Text>
                <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
                  {event.when} · {event.where}
                </Text>
              </View>
            </View>
          ))
        : null}

      <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
        Design mock — data jsou napevno.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  pressed: { opacity: 0.65 },

  // — Section tabs (underline, like iOS segmented pages) —
  // Full width, equal columns — three sections of one screen, not a row of
  // links that happens to start on the left.
  tabs: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', gap: 6 },
  tabText: { fontSize: 17, fontWeight: '600', color: Colors.mutedText },
  tabTextOn: { color: Colors.foam, fontWeight: '700' },
  tabRule: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent', borderRadius: 1 },
  tabRuleOn: { backgroundColor: Colors.amber },

  chips: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: MockLayout.pillHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  chipText: { fontSize: 14, fontWeight: '600', color: Colors.amber },

  // — Podium —
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    marginTop: MockLayout.sectionGap,
    marginBottom: Spacing.md,
  },
  podiumCol: { flex: 1, alignItems: 'center', gap: 3 },
  podiumAvatar: { width: 46, height: 46, borderRadius: 23 },
  podiumAvatarFirst: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  podiumHandle: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  podiumHandleFirst: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  podiumScore: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  podiumBlock: {
    alignSelf: 'stretch',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    paddingTop: 6,
    marginTop: 4,
  },
  podiumBlockFirst: { backgroundColor: withAlpha(Colors.amber, 0.34) },
  podiumUnit: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  podiumRank: { fontSize: 15, fontWeight: '800', color: Colors.amber },

  // — Rest of the board / challenges / events —
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: { borderTopWidth: 0, marginTop: Spacing.lg },
  rowMe: { borderTopColor: withAlpha(Colors.amber, 0.3) },
  rank: {
    width: 18,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  rowAvatar: { width: 34, height: 34, borderRadius: 17 },
  medallion: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  grow: { flex: 1 },
  challenge: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: MockLayout.cardRadius,
    backgroundColor: Colors.stout2,
    marginTop: Spacing.sm,
  },
  challengeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  body: { flex: 1, gap: 5 },
  handle: { ...MockType.bodySemibold, color: Colors.foam },
  handleMe: { color: Colors.amber },
  sub: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },
  track: {
    height: 7,
    borderRadius: 4,
    backgroundColor: withAlpha(Colors.foam, 0.07),
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4 },
  score: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  scoreUnit: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },

  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
