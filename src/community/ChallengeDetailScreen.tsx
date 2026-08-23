/**
 * DESIGN MOCK — one challenge, opened from the Komunita card.
 *
 * The order answers the questions in the order you actually ask them:
 *
 *   what is it        title and one line of pitch
 *   how am I doing    the count, big, with a track under it
 *   what counts       the rules, in sentences
 *   who else is in    the people, with their counts
 *
 * No cards. The card was the thing you tapped; repeating it here would frame
 * the content as a preview of itself. Sections are separated by space and one
 * hairline, per the design system's §14 warning about busy nesting.
 *
 * The header is transparent with no title (see the community `_layout`), so the
 * screen owns its own heading and has to clear the floating back button — hence
 * the `insets.top + 52` top pad, the same figure the party recap uses.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, TrophyIcon } from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

import type { Challenge } from '@/data/challengesClient';

function deadlineLabel(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return `Do ${new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long' }).format(parsed)}`;
}

export function ChallengeDetailScreen({ challenge }: { challenge: Challenge }) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 52, paddingBottom: insets.bottom + TAB_CHROME },
      ]}
    >
      {/* No glyph here. On the card it tells three challenges apart at a
          glance; on the screen that is only about this one it decorates a
          title that already says everything. */}
      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        {challenge.title}
      </Text>
      <Text style={styles.blurb} maxFontSizeMultiplier={FontScaleCap.body}>
        {challenge.blurb}
      </Text>

      {/* Where you stand. The numeral is the content, so nothing sits on top of
          it — no chip, no card, no gradient (§15: glass never under a number). */}
      <View style={styles.progress}>
        <Text style={styles.count} allowFontScaling={false}>
          {challenge.done}
          <Text style={styles.countRest}>
            {' '}
            z {challenge.goal} {challenge.unit}
          </Text>
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(4, challenge.progress * 100)}%` }]} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.meta} maxFontSizeMultiplier={FontScaleCap.body}>
            {deadlineLabel(challenge.deadline)}
          </Text>
          <View style={styles.rewardRow}>
            <TrophyIcon size={14} color={Colors.amber} />
            <Text style={styles.reward} maxFontSizeMultiplier={FontScaleCap.body}>
              {challenge.reward}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
        Co se počítá
      </Text>
      {challenge.rules.map((rule) => (
        <View key={rule} style={styles.rule}>
          <CheckIcon size={16} color={Colors.amber} />
          <Text style={styles.ruleText} maxFontSizeMultiplier={FontScaleCap.body}>
            {rule}
          </Text>
        </View>
      ))}

      {challenge.friends.length > 0 ? (
        <>
          <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
            Kdo ještě jede
          </Text>
          {challenge.friends.map((friend) => {
            const person = friend.account;
            const personLabel = person.nickname ? `@${person.nickname}` : person.displayName;
            return (
              <View key={person.id} style={styles.rival}>
                <Avatar
                  uri={person.avatarUrl}
                  nickname={person.nickname}
                  displayName={person.displayName}
                  size={40}
                  border="quiet"
                />
                <Text
                  style={styles.handle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {personLabel}
                </Text>
                <View style={styles.rivalProgress}>
                  <Text style={styles.rivalScore} allowFontScaling={false}>
                    {friend.done}
                    <Text style={styles.rivalGoal}> z {challenge.goal}</Text>
                  </Text>
                  <View style={styles.trackThin}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${Math.max(0, Math.min(100, friend.progress * 100))}%` },
                      ]}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },

  title: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.6,
    marginTop: Spacing.md,
  },
  blurb: { fontSize: 16, fontWeight: '400', color: Colors.mutedText, lineHeight: 23, marginTop: 6 },

  progress: { marginTop: MockLayout.sectionGap },
  count: {
    fontFamily: Fonts.numeral,
    fontSize: 40,
    lineHeight: 50,
    color: Colors.foam,
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  countRest: { fontSize: 19, fontWeight: '600', color: Colors.mutedText, letterSpacing: -0.2 },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: withAlpha(Colors.foam, 0.1),
    overflow: 'hidden',
    marginTop: Spacing.sm,
  },
  trackThin: {
    height: 5,
    borderRadius: 3,
    backgroundColor: withAlpha(Colors.foam, 0.1),
    overflow: 'hidden',
    marginTop: 5,
  },
  fill: { height: '100%', borderRadius: 4, backgroundColor: Colors.amber },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  meta: { fontSize: 14, fontWeight: '500', color: Colors.mutedText },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reward: { fontSize: 14, fontWeight: '600', color: Colors.amber },

  section: { ...MockType.titleS, color: Colors.foam, marginTop: MockLayout.sectionGap },

  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.md },
  ruleText: { flex: 1, fontSize: 15, fontWeight: '400', color: Colors.foam, lineHeight: 21 },
  rival: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.08),
  },
  handle: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.foam },
  rivalProgress: { width: 92, alignItems: 'flex-end' },
  rivalScore: {
    fontSize: 19,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  rivalGoal: { fontSize: 14, fontWeight: '500', color: Colors.mutedText },
});
