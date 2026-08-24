/**
 * One row in the party leaderboard (Žebříček party). Lives inside the section's
 * stout2 card, so rows divide with a top hairline like SittingRow does.
 *
 * Columns: rank (crown for #1, numeral otherwise) · Avatar · name · the big
 * metric numeral with a quiet unit caption. Which metric (beers or visits) is
 * the section's choice — the row only renders the value it is handed. The
 * current user's row is gently highlighted with an amber tint, a 3px amber left
 * bar, and an amber numeral.
 */

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Avatar } from '@/profile/Avatar';
import { CrownIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import type { LeaderboardEntry } from '@/data/friendsClient';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  /** 1-based standing in the list. */
  rank: number;
  /** The metric numeral this row shows (beers or visits, section's call). */
  value: number;
  /** Declined unit under the numeral, e.g. "piv" / "návštěvy". */
  caption: string;
  /** First row in the card skips the divider. */
  divided?: boolean;
  /**
   * Opens the friend's profile (§F1/§F4). Omitted for my own row, which stays a
   * plain no-op node without the misleading press feedback (a11y §15).
   */
  onPress?: () => void;
}

const AVATAR_SIZE = 34;

/** `@nickname` (preferred) → display name → a friendly fallback. */
function resolveName(entry: LeaderboardEntry): string {
  if (entry.isMe) return cs.friends.leaderboardMe;
  const { nickname, displayName } = entry.account;
  if (nickname) return `@${nickname}`;
  return displayName || 'Kámoš';
}

export const LeaderboardRow = memo(function LeaderboardRow({
  entry,
  rank,
  value,
  caption,
  divided = false,
  onPress,
}: LeaderboardRowProps) {
  const { account, sharedCount, isMe } = entry;

  // The whole row is a single a11y node summarising rank + name + count.
  const a11yLabel = `${rank}. ${resolveName(entry)}, ${value} ${caption}`;

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
        <Text
          style={styles.name}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {resolveName(entry)}
        </Text>
        {sharedCount > 0 ? (
          <Text
            style={styles.sharedLine}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {`${sharedCount}× spolu`}
          </Text>
        ) : null}
      </View>

      <View style={styles.metricCol}>
        <Text
          style={[styles.metric, isMe && styles.metricMe]}
          allowFontScaling={false}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {value}
        </Text>
        <Text
          style={styles.metricCaption}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {caption}
        </Text>
      </View>
    </>
  );

  // Tappable (a friend) → button role + press feedback; my own row stays a plain
  // node with no misleading press affordance (a11y §15).
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.row,
          divided && styles.rowDivided,
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
      accessibilityLabel={a11yLabel}
      style={[styles.row, divided && styles.rowDivided, isMe && styles.rowMe]}
    >
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
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowMe: {
    backgroundColor: withAlpha(Colors.amber, 0.08),
    borderRadius: Radius.card,
    // The tint needs its own breathing room; the card's padding sits outside.
    paddingHorizontal: 10,
    marginHorizontal: -10,
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
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  rankPlain: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  // Left identity column: name with an optional quiet shared-visit subtitle, the
  // standard title+subtitle list pattern so the right column stays purely metric.
  nameCol: {
    flexShrink: 1,
  },
  name: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
  },
  sharedLine: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  metricCol: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  metric: {
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  metricMe: {
    color: Colors.amber,
  },
  // Quiet unit label under the big number.
  metricCaption: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 11,
    color: Colors.mutedText,
  },
});
