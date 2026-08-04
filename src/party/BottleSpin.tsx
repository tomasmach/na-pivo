/**
 * SPIKE — a spinning bottle, drawn with Skia.
 *
 * Why this one and not the dice: the dice already read as objects, and Skia is a
 * 2D canvas, so it would add nothing there. A bottle spinning on a table is the
 * opposite — plain React Native can rotate a picture of a bottle, but it cannot
 * give it a shadow that stretches as it turns, a blur that smears while it is
 * fast, or a glass highlight that travels around the body. That is the whole
 * difference between "an icon is rotating" and "something is spinning".
 *
 * Everything here is drawn, not an asset: the bottle is a path, the label is a
 * rounded rect, the glass is two gradients. No image to ship, no resolution to
 * pick, and it recolours with the theme.
 *
 * The spin ends on a chosen player, exactly like every other draw in this app
 * (see `DrawShell`) — the target angle is computed first and the animation runs
 * to it, so reduced motion shows the same answer without a second code path.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Blur,
  Canvas,
  Group,
  LinearGradient,
  Path,
  RoundedRect,
  Shadow,
  vec,
} from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/theme/colors';

const SPIN_MS = 2200;

/**
 * The bottle, as a path in a 100×260 box.
 *
 * Body, shoulder, neck, lip — the silhouette everyone recognises. Drawn once at
 * a nominal size and scaled, so one path serves every screen.
 */
const BOTTLE =
  'M38 8 h24 v10 q0 6 3 10 l6 8 q4 6 4 14 v14 q0 10 7 18 l8 9 q6 7 6 17 v128 ' +
  'q0 12 -12 12 h-72 q-12 0 -12 -12 v-128 q0 -10 6 -17 l8 -9 q7 -8 7 -18 v-14 ' +
  'q0 -8 4 -14 l6 -8 q3 -4 3 -10 z';

export function BottleSpin({
  players,
  size = 300,
  onLanded,
}: {
  players: string[];
  size?: number;
  /** Fires with the name the neck ended up pointing at. */
  onLanded?: (name: string) => void;
}) {
  const angle = useSharedValue(0);
  const blur = useSharedValue(0);

  // One effect owns the spin, and the shared values are NOT in a dependency
  // array: `react-hooks/immutability` counts a deps array as passing a value to
  // a hook, and then forbids writing it. Same shape as `PlacesSheet`.
  React.useEffect(() => {
    const index = Math.floor(Math.random() * players.length);
    // Where that player sits, plus several whole turns so it reads as a throw.
    const slice = 360 / players.length;
    const target = angle.value + 360 * 4 + (index * slice - (angle.value % 360));

    // Blur tracks speed, not time: sharp at rest, smeared while it is fast.
    blur.value = withTiming(9, { duration: 260 });
    blur.value = withTiming(0, { duration: SPIN_MS, easing: Easing.in(Easing.quad) });
    angle.value = withTiming(target, {
      duration: SPIN_MS,
      easing: Easing.out(Easing.cubic),
    });

    const timer = onLanded
      ? setTimeout(() => onLanded(players[index]), SPIN_MS)
      : undefined;
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  const transform = useDerivedValue(() => [{ rotate: (angle.value * Math.PI) / 180 }]);
  const blurValue = useDerivedValue(() => blur.value);

  const w = size;
  const h = size;
  const scale = size / 340;

  return (
    <View style={[styles.wrap, { width: w, height: h }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group origin={vec(w / 2, h / 2)} transform={transform}>
          <Group transform={[{ translateX: w / 2 - 50 * scale }, { translateY: h / 2 - 130 * scale }, { scale }]}>
            <Blur blur={blurValue} />
            <Path path={BOTTLE}>
              {/* Glass: dark at the edges, lit down one side. */}
              <LinearGradient
                start={vec(0, 0)}
                end={vec(100, 0)}
                colors={['#1E3A24', '#4E7A4A', '#16281B']}
              />
              <Shadow dx={0} dy={8} blur={14} color="rgba(0,0,0,0.55)" />
            </Path>
            {/* The label — where a real bottle catches the eye as it turns. */}
            <RoundedRect x={16} y={150} width={68} height={62} r={6} color={Colors.amber} />
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
