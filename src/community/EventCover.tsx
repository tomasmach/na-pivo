/**
 * An event's poster: a warm gradient with its date on it.
 *
 * Not a photograph. Real posters mean a content pipeline nobody has built, and
 * a placeholder photo is worse than no photo — see the same call in
 * `gameCatalog`. The date is what you scan for anyway.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { CommunityEvent } from '@/community/mockEvents';
import { Colors, withAlpha } from '@/theme/colors';

export function EventCover({ event, height }: { event: CommunityEvent; height: number }) {
  const [day, month] = event.when.replace(/^\S+\s/, '').split(' ');

  return (
    <View style={[styles.wrap, { height, width: height }]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`event-${event.id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={event.cover[0]} />
            <Stop offset="1" stopColor={event.cover[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#event-${event.id})`} />
      </Svg>
      <Text style={styles.day} allowFontScaling={false}>
        {day}
      </Text>
      <Text style={styles.month} allowFontScaling={false}>
        {month}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  day: { fontSize: 30, fontWeight: '800', color: Colors.foam, letterSpacing: -0.6 },
  month: { fontSize: 13, fontWeight: '600', color: withAlpha(Colors.foam, 0.75) },
});
