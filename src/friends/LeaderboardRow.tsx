/**
 * One row in the party leaderboard (ŽEBŘÍČEK PARTY). Rendered as a hairline row
 * on the bare stout ground — no card. Layout spec §8.
 *
 * Columns: rank (crown for #1, numeral otherwise) · Avatar · name · big visits
 * count with a quiet caption. The current user's row is gently highlighted with
 * an amber tint, a 3px amber left bar, and an amber visit numeral. The row dips
 * its opacity on press but is otherwise inert (there is nothing to navigate to).
 */

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Avatar } from '@/profile/Avatar';
import { CrownIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import type { LeaderboardEntry } from '@/data/friendsClient';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  /** 1-based standing in the list. */
  rank: number;
  /** Highest visits30d in the list (kept for the optional visits-meter; unused). */
  maxVisits: number;
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
  maxVisits,
  onPress,
}: LeaderboardRowProps) {
  const { account, visits30d, sharedCount, isMe } = entry;

  // The whole row is a single a11y node summarising rank + name + count.
  const a11yLabel = `${rank}. ${resolveName(entry)}, ${visits30d} ${cs.friends.leaderboardVisits(
    visits30d,
  )}`;

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
          style={[styles.visits, isMe && styles.visitsMe]}
          allowFontScaling={false}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {visits30d}
        </Text>
        <Text
          style={styles.visitsCaption}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {cs.friends.leaderboardVisits(visits30d)}
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
  // Left identity column: name with an optional quiet shared-visit subtitle, the
  // standard title+subtitle list pattern so the right column stays purely metric.
  nameCol: {
    flexShrink: 1,
  },
  name: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  sharedLine: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  metricCol: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  visits: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  visitsMe: {
    color: Colors.amber,
  },
  // Quiet unit label under the big number.
  visitsCaption: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    color: Colors.mutedText,
  },
});
