import React from 'react';
import { StyleSheet, View } from 'react-native';

import { GameArtwork } from '@/party/GameArtwork';
import type { GameDef } from '@/party/gameCatalog';
import { Colors } from '@/theme/colors';

export function GameCover({
  game,
  height,
  glyph = 30,
  radius = 18,
}: {
  game: GameDef;
  height: number;
  glyph?: number;
  radius?: number;
}) {
  return (
    <View style={[styles.wrap, { height, borderRadius: radius }]}>
      <GameArtwork gameKey={game.key} size={Math.min(height * 0.94, Math.max(110, glyph * 4))} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
  },
});
