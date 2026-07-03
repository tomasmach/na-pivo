/**
 * OutgoingInvites — the cancellable "ODESLANÉ POZVÁNKY" chips (Parta 3.0 §5).
 *
 * Extracted from the KÁMOŠI footer in FriendsScreen so the outgoing invites move
 * with the friends list to the Profile "Správa party" screen. Purely
 * presentational: it renders a wrapped row of recipient chips and asks the parent
 * to run the confirm-and-cancel flow via `onCancel`.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

import type { Friendship } from '@/data/friendsClient';
import { XIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

import { friendDisplayName } from './FriendMini';

interface OutgoingInvitesProps {
  requests: Friendship[];
  /** Confirm Alert → cancelFriendRequest, owned by the parent. */
  onCancel: (request: Friendship) => void;
}

export function OutgoingInvites({ requests, onCancel }: OutgoingInvitesProps) {
  if (requests.length === 0) return null;
  return (
    <View style={styles.outgoingWrap}>
      <Text
        style={styles.outgoingLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {cs.friends.outgoingHeader}
      </Text>
      <View style={styles.outgoingRow}>
        {requests.map((request) => (
          <Pressable
            key={request.id}
            onPress={() => onCancel(request)}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.cancelInviteTitle}
            style={({ pressed }) => [styles.outgoingChip, pressed && styles.dim]}
          >
            <Text
              style={styles.outgoingText}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {friendDisplayName(request.recipient)}
            </Text>
            <XIcon size={13} color={Colors.mutedText} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outgoingWrap: {
    marginTop: Spacing.md,
  },
  outgoingLabel: {
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  outgoingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  outgoingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.08),
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  outgoingText: {
    fontFamily: Fonts.ui.semibold,
    color: Colors.foamMuted,
    fontSize: 13,
  },
  dim: {
    opacity: 0.6,
  },
});

export default OutgoingInvites;
