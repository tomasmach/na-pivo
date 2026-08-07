import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FriendProfile } from '@/data/friendsClient';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { Avatar } from '@/profile/Avatar';
import { MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export function PeopleSuggestions({
  people,
  onPress,
}: {
  people: FriendProfile[];
  onPress?: (profile: FriendProfile) => void;
}) {
  if (people.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        Tvoji pivaři
      </Text>
      {people.slice(0, 5).map((person, index) => (
        <Pressable
          key={person.id}
          onPress={() => onPress?.(person)}
          style={({ pressed }) => [
            styles.row,
            index === 0 && styles.rowFirst,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={person.nickname ? `@${person.nickname}` : person.displayName}
        >
          <Avatar
            uri={person.avatarUrl}
            nickname={person.nickname}
            displayName={person.displayName}
            size={40}
            border="quiet"
          />
          <View style={styles.body}>
            <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {person.nickname ? `@${person.nickname}` : person.displayName}
            </Text>
            {person.nickname && person.displayName ? (
              <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {person.displayName}
              </Text>
            ) : null}
          </View>
          <ChevronRightIcon size={17} color={Colors.mutedText} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  title: { ...MockType.titleS, color: Colors.foam, marginBottom: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: { borderTopWidth: 0 },
  body: { flex: 1 },
  handle: { ...MockType.bodySemibold, color: Colors.foam },
  name: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
  pressed: { opacity: 0.65 },
});
