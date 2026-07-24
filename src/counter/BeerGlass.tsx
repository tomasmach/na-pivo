/**
 * BeerGlass — the evening, drawn.
 *
 * A half-litre filling up as the night goes on: the level rises with every
 * beer, tops out at ten, and carries a finger of foam at the surface. It is
 * the one piece of personality on the counter screen, and it is static — the
 * level only moves when the count does.
 *
 * Vector, not a bitmap, so it stays crisp at any size and re-tints with the
 * theme tokens instead of shipping an asset.
 */

import React, { memo } from 'react';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

/** Slightly tapered pint with a rounded base, drawn in an 88x132 box. */
const GLASS_PATH =
  'M12 6 H76 L70 112 Q68.5 126 55 126 H33 Q19.5 126 18 112 Z';

/** Beers that fill the glass to the brim. Past this it just stays full. */
const FULL_AT = 10;

export const BeerGlass = memo(function BeerGlass({
  count,
  width = 96,
}: {
  /** Beers tonight. 0 draws an empty glass. */
  count: number;
  width?: number;
}) {
  const height = Math.round((width / 88) * 132);
  const ratio = Math.max(0, Math.min(1, count / FULL_AT));
  // Liquid occupies the body of the glass (y 12 → 127); nothing at zero.
  const top = 127 - ratio * 115;

  return (
    <Svg width={width} height={height} viewBox="0 0 88 132">
      <Defs>
        <ClipPath id="glassClip">
          <Path d={GLASS_PATH} />
        </ClipPath>
        <LinearGradient id="beerFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.amberLight} stopOpacity={0.95} />
          <Stop offset="1" stopColor={Colors.amber} stopOpacity={0.8} />
        </LinearGradient>
      </Defs>

      {/* The empty glass: a barely-there body so it reads even at zero. */}
      <Path d={GLASS_PATH} fill={withAlpha(Colors.foam, 0.05)} />

      {ratio > 0 ? (
        <G clipPath="url(#glassClip)">
          <Rect x="0" y={top} width="88" height={132 - top} fill="url(#beerFill)" />
          {/* A finger of foam riding the surface. */}
          <Rect x="0" y={top - 8} width="88" height="10" rx="4" fill={Colors.foam} opacity={0.92} />
        </G>
      ) : null}

      {/* Highlight down the left wall — the one thing that stops the shape from
          reading as a flat column. */}
      <G clipPath="url(#glassClip)">
        <Rect x="25" y="16" width="6" height="94" rx="3" fill={Colors.foam} opacity={0.16} />
      </G>

      <Path
        d={GLASS_PATH}
        fill="none"
        stroke={withAlpha(Colors.amber, ratio > 0 ? 0.55 : 0.32)}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* The rim, drawn heavier than the walls so the glass has a lip. */}
      <Rect x="10" y="3" width="68" height="5" rx="2.5" fill={withAlpha(Colors.amber, 0.55)} />
    </Svg>
  );
});
