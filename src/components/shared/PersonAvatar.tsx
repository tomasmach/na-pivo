import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/theme/colors';

/** Compact person face used by party games and night summaries. */
export function PersonAvatar({
  name,
  tint,
  avatarUrl,
  size = 28,
}: {
  name: string;
  tint: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={[styles.avatar, shape]} />;
  }
  return (
    <View style={[styles.avatar, shape, { backgroundColor: tint }]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {name.replace('@', '').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.stout2,
    backgroundColor: Colors.stout3,
  },
  initial: { fontWeight: '800', color: Colors.stout },
});
