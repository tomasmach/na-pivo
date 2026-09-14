import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { displayPersonName } from '@/party/nightBuilder';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

const LABEL_WIDTH = 88;
const COASTER = 48;

export function bottleNeedsRoster(width: number, height: number, count: number) {
  return count > (width < 320 || height < 380 ? 6 : 8);
}

/** Same angular seats as bottle physics; the ellipse only changes their distance. */
export function bottleSeatPosition(width: number, height: number, index: number, count: number) {
  const angle = index / Math.max(1, count) * Math.PI * 2;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const rx = Math.max(1, width / 2 - LABEL_WIDTH / 2 - 6);
  const ry = Math.max(1, height / 2 - COASTER / 2 - 38);
  const radius = 1 / Math.sqrt((sin / rx) ** 2 + (cos / ry) ** 2);
  return { x: width / 2 + sin * radius, y: height / 2 - cos * radius };
}

/** Names never enter the WebView: these fixed seats keep native type and accessibility. */
export function BottleSeats({ players, selectedId, crowded }: {
  players: { id: string; name: string; tint: string }[];
  selectedId: string | null;
  crowded: boolean;
}) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  return <View style={StyleSheet.absoluteFill} pointerEvents="none"
    onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
    {size.width > 0 && players.map((player, index) => {
      const { x, y } = bottleSeatPosition(size.width, size.height, index, players.length);
      const name = displayPersonName(player.name);
      const selected = player.id === selectedId;
      if (crowded && !selected) return <View key={player.id} style={[styles.dot, { left: x - 3, top: y - 3, backgroundColor: player.tint }]} />;
      return <View key={player.id} accessible accessibilityLabel={name} accessibilityState={{ selected }}
        style={[styles.seat, { left: x - LABEL_WIDTH / 2, top: y - COASTER / 2 }]}>
        <View style={styles.coaster}>
          <Svg width={COASTER} height={COASTER} viewBox="0 0 64 64" accessible={false}>
            <Path d="M31 3C47 2 61 15 61 31Q63 47 48 57Q35 65 19 58Q3 52 3 35Q1 19 15 9Q22 4 31 3Z" fill={Colors.foam} stroke={selected ? Colors.amber : Colors.stout} strokeWidth={selected ? 4 : 1.8} />
            <Circle cx={32} cy={31} r={24} fill="none" stroke={Colors.stout} strokeWidth={0.8} />
            <Circle cx={32} cy={31} r={18} fill={player.tint} stroke={Colors.stout} strokeWidth={1.5} />
            <Path d="m15 16 3 2m2-6 2 3m25 29 3 2m-8 3 2 3M10 29l-1 7m45-14 1 6" fill="none" stroke={Colors.stout} strokeWidth={1.1} />
          </Svg>
          <Text accessible={false} allowFontScaling={false} style={styles.initial}>{Array.from(name.replace('@', '').trim())[0]?.toUpperCase()}</Text>
        </View>
        <Text accessible={false} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={FontScaleCap.body}
          style={[styles.name, selected && styles.selectedName]}>{name}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: Colors.foam },
  seat: { position: 'absolute', width: LABEL_WIDTH, alignItems: 'center' },
  coaster: { width: COASTER, height: COASTER, alignItems: 'center', justifyContent: 'center' },
  initial: { position: 'absolute', color: Colors.stout, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  name: { maxWidth: LABEL_WIDTH, marginTop: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', backgroundColor: Colors.stout, color: Colors.foam, fontSize: 13, fontWeight: '700' },
  selectedName: { backgroundColor: Colors.amber, color: Colors.stout },
});
