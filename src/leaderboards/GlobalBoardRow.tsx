/**
 * GlobalBoardRow — one row of the global leaderboards. Follows the party
 * leaderboard idiom (crown for #1, amber tint on my own row) inside the
 * screen's shared rows card. The category unit lives once in the hero footer,
 * while the complete score + unit stays in the accessibility label.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CrownIcon } from '@/components/shared/IconGlyph';
import type { BoardEntry } from '@/data/leaderboardsClient';
import { cs } from '@/i18n/cs';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface GlobalBoardRowProps {
  entry: BoardEntry;
  /** Unit caption under the score numeral, already declined for the count. */
  unit: string;
  /** Draws the card's upper hairline from the second row onward. */
  divided?: boolean;
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
  divided = false,
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
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {score}
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
        style={({ pressed }) => [
          styles.row,
          divided && styles.rowDivider,
          isMe && styles.rowMe,
          pressed && styles.rowPressed,
        ]}
      >
        {rowContent}
      </Pressable>
    );
  }
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      style={[styles.row, divided && styles.rowDivider, isMe && styles.rowMe]}
    >
      {rowContent}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 24,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
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
    fontWeight: '800',
    fontSize: 16,
    lineHeight: 16 * 1.24,
    color: Colors.foamMuted,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  rankPlain: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 15 * 1.24,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  nameCol: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
  },
  friendLine: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  metricCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  score: {
    fontWeight: '800',
    fontSize: 18,
    lineHeight: 18 * 1.24,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  scoreMe: {
    color: Colors.amber,
  },
});
