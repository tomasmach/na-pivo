/**
 * BeerGlass — the evening, drawn.
 *
 * The Czech krýgl: a half-litre mug with a chunky ear, fluted walls, a heavy
 * pressed bottom and the etched cejch under the rim. The level rises with
 * every beer, tops out at ten, and carries a finger of foam at the surface.
 * It is the one piece of personality on the counter screen, and it is static —
 * the level only moves when the count does.
 *
 * Vector, not a bitmap, so it stays crisp at any size and re-tints with the
 * theme tokens instead of shipping an asset.
 */

import React, { memo } from 'react';
import Svg, { ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

/** Drawing box. A mug is squat and the ear needs its own room on the right. */
const VIEW_W = 120;
const VIEW_H = 116;

/** The mug body — barely tapered walls, soft base corners. Ear is separate. */
const BODY_PATH = 'M6 6 H84 L78 104 Q77 110 71 110 H19 Q13 110 12 104 Z';

/**
 * The ear: a fat D hooked onto the right wall, closed so it takes the same
 * fill-plus-outline treatment as the body. Both roots land exactly on the
 * wall, so nothing shows through the half-transparent glass.
 */
const HANDLE_PATH =
  'M83 22 C 106 22, 112 34, 112 55 C 112 76, 102 88, 79 88 L 79 80 ' +
  'C 96 80, 103 71, 103 55 C 103 39, 97 30, 83 30 Z';

/** Where the pressed bottom starts; beer never goes below it. */
const BASE_Y = 100;

/** Beers that fill the mug to the brim. Past this it just stays full. */
const FULL_AT = 10;

/** Fluting down the body — the ribs a hospoda krýgl has. */
const FLUTES = [22, 33, 44, 55, 66];

export const BeerGlass = memo(function BeerGlass({
  count,
  width = 112,
}: {
  /** Beers tonight. 0 draws an empty mug. */
  count: number;
  width?: number;
}) {
  const height = Math.round((width / VIEW_W) * VIEW_H);
  const ratio = Math.max(0, Math.min(1, count / FULL_AT));
  // Beer sits between the pressed bottom and the rim; nothing at zero.
  const top = BASE_Y - ratio * 84;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      <Defs>
        <ClipPath id="glassClip">
          <Path d={BODY_PATH} />
        </ClipPath>
        <LinearGradient id="beerFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.amberLight} stopOpacity={0.95} />
          <Stop offset="1" stopColor={Colors.amber} stopOpacity={0.8} />
        </LinearGradient>
      </Defs>

      {/* The ear is drawn first so the body covers both joins. */}
      <Path
        d={HANDLE_PATH}
        fill={withAlpha(Colors.amber, ratio > 0 ? 0.16 : 0.1)}
        stroke={withAlpha(Colors.amber, ratio > 0 ? 0.55 : 0.32)}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />

      {/* The empty mug: a barely-there body so it reads even at zero. */}
      <Path d={BODY_PATH} fill={withAlpha(Colors.foam, 0.05)} />

      <G clipPath="url(#glassClip)">
        {ratio > 0 ? (
          <>
            <Rect x="0" y={top} width={VIEW_W} height={VIEW_H - top} fill="url(#beerFill)" />
            {/* A finger of foam riding the surface. */}
            <Rect
              x="0"
              y={top - 9}
              width={VIEW_W}
              height="12"
              rx="5"
              fill={Colors.foam}
              opacity={0.92}
            />
          </>
        ) : null}

        {/* Fluted walls — thin ribs, just enough to read as pressed glass. */}
        {FLUTES.map((x) => (
          <Rect key={x} x={x} y="30" width="1.5" height="74" fill={Colors.foam} opacity={0.07} />
        ))}

        {/* The heavy pressed bottom — the krýgl's give-away. */}
        <Rect
          x="0"
          y={BASE_Y}
          width={VIEW_W}
          height={VIEW_H - BASE_Y}
          fill={withAlpha(Colors.foam, 0.1)}
        />
        <Line
          x1="0"
          y1={BASE_Y}
          x2={VIEW_W}
          y2={BASE_Y}
          stroke={withAlpha(Colors.foam, 0.28)}
          strokeWidth={1.5}
        />

        {/* Highlight down the left wall — the one thing that stops the shape
            from reading as a flat column. */}
        <Rect x="15" y="16" width="6" height="80" rx="3" fill={Colors.foam} opacity={0.13} />
      </G>

      <Path
        d={BODY_PATH}
        fill="none"
        stroke={withAlpha(Colors.amber, ratio > 0 ? 0.55 : 0.32)}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* The cejch: the etched half-litre line every Czech checks first. */}
      <Line
        x1="7.4"
        y1="20"
        x2="20"
        y2="20"
        stroke={withAlpha(Colors.foam, 0.28)}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* The rim, drawn heavier than the walls so the mug has a lip. */}
      <Rect x="4.5" y="3.5" width="81" height="5" rx="2.5" fill={withAlpha(Colors.amber, 0.5)} />
    </Svg>
  );
});
