/**
 * DESIGN MOCK — the feed card's hero: everything the night produced, in a strip
 * you scroll sideways.
 *
 * It used to pick ONE output and give it the full width. That threw away most of
 * a good evening — a night with a game AND photos AND three stops showed the
 * game and nothing else, and looked identical to a night that only had a game.
 * Now every output gets a tile and the card shows what it has.
 *
 * The first tile is still the best thing, ranked by how much it tells you about
 * the evening:
 *
 *   game → tempo → record → map
 *
 * The map is last on purpose. It is the one output that says nothing about what
 * the night was LIKE — it is coordinates, and coordinates are plan B.
 *
 * Tiles are deliberately NARROWER than the screen so the next one is always
 * half-visible. A strip that ends flush with the edge reads as a single panel
 * that happens to be clipped; the peek is the entire affordance.
 *
 * The roast is NOT here. It is the card's headline, not its hero — the app's
 * own line about the night, which can sit over any of these.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { TrophyIcon } from '@/components/shared/IconGlyph';
import { NightRoute } from '@/mocks/NightRoute';
import { TempoChart } from '@/mocks/TempoChart';
import { MockColors, MockType } from '@/mocks/mockTheme';
import type { FeedEntry } from '@/feed/mockFeed';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

/** Every tile is the same height, so the strip has one baseline top and bottom
 *  no matter what the night produced. */
const TILE = 164;
/** How much of the next tile stays on screen. */
const PEEK = 54;
const MAP_W = 218;

/** A data tile: the surface that makes a chart read as one card in the strip. */
function Tile({ width, children }: { width: number; children: React.ReactNode }) {
  return <View style={[styles.tile, { width }]}>{children}</View>;
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
    <>
      <View style={styles.gameHead}>
        <TrophyIcon size={15} color={Colors.amber} />
        <Text style={styles.gameTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
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
    </>
  );
}

function Record({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.recordBody}>
      <View style={styles.medallion}>
        <TrophyIcon size={17} color={Colors.amber} />
      </View>
      <Text style={styles.recordTitle} maxFontSizeMultiplier={FontScaleCap.body}>
        {title}
      </Text>
      <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
        {detail}
      </Text>
    </View>
  );
}

export function PartyHighlight({ entry }: { entry: FeedEntry }) {
  const { width } = useWindowDimensions();
  const h = entry.highlight;
  // The data tile takes the screen minus the card's gutters minus the peek.
  const wide = Math.max(240, width - Spacing.md * 2 - PEEK);

  const tiles: React.ReactNode[] = [];

  // The ranked hero, whatever this night's best API-backed output was.
  if (h.kind === 'game') {
    tiles.push(
      <Tile key="game" width={wide}>
        <Game game={h.game} winner={h.winner} scores={h.scores} />
      </Tile>,
    );
  } else if (h.kind === 'tempo') {
    tiles.push(
      <Tile key="tempo" width={wide}>
        <TempoChart hourly={h.hourly} />
      </Tile>,
    );
  } else if (h.kind === 'record') {
    tiles.push(
      <Tile key="record" width={Math.min(wide, 210)}>
        <Record title={h.title} detail={h.detail} />
      </Tile>,
    );
  }

  const mapTile =
    entry.stops.length > 0 ? (
      <View key="map" style={styles.map}>
        <NightRoute stops={entry.stops} live={entry.live} height={TILE} />
      </View>
    ) : null;

  // The published-night API does not return photos. A count cannot support a
  // photo tile, so the feed omits that mock-only card type instead of inventing
  // an image. The route remains the honest fallback when coordinates exist.
  if (mapTile) tiles.push(mapTile);

  // Nothing was produced: no map, no filler. Strava does the same with a
  // text-only activity — the card is the numbers and a line saying where. A map
  // dropped in to fill the slot is decoration pretending to be content, and it
  // makes every empty night look identical.
  if (tiles.length === 0) {
    return (
      <Text style={styles.routeText} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {entry.stops.map((stop) => stop.name).join('  →  ')}
      </Text>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      // Locks to one axis once a drag starts, so a slightly diagonal swipe
      // scrolls the strip instead of fighting the feed's vertical scroll.
      directionalLockEnabled
    >
      {tiles}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },

  routeText: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    fontSize: 14,
    fontWeight: '600',
    color: withAlpha(Colors.amber, 0.9),
  },

  // — The strip —
  strip: { gap: Spacing.sm, paddingHorizontal: Spacing.md, alignItems: 'center' },
  tile: {
    height: TILE,
    borderRadius: 20,
    padding: Spacing.md,
    gap: Spacing.xs,
    justifyContent: 'center',
    backgroundColor: MockColors.surfaceHigh,
  },
  map: { width: MAP_W, height: TILE, borderRadius: 20, overflow: 'hidden' },

  // — Game —
  gameHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  gameTitle: { ...MockType.bodySmall, fontWeight: '700', color: Colors.foam, flex: 1 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  scoreRank: {
    width: 14,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  scoreName: { width: 62, fontSize: 13, fontWeight: '600', color: Colors.foam },
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


  // — Record —
  recordBody: { alignItems: 'flex-start', gap: Spacing.sm },
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
