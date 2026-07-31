/**
 * DESIGN MOCK — Komunita: the standings, and who to drink with next.
 *
 * Built as its own screen rather than by injecting a section into the real
 * `LeaderboardsScreen`. That screen owns a root View, a manual safe-area inset
 * and a pinned CTA — all correct for itself, and all of it fighting a native
 * large title, which needs the screen's ScrollView to be the root. Bolting a
 * mock section onto it produced a title floating over the content and a board
 * pushed off the bottom.
 *
 * Order is deliberate: the board is why you opened the tab, so it comes first.
 * Suggestions are what you do next, so they follow. The earlier version had it
 * backwards and buried the standings under five strangers.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PeopleSuggestions } from '@/community/PeopleSuggestions';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const BOARDS = ['Pivaři', 'Objevitelé', 'Mapéři'] as const;
const PERIODS = ['Týden', 'Letos', 'Celkem'] as const;

const AVATARS = 'https://i.pravatar.cc/160?img=';

/** A board with people on it — the empty state was most of what was wrong. */
const ROWS = [
  { rank: 1, handle: '@sudík', score: 31, avatar: `${AVATARS}57` },
  { rank: 2, handle: '@chmelák', score: 27, avatar: `${AVATARS}50` },
  { rank: 3, handle: '@pěna', score: 24, avatar: `${AVATARS}41` },
  { rank: 4, handle: '@klárka', score: 19, avatar: `${AVATARS}64` },
  { rank: 5, handle: '@ty', score: 17, avatar: `${AVATARS}12`, me: true },
  { rank: 6, handle: '@mišák', score: 14, avatar: `${AVATARS}26` },
];

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.segment, option === value && styles.segmentOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: option === value }}
          accessibilityLabel={option}
        >
          <Text
            style={[styles.segmentText, option === value && styles.segmentTextOn]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function CommunityMockScreen() {
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState<(typeof BOARDS)[number]>('Pivaři');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('Týden');
  const top = ROWS[0]?.score ?? 1;

  return (
    // Root ScrollView: react-native-screens binds the native large title to the
    // screen's scrollable, and a wrapping View hides it.
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Segmented options={BOARDS} value={board} onChange={setBoard} />

      <View style={styles.periods}>
        {PERIODS.map((option) => (
          <Pressable
            key={option}
            onPress={() => setPeriod(option)}
            style={styles.period}
            accessibilityRole="button"
            accessibilityState={{ selected: option === period }}
            accessibilityLabel={option}
          >
            <Text
              style={[styles.periodText, option === period && styles.periodTextOn]}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      {ROWS.map((row) => (
        <View key={row.handle} style={[styles.row, row.me && styles.rowMe]}>
          <Text style={styles.rank} allowFontScaling={false}>
            {row.rank}
          </Text>
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
          </Text>
        </View>
      ))}

      <View style={styles.suggestions}>
        <PeopleSuggestions />
      </View>

      <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
        Design mock — data jsou napevno.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },

  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
  },
  segment: {
    flex: 1,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: withAlpha(Colors.foam, 0.1) },
  segmentText: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },
  segmentTextOn: { color: Colors.foam },

  periods: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.md },
  period: { paddingVertical: Spacing.xs },
  periodText: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },
  periodTextOn: { color: Colors.amber },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowMe: { borderTopColor: withAlpha(Colors.amber, 0.3) },
  rank: {
    width: 20,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  body: { flex: 1, gap: 5 },
  handle: { ...MockType.bodySemibold, color: Colors.foam },
  handleMe: { color: Colors.amber },
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

  suggestions: { marginTop: MockLayout.sectionGap },

  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
