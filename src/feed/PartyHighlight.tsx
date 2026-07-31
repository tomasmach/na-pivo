/**
 * DESIGN MOCK — the feed card's hero, chosen by what the night actually made.
 *
 * The card shows the BEST thing a party produced, not always the same thing.
 * Ranked by how much it tells you about the evening:
 *
 *   photos → game → tempo → record → roast → map
 *
 * The map is last on purpose. It is the one output that says nothing about what
 * the night was LIKE — it is coordinates, and coordinates are plan B.
 *
 * The roast is generated from the numbers and delivered flat. That is the
 * product's voice: this is a beer app fed by what people do, and the line that
 * gets screenshotted is never the one that congratulates you.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ImagesIcon, TrophyIcon } from '@/components/shared/IconGlyph';
import { NightRoute } from '@/mocks/NightRoute';
import { MockColors, MockType } from '@/mocks/mockTheme';
import type { FeedEntry } from '@/feed/mockFeed';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const HERO_HEIGHT = 170;

/** Photo placeholders until real images are wired. */
const TINTS = ['#3A2515', '#2E2A1A', '#3A1E1E', '#22301F'];

function Photos({ count, caption }: { count: number; caption: string }) {
  return (
    <View style={[styles.pad, { height: HERO_HEIGHT }]}>
      <View style={styles.photoRow}>
        {Array.from({ length: Math.min(3, count) }).map((_, index) => (
          <View key={index} style={[styles.photo, { backgroundColor: TINTS[index] }]}>
            <ImagesIcon size={18} color={withAlpha(Colors.foam, 0.4)} />
          </View>
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
      <View style={styles.bars}>
        {hourly.map((slot) => (
          <View key={slot.hour} style={styles.barCol}>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  { height: `${peak > 0 ? Math.max(8, (slot.beers / peak) * 100) : 8}%` },
                ]}
              />
            </View>
            <Text style={styles.barHour} allowFontScaling={false}>
              {slot.hour}
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

function Roast({ line, basis }: { line: string; basis: string }) {
  return (
    <View style={styles.pad}>
      <Text style={styles.roast} maxFontSizeMultiplier={FontScaleCap.heading}>
        {`„${line}“`}
      </Text>
      <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {basis}
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
    case 'roast':
      return <Roast line={h.line} basis={h.basis} />;
    case 'map':
    default:
      return <NightRoute stops={entry.stops} live={entry.live} photos={entry.photos} />;
  }
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md, gap: Spacing.sm },
  grow: { flex: 1 },
  caption: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },

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
  barHour: { fontSize: 11, fontWeight: '500', color: Colors.mutedText },

  // — Roast —
  roast: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 25,
    color: Colors.foam,
    letterSpacing: -0.3,
  },

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
