/**
 * GlobalBoardRow — one row of the global leaderboards. Follows the party
 * leaderboard idiom (hairline rows on bare stout, crown for #1, amber tint on
 * my own row) with a generic score column: the big numeral is the category
 * score and the quiet caption underneath names its unit (piv / hospod / XP).
 * Friends get a quiet "v partě" subtitle so a familiar face pops out of the
 * countrywide list.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CrownIcon } from '@/components/shared/IconGlyph';
import type { BoardEntry } from '@/data/leaderboardsClient';
import { cs } from '@/i18n/cs';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface GlobalBoardRowProps {
  entry: BoardEntry;
  /** Unit caption under the score numeral, already declined for the count. */
  unit: string;
  /** Opens the public profile. Omitted for my own row (nothing to navigate to). */
  onPress?: () => void;
}

const AVATAR_SIZE = 34;

/** `@nickname` (the listing handle) → display name → a friendly fallback. */
function resolveName(entry: BoardEntry): string {
  if (entry.isMe) return cs.leaderboards.rowMe;
  if (entry.account.nickname) return `@${entry.account.nickname}`;
  return entry.account.displayName || cs.leaderboards.rowFallbackName;
}

export const GlobalBoardRow = memo(function GlobalBoardRow({
  entry,
  unit,
  onPress,
}: GlobalBoardRowProps) {
  const { rank, score, isMe, isFriend, account } = entry;

  const a11yLabel = cs.a11y.leaderboardRow(rank, resolveName(entry), score, unit);

  const rowContent = (
    <>
      {isMe ? <View style={styles.meBar} pointerEvents="none" /> : null}

      <View style={styles.rankCol}>
        {rank === 1 ? (
          <CrownIcon size={20} color={Colors.amber} />
        ) : (
          <Text
            style={rank <= 3 ? styles.rankMedal : styles.rankPlain}
            allowFontScaling={false}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {rank}
          </Text>
        )}
      </View>

      <Avatar
        size={AVATAR_SIZE}
        uri={account.avatarUrl}
        nickname={account.nickname}
        displayName={account.displayName}
      />

      <View style={styles.nameCol}>
        <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {resolveName(entry)}
        </Text>
        {isFriend && !isMe ? (
          <Text style={styles.friendLine} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.leaderboards.rowFriend}
          </Text>
        ) : null}
      </View>

      <View style={styles.metricCol}>
        <Text
          style={[styles.score, isMe && styles.scoreMe]}
          allowFontScaling={false}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {score}
        </Text>
        <Text style={styles.scoreCaption} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {unit}
        </Text>
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [styles.row, isMe && styles.rowMe, pressed && styles.rowPressed]}
      >
        {rowContent}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={a11yLabel} style={[styles.row, isMe && styles.rowMe]}>
      {rowContent}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingVertical: Spacing.sm,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.border, 0.4),
  },
  rowMe: {
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  rowPressed: {
    opacity: 0.6,
  },
  meBar: {
    position: 'absolute',
    left: 0,
    top: Spacing.sm,
    bottom: Spacing.sm,
    width: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  rankCol: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankMedal: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 16,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  rankPlain: {
    fontFamily: Fonts.display.semibold,
    fontSize: 15,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  nameCol: {
    flexShrink: 1,
  },
  name: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  friendLine: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  metricCol: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  score: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  scoreMe: {
    color: Colors.amber,
  },
  scoreCaption: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    color: Colors.mutedText,
  },
});
