import React, { memo } from 'react';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
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

// Foam bubbles inside the glassed foam disk. The single overhead taproom light
// sits up-LEFT, so the foam catches it there: bubbles cluster up-left (brighter,
// larger) and thin out down-right. Three are ring-only (rim of a popped bubble).
// Hand-placed inside the foam disk (center 160,160, r<120). Cap ≈14 nodes.
const FOAM_BUBBLES: Array<{
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  ring?: boolean;
}> = [
  // Lit cluster — up-left, larger and brighter toward the light.
  { cx: 122, cy: 112, r: 4, opacity: 0.45 },
  { cx: 138, cy: 98, r: 2.6, opacity: 0.38 },
  { cx: 108, cy: 134, r: 3.2, opacity: 0.4 },
  { cx: 132, cy: 128, r: 1.8, opacity: 0.3 },
  { cx: 150, cy: 116, r: 2.2, opacity: 0.34 },
  { cx: 116, cy: 150, r: 2.4, opacity: 0.3 },
  // Mid scatter.
  { cx: 168, cy: 134, r: 1.6, opacity: 0.22 },
  { cx: 146, cy: 160, r: 1.4, opacity: 0.2 },
  // Sparse down-right, dimmer.
  { cx: 196, cy: 178, r: 1.6, opacity: 0.16 },
  { cx: 182, cy: 206, r: 1.2, opacity: 0.12 },
  { cx: 210, cy: 150, r: 1, opacity: 0.14 },
  // Ring-only bubbles (popped foam rims).
  { cx: 126, cy: 174, r: 3.4, opacity: 0.22, ring: true },
  { cx: 160, cy: 196, r: 2.6, opacity: 0.22, ring: true },
  { cx: 188, cy: 130, r: 2, opacity: 0.22, ring: true },
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
  const R_ENAMEL = 134;
  const R_FOAM = 120;
  const R_INNER2 = 104;
  const R_MINOR_DOT = 1.6;

  // Tick ring hugs the outer edge of the brass bezel, near R_OUTER=150,
  // so the cardinal ticks sit on/near the brass rim like the mockup.
  const TICK_RING_R = 145;

  // Specular highlight arc on the bezel — the overhead light catches the
  // top-left of the brushed brass. Sweep from 200° to 320° at radius ~142.
  const R_SPECULAR = 142;
  const specStart = degToRad(200 - 90);
  const specEnd = degToRad(320 - 90);
  const specularPath =
    `M ${cx + R_SPECULAR * Math.cos(specStart)} ${cy + R_SPECULAR * Math.sin(specStart)} ` +
    // sweepFlag 1 walks the short way through the far-left edge (lower-left →
    // left → upper-left), tracing the lit side of the bezel rather than the
    // long way round the dark right side.
    `A ${R_SPECULAR} ${R_SPECULAR} 0 0 1 ` +
    `${cx + R_SPECULAR * Math.cos(specEnd)} ${cy + R_SPECULAR * Math.sin(specEnd)}`;

  // Build tick marks
  const ticks: Array<{ x: number; y: number; angleDeg: number; isCardinal: boolean }> = [];
  for (let i = 0; i < 24; i++) {
    const angleDeg = i * 15;
    const isCardinal = i % 6 === 0;
    const rad = degToRad(angleDeg - 90); // -90 so 0 deg is at top
    ticks.push({
      x: cx + TICK_RING_R * Math.cos(rad),
      y: cy + TICK_RING_R * Math.sin(rad),
      angleDeg,
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
      <Defs>
        {/* Brushed brass — diagonal so the light rakes across the rim TL→BR */}
        <LinearGradient id="brassRim" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={Colors.amberLight} />
          <Stop offset="30%" stopColor={Colors.amber} />
          <Stop offset="55%" stopColor={Colors.brassShadow} />
          <Stop offset="80%" stopColor={Colors.amber} />
          <Stop offset="100%" stopColor={Colors.border} />
        </LinearGradient>

        {/* Sculpted foam dome — light pools just above center */}
        <RadialGradient id="foamDisk" cx="50%" cy="42%" r="58%">
          <Stop offset="0%" stopColor={Colors.white} />
          <Stop offset="45%" stopColor={Colors.foam} />
          <Stop offset="100%" stopColor={Colors.foamMuted} />
        </RadialGradient>
      </Defs>

      {/* Brass bezel: brushed outer rim … */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_OUTER}
        fill="url(#brassRim)"
      />

      {/* … and the dark vitreous-enamel face inside it */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_ENAMEL}
        fill={Colors.enamel}
      />

      {/* Single specular highlight raking the lit top-left of the bezel */}
      <Path
        d={specularPath}
        fill="none"
        stroke={Colors.glint}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.7}
      />

      {/* Foam disk — lit dome of beer foam, with a thin rationed amber edge.
          strokeOpacity (not element opacity) keeps the foam fill fully opaque. */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_FOAM}
        fill="url(#foamDisk)"
        stroke={Colors.amber}
        strokeWidth={1.2}
        strokeOpacity={0.5}
      />

      {/* The ONE engraved ring — a guilloché hairline on the foam */}
      <Circle
        cx={cx}
        cy={cy}
        r={R_INNER2}
        fill="none"
        stroke={Colors.engrave}
        strokeWidth={1}
        opacity={0.4}
      />

      {/* Foam bubbles catching the overhead light */}
      {FOAM_BUBBLES.map((bubble, i) => (
        <Circle
          key={`bubble-${i}`}
          cx={bubble.cx}
          cy={bubble.cy}
          r={bubble.r}
          fill={bubble.ring ? 'none' : Colors.white}
          stroke={bubble.ring ? Colors.white : undefined}
          strokeWidth={bubble.ring ? 0.5 : undefined}
          opacity={bubble.opacity}
        />
      ))}

      {/* Tick marks: 4 cardinal brass studs + 20 minor recessed dots at 15° intervals */}
      {ticks.map((tick, i) =>
        tick.isCardinal ? (
          <Rect
            key={`tick-${i}`}
            x={tick.x - 1.4}
            y={tick.y - 4.5}
            width={2.8}
            height={9}
            rx={1.4}
            fill="url(#brassRim)"
            transform={`rotate(${tick.angleDeg} ${tick.x} ${tick.y})`}
          />
        ) : (
          <Circle
            key={`tick-${i}`}
            cx={tick.x}
            cy={tick.y}
            r={R_MINOR_DOT}
            fill={Colors.tickMinor}
            opacity={0.55}
          />
        )
      )}

      {/* Cardinal letters S/V/J/Z — debossed into the enamel */}
      {cardinalPositions.map(({ label, x, y }) => (
        <React.Fragment key={label}>
          {/* Foam twin sitting just below picks out the bottom of the engraving */}
          <SvgText
            x={x}
            y={y + 0.5}
            fontFamily={Fonts.display.extrabold}
            fontSize={20}
            fontWeight="800"
            fill={Colors.foam}
            opacity={0.22}
            textAnchor="middle"
            alignmentBaseline="central"
          >
            {label}
          </SvgText>
          <SvgText
            x={x}
            y={y}
            fontFamily={Fonts.display.extrabold}
            fontSize={20}
            fontWeight="800"
            fill={Colors.stout3}
            textAnchor="middle"
            alignmentBaseline="central"
          >
            {label}
          </SvgText>
        </React.Fragment>
      ))}

    </Svg>
  );
});
