/**
 * BeerGlass — the evening, drawn.
 *
 * A classic Czech půllitr: straight walls with a hint of taper, a heavy glass
 * bottom and the cejch mark near the rim. The level rises with every beer,
 * tops out at ten, and carries a finger of foam at the surface. It is the one
 * piece of personality on the counter screen, and it is static — the level
 * only moves when the count does.
 *
 * Vector, not a bitmap, so it stays crisp at any size and re-tints with the
 * theme tokens instead of shipping an asset.
 */

import React, { memo } from 'react';
import Svg, { ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

/** Half-litre tumbler — straight walls, slight taper, soft base corners. */
const GLASS_PATH = 'M14 8 H74 L67.5 122 Q67 126 63 126 H25 Q21 126 20.5 122 Z';

/** Where the thick glass bottom starts; liquid never goes below it. */
const BASE_Y = 117;

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
  // Liquid sits between the heavy base and the cejch line; nothing at zero.
  const top = BASE_Y - ratio * 99;

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

      <G clipPath="url(#glassClip)">
        {ratio > 0 ? (
          <>
            <Rect x="0" y={top} width="88" height={132 - top} fill="url(#beerFill)" />
            {/* A finger of foam riding the surface. */}
            <Rect x="0" y={top - 9} width="88" height="12" rx="5" fill={Colors.foam} opacity={0.92} />
          </>
        ) : null}

        {/* Heavy pressed bottom — the half-litre's give-away. */}
        <Rect x="0" y={BASE_Y} width="88" height={132 - BASE_Y} fill={withAlpha(Colors.foam, 0.1)} />
        <Line
          x1="0"
          y1={BASE_Y}
          x2="88"
          y2={BASE_Y}
          stroke={withAlpha(Colors.foam, 0.28)}
          strokeWidth={1.5}
        />

        {/* Highlight down the left wall — the one thing that stops the shape
            from reading as a flat column. */}
        <Rect x="24" y="16" width="5" height="94" rx="2.5" fill={Colors.foam} opacity={0.14} />
      </G>

      <Path
        d={GLASS_PATH}
        fill="none"
        stroke={withAlpha(Colors.amber, ratio > 0 ? 0.55 : 0.32)}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* The cejch: the etched half-litre line every Czech checks first. It
          runs off the right wall, the way it is on the real glass. */}
      <Line
        x1="60"
        y1="20"
        x2="73.3"
        y2="20"
        stroke={withAlpha(Colors.foam, 0.28)}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* The rim, drawn heavier than the walls so the glass has a lip. */}
      <Rect x="13" y="5.5" width="62" height="4" rx="2" fill={withAlpha(Colors.amber, 0.5)} />
    </Svg>
  );
});
