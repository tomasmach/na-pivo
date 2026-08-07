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

import type { CommunityEvent } from '@/data/communityEventsClient';
import { Colors, withAlpha } from '@/theme/colors';

const COVER_PALETTE = [
  ['#8A5A18', '#2E1D0E'],
  ['#7A4E18', '#2A1A0C'],
  ['#3F4A2E', '#171C10'],
] as const;

export function eventDateLabel(event: CommunityEvent): string {
  const date = new Date(event.startsAt);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
}

export function eventTimeLabel(event: CommunityEvent): string {
  const date = new Date(event.startsAt);
  if (!Number.isFinite(date.getTime())) return '';
  return `od ${date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
}

export function eventPlaceLabel(event: CommunityEvent): string {
  return event.areaLabel || event.city;
}

function coverFor(id: string): readonly [string, string] {
  const hash = [...id].reduce((value, char) => value + char.charCodeAt(0), 0);
  return COVER_PALETTE[hash % COVER_PALETTE.length] ?? COVER_PALETTE[0];
}

export function EventCover({ event, height }: { event: CommunityEvent; height: number }) {
  const start = new Date(event.startsAt);
  const day = Number.isFinite(start.getTime()) ? start.getDate().toLocaleString('cs-CZ') : '';
  const month = Number.isFinite(start.getTime())
    ? start.toLocaleDateString('cs-CZ', { month: 'short' }).replace('.', '')
    : '';
  const cover = coverFor(event.id);

  return (
    <View style={[styles.wrap, { height, width: height }]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`event-${event.id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={cover[0]} />
            <Stop offset="1" stopColor={cover[1]} />
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
