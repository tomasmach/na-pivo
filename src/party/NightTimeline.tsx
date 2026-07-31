/**
 * DESIGN MOCK — the night as a cutting timeline.
 *
 * Each beer is a CLIP, not a tick: it starts when you poured it and runs until
 * the next one, so its width is how long that beer lasted. A row of identical
 * marks would say "seven beers happened"; this says where the evening sped up
 * and where it sat still, which is the only reason to draw time at all.
 *
 * The last clip is open-ended — you are still drinking it — so it gets the amber
 * fill and no closing time.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { clockAt, type BeerEntry } from '@/mocks/livePartyStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

/** Points per minute. Wide enough that a 9-minute beer is still readable. */
const SCALE = 2.6;
const MIN_W = 62;

export function NightTimeline({ beers, now }: { beers: BeerEntry[]; now: number }) {
  if (beers.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {beers.map((entry, index) => {
        const next = beers[index + 1];
        const until = next ? next.at : now;
        const minutes = Math.max(1, until - entry.at);
        const open = !next;
        return (
          <View key={entry.id} style={[styles.clip, { width: Math.max(MIN_W, minutes * SCALE) }]}>
            <Text style={styles.time} allowFontScaling={false}>
              {clockAt(entry.at)}
            </Text>
            <View style={[styles.bar, open && styles.barOpen]} />
            <Text
              style={[styles.name, open && styles.nameOpen]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {entry.beer}
            </Text>
            <Text style={styles.length} allowFontScaling={false}>
              {open ? 'teď' : `${minutes} min`}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 3, paddingRight: Spacing.md },
  clip: { gap: 4 },
  time: { fontSize: 11, fontWeight: '600', color: Colors.mutedText, fontVariant: ['tabular-nums'] },
  bar: {
    height: 26,
    borderRadius: 5,
    backgroundColor: withAlpha(Colors.amber, 0.32),
  },
  barOpen: { backgroundColor: Colors.amber },
  name: { fontSize: 12, fontWeight: '600', color: Colors.foam },
  nameOpen: { color: Colors.amber },
  length: { fontSize: 11, fontWeight: '400', color: Colors.mutedText },
});
