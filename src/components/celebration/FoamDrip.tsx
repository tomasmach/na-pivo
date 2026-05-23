import React, { memo, useMemo } from 'react';
import Svg, { Ellipse, Rect } from 'react-native-svg';
import { Colors } from '@/theme/colors';

interface FoamDripProps {
  width: number;
  height?: number;
}

/**
 * Beer foam dripping down from the top of the screen.
 *
 * Geometry mirrors the design's ESHlJ frame:
 *   - 24px solid foam cap across the top
 *   - row of overlapping round bumps (42×34) along the cap's underside
 *   - a few thin vertical drip ellipses hanging at scattered positions
 *   - small foam droplets below for splatter
 */
export const FoamDrip = memo(function FoamDrip({ width, height = 100 }: FoamDripProps) {
  const CAP_HEIGHT = 24;
  const BUMP_W = 42;
  const BUMP_H = 34;
  const BUMP_RX = BUMP_W / 2;
  const BUMP_RY = BUMP_H / 2;
  const BUMP_STEP = 36; // bumps overlap by 6px

  const bumps = useMemo(() => {
    const items: { cx: number; cy: number }[] = [];
    // Start before the left edge so first bump is partially off-screen, matching design.
    for (let cx = -BUMP_RX + 5; cx < width + BUMP_RX; cx += BUMP_STEP) {
      items.push({ cx, cy: CAP_HEIGHT + 1 });
    }
    return items;
  }, [width]);

  // Drip ellipses: fractions across width + height. Positions tuned to design.
  const drips = useMemo(() => {
    const dripDefs: ReadonlyArray<readonly [number, number]> = [
      [0.13, 50],
      [0.33, 68],
      [0.54, 38],
      [0.72, 58],
      [0.86, 44],
    ];
    return dripDefs.map(([frac, h]) => ({
      cx: width * frac,
      cy: CAP_HEIGHT + 8 + h / 2,
      rx: 7,
      ry: h / 2,
    }));
  }, [width]);

  // Tiny droplets scattered below the drips.
  const droplets = useMemo(() => {
    const dropDefs: ReadonlyArray<readonly [number, number, number]> = [
      [0.16, 88, 4],
      [0.35, 96, 3.5],
      [0.55, 90, 4.5],
      [0.77, 94, 3],
      [0.92, 86, 3.5],
    ];
    return dropDefs.map(([frac, cy, r]) => ({
      cx: width * frac,
      cy,
      r,
    }));
  }, [width]);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Solid foam cap */}
      <Rect x={0} y={0} width={width} height={CAP_HEIGHT} fill={Colors.foam} />

      {/* Round bumps along the underside */}
      {bumps.map((b, i) => (
        <Ellipse
          key={`bump-${i}`}
          cx={b.cx}
          cy={b.cy}
          rx={BUMP_RX}
          ry={BUMP_RY}
          fill={Colors.foam}
        />
      ))}

      {/* Thin vertical drip ellipses */}
      {drips.map((d, i) => (
        <Ellipse
          key={`drip-${i}`}
          cx={d.cx}
          cy={d.cy}
          rx={d.rx}
          ry={d.ry}
          fill={Colors.foam}
        />
      ))}

      {/* Small droplets */}
      {droplets.map((d, i) => (
        <Ellipse
          key={`drop-${i}`}
          cx={d.cx}
          cy={d.cy}
          rx={d.r}
          ry={d.r}
          fill={Colors.foam}
          opacity={0.9}
        />
      ))}
    </Svg>
  );
});
