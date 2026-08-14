/**
 * FollowingRow — one person I follow.
 *
 * The same canonical hairline row as `FriendListRow`, minus the numeral: a
 * follow is one-way and carries no shared history to count. What it carries is
 * the last thing they drank, which is the whole reason to keep them here.
 *
 * Deliberately never shows presence, a live dot or a pub they are sitting in.
 * A one-way follow that leaked "where are they right now" would turn a beer
 * diary into a tracker, so the row has no shape to put that in.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { Avatar } from '@/profile/Avatar';
import type { FollowedProfile } from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

import { friendDisplayName } from './FriendMini';

interface FollowingRowProps {
  profile: FollowedProfile;
  first: boolean;
  onOpenProfile: (id: string) => void;
}

export function FollowingRow({ profile, first, onOpenProfile }: FollowingRowProps) {
  const meta = profile.lastDrink ? cs.friends.followingLastDrink(profile.lastDrink) : cs.friends.followingQuiet;

  return (
    <Pressable
      onPress={() => onOpenProfile(profile.id)}
      accessibilityRole="button"
      accessibilityLabel={friendDisplayName(profile)}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.dim]}
    >
      <Avatar
        uri={profile.avatarUrl}
        nickname={profile.nickname}
        displayName={profile.displayName}
        size={34}
      />
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {friendDisplayName(profile)}
        </Text>
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {meta}
        </Text>
      </View>
      <ChevronRightIcon size={18} color={Colors.mutedText} />
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
});

export default FollowingRow;
