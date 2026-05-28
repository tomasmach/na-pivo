import React, { memo, useMemo } from 'react';
import Svg, { Ellipse, Rect } from 'react-native-svg';
import { Colors } from '@/theme/colors';
import { buildFoamTongues, type FoamTongue } from './foamAnchors';

const SVG_EDGE_PADDING = 28;

interface FoamDripProps {
  width: number;
  height?: number;
  /**
   * Extends the SVG canvas this many pixels above its top edge. Bubbles and cap
   * fill this overhang region, so when the component is positioned with a
   * matching negative `top`, the foam appears to bleed off the screen instead
   * of being chopped flat at the device edge.
   */
  overhang?: number;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

interface Bubble {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  opacity: number;
}

/**
 * Beer foam rendered as densely packed micro-bubbles with a glossy cap.
 * Includes hanging "tongues" of foam that extend lower in random clusters —
 * the FoamDrops anchor visually below these. No spiky drips.
 */
export const FoamDrip = memo(function FoamDrip({
  width,
  height = 180,
  overhang = 0,
}: FoamDripProps) {
  const CAP_HEIGHT = 30;
  const FOAM_BOTTOM = 108; // y where main foam density fades to zero
  const BUBBLE_TOP = -overhang; // bubbles may draw this far above SVG y=0
  const viewBoxX = -SVG_EDGE_PADDING;
  const viewBoxY = BUBBLE_TOP - SVG_EDGE_PADDING;
  const viewBoxWidth = width + SVG_EDGE_PADDING * 2;

  const tongues = useMemo<FoamTongue[]>(
    () => buildFoamTongues(width, FOAM_BOTTOM),
    [width],
  );

  // Pack the main foam region with hundreds of overlapping circles.
  // Mix of micro-bubbles (2-5px), medium bubbles (5-12px), and rare large
  // pockets (12-20px) — matches the bubble-size distribution of real beer head.
  const bubbles = useMemo(() => {
    const result: Bubble[] = [];
    const targetDensity = (width * (FOAM_BOTTOM - BUBBLE_TOP)) / 22;
    const count = Math.round(targetDensity);

    for (let i = 0; i < count; i++) {
      const r0 = seededRandom(i * 13);
      const r1 = seededRandom(i * 17);
      const r2 = seededRandom(i * 19);
      const r3 = seededRandom(i * 23);
      const r4 = seededRandom(i * 29);
      const r5 = seededRandom(i * 31);

      const yT = r1;
      const dropChance = Math.pow(yT, 1.5);
      if (r2 < dropChance) continue;

      const cy = BUBBLE_TOP + yT * (FOAM_BOTTOM - BUBBLE_TOP);
      const cx = r0 * width;

      // Bubble size distribution: mostly small, occasionally medium, rarely large.
      let r: number;
      if (r5 > 0.94) {
        r = 12 + r3 * 8; // rare large pocket
      } else if (r5 > 0.72) {
        r = 6 + r3 * 6; // medium bubble
      } else {
        r = 2 + r3 * 4; // micro-bubble (most common)
      }

      let fill: string = Colors.foam;
      let opacity = 1;
      if (r4 < 0.18) {
        fill = Colors.foamMuted;
        opacity = 0.92;
      } else if (r4 > 0.94) {
        fill = Colors.white;
        opacity = 0.85;
      } else {
        opacity = 0.97;
      }

      result.push({ cx, cy, r, fill, opacity });
    }
    return result;
  }, [width, BUBBLE_TOP]);

  // Bubbles inside each hanging tongue.
  const tongueBubbles = useMemo(() => {
    const result: Bubble[] = [];
    tongues.forEach((tongue, idx) => {
      const span = tongue.bottomY - tongue.topY;
      const bubblesPerTongue = Math.round(span * 1.1);
      for (let i = 0; i < bubblesPerTongue; i++) {
        const seed = idx * 1000 + i;
        const yT = seededRandom(seed * 7);
        const cy = tongue.topY + yT * span;
        // Width narrows steeply toward the tip for a proper drip shape.
        const widthScale = Math.pow(1 - yT, 0.7);
        const xOffset = (seededRandom(seed * 11) - 0.5) * tongue.width * widthScale;
        const cx = tongue.centerX + xOffset;
        // Bubbles get smaller as the tongue narrows toward the tip.
        const sizeRoll = seededRandom(seed * 13);
        const r = (1.8 + sizeRoll * 5.5) * (0.6 + widthScale * 0.6);
        const colorRoll = seededRandom(seed * 17);
        const fill = colorRoll < 0.18
          ? Colors.foamMuted
          : colorRoll > 0.93
            ? Colors.white
            : Colors.foam;
        const opacity = colorRoll > 0.93 ? 0.78 : 0.95;
        result.push({ cx, cy, r, fill, opacity });
      }
    });
    return result;
  }, [tongues]);

  // Dark crevice shadows between bubble clusters — adds visual depth.
  const crevices = useMemo(() => {
    const items: { cx: number; cy: number; r: number; opacity: number }[] = [];
    for (let i = 0; i < 22; i++) {
      const yT = seededRandom(i * 31);
      items.push({
        cx: seededRandom(i * 37) * width,
        cy: BUBBLE_TOP + 4 + yT * (FOAM_BOTTOM - BUBBLE_TOP - 8),
        r: 1 + seededRandom(i * 41) * 2.5,
        opacity: 0.12 + seededRandom(i * 43) * 0.12,
      });
    }
    return items;
  }, [width, BUBBLE_TOP]);

  // Tiny bright highlights scattered on the foam surface — reflective sheen.
  const sparkles = useMemo(() => {
    const items: { cx: number; cy: number; r: number; opacity: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const yT = seededRandom(i * 53);
      items.push({
        cx: seededRandom(i * 47) * width,
        cy: BUBBLE_TOP + 4 + yT * (FOAM_BOTTOM - BUBBLE_TOP - 30),
        r: 1 + seededRandom(i * 59) * 1.6,
        opacity: 0.55 + seededRandom(i * 61) * 0.35,
      });
    }
    return items;
  }, [width, BUBBLE_TOP]);

  // Top-edge glossy highlights along the cap.
  const topHighlights = useMemo(() => {
    const spots: { cx: number; cy: number; rx: number; ry: number }[] = [];
    let i = 0;
    for (let cx = 18; cx < width; cx += 56) {
      spots.push({
        cx: cx + seededRandom(i * 67) * 18,
        cy: BUBBLE_TOP + 6 + seededRandom(i * 71) * 3,
        rx: 12 + seededRandom(i * 73) * 8,
        ry: 2.5,
      });
      i += 1;
    }
    return spots;
  }, [width, BUBBLE_TOP]);

  const svgHeight = height + overhang + SVG_EDGE_PADDING;

  return (
    <Svg
      width={width + SVG_EDGE_PADDING * 2}
      height={svgHeight}
      viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${svgHeight}`}
      style={{ marginLeft: -SVG_EDGE_PADDING }}
    >
      {/* Solid foam cap across the top — extended up by overhang so the cap
          fills any area above the visible screen edge without leaving gaps. */}
      <Rect
        x={viewBoxX}
        y={viewBoxY}
        width={viewBoxWidth}
        height={CAP_HEIGHT - viewBoxY}
        fill={Colors.foam}
      />

      {/* Main foam bubble field */}
      {bubbles.map((b, i) => (
        <Ellipse
          key={`b-${i}`}
          cx={b.cx}
          cy={b.cy}
          rx={b.r}
          ry={b.r}
          fill={b.fill}
          opacity={b.opacity}
        />
      ))}

      {/* Hanging tongues of foam extending below */}
      {tongueBubbles.map((b, i) => (
        <Ellipse
          key={`t-${i}`}
          cx={b.cx}
          cy={b.cy}
          rx={b.r}
          ry={b.r}
          fill={b.fill}
          opacity={b.opacity}
        />
      ))}

      {/* Crevice shadows for definition */}
      {crevices.map((c, i) => (
        <Ellipse
          key={`cr-${i}`}
          cx={c.cx}
          cy={c.cy}
          rx={c.r}
          ry={c.r}
          fill={Colors.stout}
          opacity={c.opacity}
        />
      ))}

      {/* Sparkle reflections */}
      {sparkles.map((s, i) => (
        <Ellipse
          key={`s-${i}`}
          cx={s.cx}
          cy={s.cy}
          rx={s.r}
          ry={s.r}
          fill={Colors.white}
          opacity={s.opacity}
        />
      ))}

      {/* Glossy highlights along the cap top edge */}
      {topHighlights.map((h, i) => (
        <Ellipse
          key={`hl-${i}`}
          cx={h.cx}
          cy={h.cy}
          rx={h.rx}
          ry={h.ry}
          fill={Colors.white}
          opacity={0.45}
        />
      ))}
    </Svg>
  );
});
