/**
 * The one card surface of the Tácek design system.
 *
 * Every hero card on a Tácek screen — počítadlo, kompas, profil, deník, parta,
 * příchod — is the same physical object: a stout2 panel lying on the stout
 * background, lit from above. `cardSurface` is that panel's style and
 * `<CardSheen />` is the light on it.
 *
 * The whole premium pass lives here and nowhere else, so the five cards can
 * never drift apart again:
 *
 *   1. a specular hairline along the top curve (the same trick the amber CTA
 *      uses, at a quarter of the strength), and
 *   2. a top-down sheen falling off over the upper third of the panel.
 *
 * Both are static and both are `foam` at 2-22 %. This is not the banned ambient
 * glow: `Colors.glow` is not involved, there is no blur, no radial halo behind
 * the content and nothing moves. It is the difference between a lit surface and
 * a flat brown rectangle, which is the difference between premium and wireframe.
 *
 * The sheen measures itself once. Percentage-sized SVG inside a flex parent is
 * the kind of thing that renders differently per platform, and a card that
 * silently loses its light on one of them is worse than no light at all.
 */

import React, { memo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';
import { Radius } from '@/theme/layout';

/** How far down the panel the sheen is still doing anything. */
const SHEEN_SHARE = 0.42;

export const CardSurface = StyleSheet.create({
  /**
   * The panel. Cards add `flex: 1` themselves — whether the card breathes is a
   * property of the screen it is on, not of the surface.
   */
  card: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
    // Lifts the panel off the root background. Black, soft, short offset: the
    // card sits on the table, it does not float above it.
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 3,
  },
  /** Hairline footer above one loud fact, one quiet fact and one amber door. */
  footer: {
    marginTop: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});

/**
 * The light on the panel. Drop it in as the card's FIRST child — it draws
 * underneath the content and swallows no touches.
 */
export const CardSheen = memo(function CardSheen() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height * SHEEN_SHARE) };
    if (next.width <= 0 || next.height <= 0) return;
    setSize((current) =>
      current?.width === next.width && current.height === next.height ? current : next,
    );
  };

  return (
    <View
      style={styles.wrap}
      onLayout={handleLayout}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {size ? (
        <Svg width={size.width} height={size.height}>
          <Defs>
            <LinearGradient id="cardSheen" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={Colors.foam} stopOpacity={0.05} />
              <Stop offset="1" stopColor={Colors.foam} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={size.width} height={size.height} fill="url(#cardSheen)" />
        </Svg>
      ) : null}
      {/* The specular line along the top curve. Inset so it reads as light
          catching the middle of the edge, not as a border. */}
      <View style={styles.topLight} />
    </View>
  );
});

const styles = StyleSheet.create({
  // The card clips, so the sheen can start flush with its rounded top edge.
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'stretch',
  },
  topLight: {
    position: 'absolute',
    top: 0,
    left: '14%',
    right: '14%',
    height: 1,
    backgroundColor: withAlpha(Colors.foam, 0.22),
  },
});
