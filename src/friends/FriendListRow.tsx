/**
 * FriendListRow — one person in "S kým chodíš na pivo".
 *
 * The canonical hairline row (DESIGN.md §5.1): avatar, name over a quiet meta
 * line, shared-evening count on the right. The count is a numeral, not a
 * sentence — "14" next to "naposled v pátek" says the same thing as "14
 * společných piv · Naposledy spolu: U Slovanské lípy" in a third of the width,
 * and a list of people is read by scanning, not by reading.
 *
 * The whole row opens the profile (where follow + block/report live);
 * long-press pops the shared safety menu. It is not a "just remove" affordance.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Avatar } from '@/profile/Avatar';
import type { FriendProfile, FriendStats } from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

import { friendDisplayName } from './FriendMini';
import { dayLabel } from './partaFeedCopy';

interface FriendListRowProps {
  friend: FriendProfile;
  stats: FriendStats | undefined;
  first: boolean;
  onOpenProfile: (id: string) => void;
  onLongPress: (friend: FriendProfile) => void;
}

export function FriendListRow({
  friend,
  stats,
  first,
  onOpenProfile,
  onLongPress,
}: FriendListRowProps) {
  const count = stats?.sharedPubCount ?? 0;
  const when = stats?.lastSharedAt ? dayLabel(stats.lastSharedAt) : '';
  const meta = when ? cs.friends.lastSeenTogether(when) : cs.friends.notTogetherYet;

  return (
    <Pressable
      onPress={() => onOpenProfile(friend.id)}
      onLongPress={() => onLongPress(friend)}
      accessibilityRole="button"
      accessibilityLabel={`${friendDisplayName(friend)}, ${cs.friends.sharedEvenings(count)}`}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.dim]}
    >
      <Avatar
        uri={friend.avatarUrl}
        nickname={friend.nickname}
        displayName={friend.displayName}
        size={34}
      />
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {friendDisplayName(friend)}
        </Text>
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {meta}
        </Text>
      </View>
      {/* A zero is the same thing the meta line already says, printed in the
          loudest type on the row. A column of them reads as an empty scoreboard,
          so the numeral only shows up once there is something to count. */}
      {count > 0 ? (
        <Text style={styles.count} numberOfLines={1} allowFontScaling={false}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  dim: {
    opacity: 0.6,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: '600',
    fontSize: 16,
    letterSpacing: -0.1,
    color: Colors.foam,
    includeFontPadding: false,
  },
  meta: {
    marginTop: 1,
    fontWeight: '500',
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  count: {
    fontFamily: Fonts.numeral,
    fontSize: 22,
    // 1.24× — Baloo 2 ExtraBold overshoots its line box and iOS clips the tops
    // of the digits without this (DESIGN.md §3.2).
    lineHeight: 27,
    letterSpacing: -0.4,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
    // The name owns the flex; the numeral keeps its own lane so a long handle
    // squeezes the handle, never the number.
    flexShrink: 0,
    textAlign: 'right',
    minWidth: 26,
  },
});

export default FriendListRow;
