/**
 * A game's cover: a warm gradient with its glyph on it.
 *
 * Not artwork. Eight illustrated covers is the badge problem again
 * (`docs/badge-art-brief.md`) and it is not worth paying twice before anyone has
 * played a round. A gradient reads as a cover, ships today, and swaps for a
 * picture later without the grid changing shape.
 *
 * Drawn with `react-native-svg`, which the app already has — `NightRoute` fades
 * its map the same way. No `expo-linear-gradient`, no new dependency for two
 * colour stops.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { GameDef } from '@/party/gameCatalog';
import { Colors, withAlpha } from '@/theme/colors';

export function GameCover({
  game,
  height,
  glyph = 30,
}: {
  game: GameDef;
  height: number;
  glyph?: number;
}) {
  const { Icon } = game;
  return (
    <View style={[styles.wrap, { height }]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`cover-${game.key}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={game.cover[0]} />
            <Stop offset="1" stopColor={game.cover[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#cover-${game.key})`} />
      </Svg>
      <Icon size={glyph} color={withAlpha(Colors.foam, 0.92)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
