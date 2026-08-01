/**
 * FriendListRow — one hairline friend row with shared history + rituals
 * (Parta 3.0 §4). Extracted from the KÁMOŠI section of FriendsScreen so the full
 * friends list can move to the Profile "Správa party" screen.
 *
 * The whole row opens the friend profile (where remove + block/report live);
 * long-press pops the shared safety menu. It is not a "just remove" affordance.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

import type { FriendProfile, FriendStats } from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

import { FriendMini, friendDisplayName } from './FriendMini';
import HairlineRow from './HairlineRow';

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
  return (
    <HairlineRow first={first}>
      <Pressable
        onPress={() => onOpenProfile(friend.id)}
        onLongPress={() => onLongPress(friend)}
        accessibilityRole="button"
        accessibilityLabel={friendDisplayName(friend)}
        style={({ pressed }) => [styles.friendRow, pressed && styles.dim]}
      >
        <FriendMini profile={friend} />
        <Text
          style={styles.sharedCount}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.friends.sharedCount(stats?.sharedPubCount ?? 0)}
        </Text>
        {stats?.lastPubName ? (
          <Text
            style={styles.lastTogether}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.friends.lastTogether(stats.lastPubName)}
          </Text>
        ) : null}
        {stats?.rituals.length ? (
          <View style={styles.ritualRow}>
            {stats.rituals.map((ritual) => (
              <View key={ritual.key} style={styles.ritualChip}>
                <Text style={styles.ritualText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {ritual.title}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    </HairlineRow>
  );
}

const styles = StyleSheet.create({
  friendRow: {
    gap: Spacing.sm,
  },
  dim: {
    opacity: 0.6,
  },
  sharedCount: {
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
  },
  lastTogether: {
    fontWeight: '500',
    fontSize: 14,
    color: Colors.foamMuted,
  },
  ritualRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  ritualChip: {
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.25),
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  ritualText: {
    fontWeight: '600',
    color: Colors.amber,
    fontSize: 12,
  },
});

export default FriendListRow;
