import React from 'react';
import { StyleSheet, View } from 'react-native';

import { GameArtwork } from '@/party/GameArtwork';
import type { GameDef } from '@/party/gameCatalog';
import { Colors } from '@/theme/colors';

export function GameCover({
  game,
  height,
  radius = 18,
}: {
  game: GameDef;
  height: number;
  glyph?: number;
  radius?: number;
}) {
  return (
    <View style={[styles.wrap, { height, borderRadius: radius }]}>
      <GameArtwork gameKey={game.key} mode="cover" />
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
