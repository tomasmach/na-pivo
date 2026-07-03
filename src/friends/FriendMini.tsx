/**
 * FriendMini — avatar + resolved `@nickname` name, the shared friend-identity
 * cell reused across incoming requests, search results and the friends list
 * (Parta 3.0 §4). Extracted from FriendsScreen so the friend list can move to
 * the Profile "Správa party" screen while the requests section keeps using it.
 */

import { View, Text, StyleSheet } from 'react-native';

import { Avatar } from '@/profile/Avatar';
import type { FriendProfile } from '@/data/friendsClient';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

/** `@nickname` (preferred) → display name → a friendly fallback. */
export function friendDisplayName(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kámoš';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kámoš';
}

export function FriendMini({ profile }: { profile: FriendProfile }) {
  return (
    <View style={styles.friendMini}>
      <Avatar
        uri={profile.avatarUrl}
        nickname={profile.nickname}
        displayName={profile.displayName}
        size={34}
      />
      <Text
        style={styles.friendMiniText}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {friendDisplayName(profile)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  friendMini: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  friendMiniText: {
    flexShrink: 1,
    fontFamily: Fonts.ui.bold,
    color: Colors.foam,
    fontSize: 15,
  },
});

export default FriendMini;
