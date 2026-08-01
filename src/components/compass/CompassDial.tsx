import React, { memo } from 'react';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { Colors } from '@/theme/colors';

import { CompassSize } from '@/theme/layout';

interface CompassDialProps {
  size?: number;
}

// Cardinal letters in Czech compass order:
// S = Sever (North), V = Východ (East), J = Jih (South), Z = Západ (West)
const CARDINALS: Array<{ label: string; angleDeg: number }> = [
  { label: 'S', angleDeg: 0 },   // top = North
  { label: 'V', angleDeg: 90 },  // right = East
  { label: 'J', angleDeg: 180 }, // bottom = South
  { label: 'Z', angleDeg: 270 }, // left = West
];

// Letters sit inside the inner gold ring (R_INNER2=104), one ring closer
// to the center than the foam edge.
const CARDINAL_DISTANCE = 88;

// Decorative dot texture inside foam disk
const TEXTURE_DOTS: Array<{ cx: number; cy: number; r: number }> = [
  { cx: 135, cy: 120, r: 3 },
  { cx: 180, cy: 100, r: 2 },
  { cx: 200, cy: 150, r: 2.5 },
  { cx: 175, cy: 200, r: 2 },
  { cx: 130, cy: 190, r: 3 },
  { cx: 110, cy: 155, r: 2 },
];

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export const CompassDial = memo(function CompassDial({ size = CompassSize }: CompassDialProps) {
  // All geometry is authored in the 320pt design space and projected onto the
  // rendered `size` by the SVG viewBox below. Computing cx/cy from `size`
  // instead of CompassSize is what cropped the dial whenever size !== 320
  // (e.g. the smaller compass on iPad's iPhone-compatibility window).
  const cx = CompassSize / 2;
  const cy = CompassSize / 2;

  // Radii (at default 320px)
  const R_OUTER = 150;
  const R_INNER_RING = 132;
  const R_FOAM = 120;
  const R_INNER2 = 104;
  const R_CARDINAL_DOT = 4;
  const R_MINOR_DOT = 1.8;

  // Tick ring hugs the outer edge of the dark brown band, near R_OUTER=150,
  // so the cardinal dots sit on/near the outer gold stroke like the mockup.
  const TICK_RING_R = 145;

  // Build tick marks
  const ticks: Array<{ x: number; y: number; isCardinal: boolean }> = [];
  for (let i = 0; i < 24; i++) {
    const angleDeg = i * 15;
    const isCardinal = i % 6 === 0;
    const rad = degToRad(angleDeg - 90); // -90 so 0 deg is at top
    ticks.push({
      x: cx + TICK_RING_R * Math.cos(rad),
      y: cy + TICK_RING_R * Math.sin(rad),
      isCardinal,
    });
  }

  // Cardinal label positions
  const cardinalPositions = CARDINALS.map(({ label, angleDeg }) => {
    const rad = degToRad(angleDeg - 90);
    return {
      label,
      x: cx + CARDINAL_DISTANCE * Math.cos(rad),
      y: cy + CARDINAL_DISTANCE * Math.sin(rad),
    };
  });

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${CompassSize} ${CompassSize}`}
    >
      {/* Layer 2: Outer ring */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_OUTER}
        fill={Colors.stout3}
        stroke={Colors.amber}
        strokeWidth={3}
      />

      {/* Layer 3: Inner concentric ring */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_INNER_RING}
        fill="none"
        stroke={Colors.amber}
        strokeWidth={1}
        opacity={0.45}
      />

      {/* Layer 4: Foam disk — gold stroke creates the inner ring at the foam edge */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_FOAM}
        fill={Colors.foam}
        stroke={Colors.amber}
        strokeWidth={1.5}
        opacity={1}
      />

      {/* Layer 5: Inner ring on top of foam */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_INNER2}
        fill="none"
        stroke={Colors.amber}
        strokeWidth={1}
        opacity={0.55}
      />

      {/* Decorative texture dots inside foam disk */}
      {TEXTURE_DOTS.map((dot, i) => (
        <Circle
          key={`texture-${i}`}
          cx={dot.cx}
          cy={dot.cy}
          r={dot.r}
          fill={Colors.white}
          opacity={0.55}
        />
      ))}

      {/* Tick marks: 4 cardinal + 20 minor at 15° intervals */}
      {ticks.map((tick, i) => (
        <Circle
          key={`tick-${i}`}
          cx={tick.x}
          cy={tick.y}
          r={tick.isCardinal ? R_CARDINAL_DOT : R_MINOR_DOT}
          fill={tick.isCardinal ? Colors.amber : Colors.mutedText}
          opacity={tick.isCardinal ? 1 : 0.7}
        />
      ))}

      {/* Cardinal letters S/V/J/Z */}
      {cardinalPositions.map(({ label, x, y }) => (
        <SvgText
          key={label}
          x={x}
          y={y}
          fontSize={20}
          fontWeight="800"
          fill={Colors.stout}
          textAnchor="middle"
          alignmentBaseline="central"
        >
          {label}
        </SvgText>
      ))}

    </Svg>
  );
});
