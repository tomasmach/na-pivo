/**
 * DESIGN MOCK — the feed card's hero, chosen by what the night actually made.
 *
 * The card shows the BEST thing a party produced, not always the same thing.
 * Ranked by how much it tells you about the evening:
 *
 *   photos → game → tempo → record → map
 *
 * The map is last on purpose. It is the one output that says nothing about what
 * the night was LIKE — it is coordinates, and coordinates are plan B.
 *
 * The roast is NOT here. It is the card's headline, not its hero — the app's
 * own line about the night, which can sit over any of these.
 */

import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TrophyIcon } from '@/components/shared/IconGlyph';
import { NightRoute } from '@/mocks/NightRoute';
import { MockColors, MockType } from '@/mocks/mockTheme';
import type { FeedEntry } from '@/feed/mockFeed';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const HERO_HEIGHT = 170;
/** Tile height of the map + photos strip. */
const STRIP = 150;

/**
 * Illustrative photos for the mock. `picsum.photos` is a stock-photo service and
 * a seeded URL always returns the same image, so the feed does not reshuffle on
 * every render. It MUST NOT ship — real photos come from `BeerPhoto`.
 */
const PHOTOS = [
  'https://picsum.photos/seed/napivo-1/400/400',
  'https://picsum.photos/seed/napivo-2/400/400',
  'https://picsum.photos/seed/napivo-3/400/400',
  'https://picsum.photos/seed/napivo-4/400/400',
  'https://picsum.photos/seed/napivo-5/400/400',
];

function Photos({ count, caption }: { count: number; caption: string }) {
  return (
    <View style={[styles.pad, { height: HERO_HEIGHT }]}>
      <View style={styles.photoRow}>
        {Array.from({ length: Math.min(3, count) }).map((_, index) => (
          <Image key={index} source={{ uri: PHOTOS[index % PHOTOS.length] }} style={styles.photo} />
        ))}
        {count > 3 ? (
          <View style={[styles.photo, styles.photoMore]}>
            <Text style={styles.photoMoreText} allowFontScaling={false}>
              +{count - 3}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {caption}
      </Text>
    </View>
  );
}

function Game({
  game,
  winner,
  scores,
}: {
  game: string;
  winner: string;
  scores: { name: string; score: number }[];
}) {
  const top = scores[0]?.score ?? 1;
  return (
    <View style={styles.pad}>
      <View style={styles.gameHead}>
        <TrophyIcon size={15} color={Colors.amber} />
        <Text style={styles.gameTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {game} · vyhrála {winner}
        </Text>
      </View>
      {scores.slice(0, 4).map((row, index) => (
        <View key={row.name} style={styles.scoreRow}>
          <Text style={styles.scoreRank} allowFontScaling={false}>
            {index + 1}
          </Text>
          <Text style={styles.scoreName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {row.name}
          </Text>
          <View style={styles.scoreTrack}>
            <View
              style={[
                styles.scoreFill,
                {
                  width: `${Math.max(8, Math.round((row.score / top) * 100))}%`,
                  backgroundColor: index === 0 ? Colors.amber : withAlpha(Colors.amber, 0.38),
                },
              ]}
            />
          </View>
          <Text style={styles.scoreValue} allowFontScaling={false}>
            {row.score}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Tempo({
  hourly,
  peakLabel,
}: {
  hourly: { hour: string; beers: number }[];
  peakLabel: string;
}) {
  const peak = hourly.reduce((m, h) => Math.max(m, h.beers), 0);
  return (
    <View style={styles.pad}>
      {/* Bare numerals above bare numerals is a puzzle: 4 what, at 21 what?
          One line naming both axes is cheaper than a legend and a y-axis. */}
      <Text style={styles.chartTitle} maxFontSizeMultiplier={FontScaleCap.body}>
        Piva po hodinách
      </Text>
      <View style={styles.bars}>
        {hourly.map((slot) => (
          <View key={slot.hour} style={styles.barCol}>
            {/* The tally above the bar: the shape shows the trend, the number
                answers "how many" without making anyone read a bar height. */}
            <Text style={styles.barValue} allowFontScaling={false}>
              {slot.beers}
            </Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  { height: `${peak > 0 ? Math.max(8, (slot.beers / peak) * 100) : 8}%` },
                ]}
              />
            </View>
            <Text style={styles.barHour} allowFontScaling={false}>
              {slot.hour}:00
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {peakLabel}
      </Text>
    </View>
  );
}

function Record({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={[styles.pad, styles.recordRow]}>
      <View style={styles.medallion}>
        <TrophyIcon size={17} color={Colors.amber} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.recordTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

export function PartyHighlight({ entry }: { entry: FeedEntry }) {
  const h = entry.highlight;

  switch (h.kind) {
    case 'photos':
      return <Photos count={h.count} caption={h.caption} />;
    case 'game':
      return <Game game={h.game} winner={h.winner} scores={h.scores} />;
    case 'tempo':
      return <Tempo hourly={h.hourly} peakLabel={h.peakLabel} />;
    case 'record':
      return <Record title={h.title} detail={h.detail} />;
    case 'map':
    default:
      // With photos, the map stops being the whole hero and becomes the first
      // tile of a strip you scroll: where it was, then what it looked like.
      // The pictures are the point; the map is the establishing shot.
      return entry.photos > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          <View style={styles.stripMap}>
            <NightRoute stops={entry.stops} live={entry.live} height={STRIP} />
          </View>
          {Array.from({ length: entry.photos }).map((_, index) => (
            <Image
              key={index}
              source={{ uri: PHOTOS[index % PHOTOS.length] }}
              style={styles.stripPhoto}
            />
          ))}
        </ScrollView>
      ) : (
        // Nothing was produced: no map, no filler. Strava does the same with a
        // text-only activity — the card is the numbers and a line saying where.
        // A map dropped in to fill the slot is decoration pretending to be
        // content, and it makes every empty night look identical.
        <Text
          style={styles.routeText}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {entry.stops.map((stop) => stop.name).join('  →  ')}
        </Text>
      );
  }
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md, gap: Spacing.sm },
  grow: { flex: 1 },
  caption: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },

  routeText: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    fontSize: 14,
    fontWeight: '600',
    color: withAlpha(Colors.amber, 0.9),
  },

  // — Map + photos strip —
  strip: { gap: Spacing.xs, paddingHorizontal: Spacing.md },
  stripMap: { width: 220, borderRadius: 18, overflow: 'hidden' },
  stripPhoto: {
    width: 120,
    height: STRIP,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.12),
  },

  // — Photos —
  photoRow: { flexDirection: 'row', gap: Spacing.xs, flex: 1 },
  photo: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  photoMore: { backgroundColor: MockColors.surfaceHigh, maxWidth: 64 },
  photoMoreText: { fontSize: 14, fontWeight: '700', color: Colors.foam },

  // — Game —
  gameHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gameTitle: { ...MockType.bodySmall, fontWeight: '700', color: Colors.foam },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  scoreRank: {
    width: 14,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  scoreName: { width: 68, fontSize: 13, fontWeight: '600', color: Colors.foam },
  scoreTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: withAlpha(Colors.foam, 0.08),
    overflow: 'hidden',
  },
  scoreFill: { height: '100%', borderRadius: 4 },
  scoreValue: {
    width: 24,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  // — Tempo —
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, height: 96 },
  barCol: { flex: 1, alignItems: 'center', gap: 5 },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6, backgroundColor: withAlpha(Colors.amber, 0.55) },
  chartTitle: { fontSize: 13, fontWeight: '600', color: Colors.foam },
  barValue: { fontSize: 12, fontWeight: '700', color: Colors.foam },
  barHour: { fontSize: 11, fontWeight: '500', color: Colors.mutedText },

  // — Record —
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  medallion: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  recordTitle: { ...MockType.bodySemibold, color: Colors.foam },
});
