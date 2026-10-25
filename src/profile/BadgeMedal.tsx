/**
 * Badge medals (DESIGN.md §9 "Medaile odznaků"). A family is one medal that grows
 * a piece of minting with every level: plain coin, riveted rim, bottle-cap crown,
 * crown with a wreath. The level reads from the outline, so it survives grayscale.
 * One-off moments are square plaques, collections are rings that fill their slots.
 * Everything is drawn in a 100 × 100 box from plain shapes and token colours.
 */

import React, { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { BadgeKey, BadgeState } from '@/profile/badgeModel';
import { medalFrame } from '@/profile/badgeModel';
import { Colors, withAlpha } from '@/theme/colors';

/** Blind is a locked medal; preview is the same relief a step brighter, for the next goal. */
type Tone = 'copper' | 'tin' | 'gold' | 'top' | 'blind' | 'preview';

export type MedalLook =
  | { shape: 'coin'; frame: 1 | 2 | 3 | 4; tone: Tone }
  | { shape: 'ring'; tone: Tone; filled?: readonly boolean[] }
  | { shape: 'plaque'; tone: Tone }
  | { shape: 'secret' };

const FRAME_TONE: Record<1 | 2 | 3 | 4, Tone> = { 1: 'copper', 2: 'tin', 3: 'gold', 4: 'top' };

/** How a badge looks at `tier` (its current level by default). */
export function medalLook(state: BadgeState, tier = state.tier): MedalLook {
  const earned = tier > 0 && tier <= state.tier;
  if (state.kind === 'once') {
    if (state.secret && state.tier === 0) return { shape: 'secret' };
    return { shape: 'plaque', tone: earned ? (state.volume ? 'tin' : 'gold') : 'blind' };
  }
  if (state.kind === 'slots') {
    if (earned) return { shape: 'ring', tone: 'gold' };
    const slots = new Set(state.slots);
    const filled = state.key === 'weekdays'
      ? Array.from({ length: 7 }, (_, day) => slots.has(day))
      : Array.from({ length: 12 }, (_, month) => slots.has(month + 1));
    return { shape: 'ring', tone: 'blind', filled };
  }
  if (tier === 0) return { shape: 'coin', frame: 1, tone: 'blind' };
  const frame = medalFrame(tier, state.tiers.length);
  return { shape: 'coin', frame, tone: earned ? (state.volume ? 'tin' : FRAME_TONE[frame]) : 'blind' };
}

/** The next level of a family, a step brighter than a locked medal: the thing to chase. */
export function goalLook(state: BadgeState): MedalLook {
  const look = medalLook(state, state.tier + 1);
  return look.shape === 'coin' && look.tone === 'blind' ? { ...look, tone: 'preview' } : look;
}

/** Solid colour of `top` at `alpha` over the ground, so stacked shapes never double up. */
function over(top: string, alpha: number, base: string = Colors.stout): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(top, i) * alpha + channel(base, i) * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
function pol(r: number, deg: number, cx = 50, cy = 50): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
}

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const [x, y] = pol(i % 2 ? inner : outer, -90 + i * 36, cx, cy);
    d += `${i ? 'L' : 'M'}${x} ${y}`;
  }
  return `${d}Z`;
}

/** Rounded flutes around a circle: the bottle-cap crown. */
function flutePath(n: number, valley: number, crest: number): string {
  const step = 360 / n;
  const [x, y] = pol(valley, -90 - step / 2);
  let d = `M${x} ${y}`;
  for (let i = 0; i < n; i++) {
    const [cx, cy] = pol(crest, -90 + i * step);
    const [ex, ey] = pol(valley, -90 + i * step + step / 2);
    d += `Q${cx} ${cy} ${ex} ${ey}`;
  }
  return `${d}Z`;
}

function arcPath(r: number, from: number, to: number): string {
  const [x0, y0] = pol(r, from);
  const [x1, y1] = pol(r, to);
  return `M${x0} ${y0}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

function sector(inner: number, outer: number, from: number, to: number): string {
  const [ax, ay] = pol(outer, from);
  const [bx, by] = pol(outer, to);
  const [cx, cy] = pol(inner, to);
  const [dx, dy] = pol(inner, from);
  return `M${ax} ${ay}A${outer} ${outer} 0 0 1 ${bx} ${by}L${cx} ${cy}A${inner} ${inner} 0 0 0 ${dx} ${dy}Z`;
}

const chamfer = (a: number, b: number, c: number) =>
  `M${a + c} ${a}H${b - c}L${b} ${a + c}V${b - c}L${b - c} ${b}H${a + c}L${a} ${b - c}V${a + c}Z`;

const CROWN = flutePath(21, 36.4, 43.4);
const STAR = starPath(50, 46.5, 12, 5.2);
const PLAQUE = chamfer(20, 80, 13);
const PLAQUE_INNER = chamfer(25.5, 74.5, 10);

const line = (width: number) =>
  ({ strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;

interface Slots {
  filled: readonly boolean[];
  on: string;
  off: string;
}

/** I = ink, K = knockout (the colour the motif sits on). */
type Motif = (I: string, K: string, slots?: Slots) => React.ReactNode;

const MOTIFS: Record<BadgeKey | 'secret', Motif> = {
  beers: (I) => (
    <>
      <Path d="M35 31V69M44 31V69M53 31V69M62 31V69" stroke={I} {...line(5.4)} />
      <Path d="M28.5 63L69.5 36.5" stroke={I} {...line(5.4)} />
    </>
  ),
  pubs: (I, K) => (
    <>
      <Path d="M50 29V75M40.5 75H59.5" stroke={I} {...line(5)} />
      <Path
        d="M46 31.5H67L74.5 39L67 46.5H46ZM54 51.5H33L25.5 59L33 66.5H54Z"
        stroke={I}
        {...line(2.5)}
        fill={I}
      />
      <Path d="M51 39H65.5M49 59H34.5" stroke={K} {...line(2.4)} />
    </>
  ),
  regular: (I, K) => (
    <>
      <Rect x={30} y={34} width={31} height={39} rx={5.5} fill={I} />
      <Path d="M61 42H66A6 6 0 0 1 72 48V58A6 6 0 0 1 66 64H61" fill="none" stroke={I} strokeWidth={5} />
      <Path
        d="M27.5 38C27 31.5 31.5 28 36 29.3C38 25.6 44.5 24.6 47.5 27.6C50.6 25 57 25.6 59 30C63 30 64.8 34 63.5 38Z"
        fill={I}
      />
      <Path
        d="M45.5 64C45.5 64 35.5 58 35.5 51.2C35.5 47.8 38.1 45.4 41 45.4C43 45.4 44.6 46.5 45.5 48C46.4 46.5 48 45.4 50 45.4C52.9 45.4 55.5 47.8 55.5 51.2C55.5 58 45.5 64 45.5 64Z"
        fill={K}
      />
    </>
  ),
  tasted: (I, K) => (
    <>
      <Rect x={23} y={63} width={54} height={7.5} rx={3.75} fill={I} />
      <Path
        d="M29 43H41L39.6 63H30.4ZM45 31H55L53.6 63H46.4ZM59 41H71C71 49.5 68.6 53.3 66.5 55V63H63.5V55C61.4 53.3 59 49.5 59 41Z"
        fill={I}
      />
      <Path d="M30.6 48.5H39.4M46.2 37H53.8M60.2 46.5H69.8" stroke={K} {...line(2.4)} />
    </>
  ),
  cities: (I, K) => (
    <>
      <Path d="M23 72.5H77" stroke={I} {...line(4.5)} />
      <Path d="M29 72V46L34.5 30L40 46V72ZM43 72V55L50 47.5L57 55V72ZM60 72V43H71V72ZM60 43A5.5 5.5 0 0 1 71 43Z" fill={I} />
      <Path d="M65.5 37.5V31" stroke={I} {...line(2.6)} />
      <Path d="M34.5 50V55.5M65.5 49V54M65.5 60V64.5" stroke={K} {...line(2.6)} />
      <Rect x={47.5} y={61} width={5} height={11} rx={1} fill={K} />
    </>
  ),
  weeks: (I) => (
    <>
      <Path d="M27 40A6 6 0 0 1 33 34H67A6 6 0 0 1 73 40V67A6 6 0 0 1 67 73H33A6 6 0 0 1 27 67Z" stroke={I} {...line(4.5)} />
      <Path d="M27 40A6 6 0 0 1 33 34H67A6 6 0 0 1 73 40V45H27Z" fill={I} />
      <Path d="M38 28.5V37M62 28.5V37" stroke={I} {...line(4.5)} />
      <Path d="M39 58.5L46 65.5L61 50.5" stroke={I} {...line(5.2)} />
    </>
  ),
  ratings: (I) => (
    <>
      <Path
        d="M33 29H67A7 7 0 0 1 74 36V56A7 7 0 0 1 67 63H47L36 72.5V63H33A7 7 0 0 1 26 56V36A7 7 0 0 1 33 29Z"
        stroke={I}
        {...line(4.5)}
      />
      <Path d={STAR} stroke={I} {...line(1.6)} fill={I} />
    </>
  ),
  friends: (I, K) => (
    <>
      <Circle cx={33.5} cy={38} r={7.2} fill={I} />
      <Circle cx={66.5} cy={38} r={7.2} fill={I} />
      <Path
        d="M20.5 66V61C20.5 54 25.5 49.5 33.5 49.5C41.5 49.5 46.5 54 46.5 61V66ZM53.5 66V61C53.5 54 58.5 49.5 66.5 49.5C74.5 49.5 79.5 54 79.5 61V66Z"
        fill={I}
      />
      <Circle cx={50} cy={42.5} r={10.2} fill={I} stroke={K} strokeWidth={3.4} />
      <Path
        d="M31 75V69.5C31 60.5 38.5 55 50 55C61.5 55 69 60.5 69 69.5V75Z"
        fill={I}
        stroke={K}
        strokeWidth={3.4}
        strokeLinejoin="round"
      />
    </>
  ),
  mapped: (I, K) => (
    <>
      <Path d="M25 35L40 29L60 35L75 29V67L60 73L40 67L25 73Z" stroke={I} {...line(4.2)} />
      <Path d="M40 29V67M60 35V73" stroke={I} {...line(3)} />
      <Path
        d="M50 65C50 65 39.5 55 39.5 47.5A10.5 10.5 0 0 1 60.5 47.5C60.5 55 50 65 50 65Z"
        stroke={K}
        {...line(3)}
        fill={I}
      />
      <Circle cx={50} cy={47.5} r={3.8} fill={K} />
    </>
  ),
  firstMaps: (I) => (
    <>
      <Path d="M21 74C30 62 41 56.5 50.5 56.5C60 56.5 70 62 79 74Z" fill={I} />
      <Path d="M45 59V27.5" stroke={I} {...line(4.2)} />
      <Path d="M45 28.5L69 36L45 43.5Z" stroke={I} {...line(2)} fill={I} />
    </>
  ),
  completed: (I) => (
    <>
      <Rect x={31} y={30.5} width={38} height={43} rx={5} stroke={I} {...line(4.5)} />
      <Rect x={41} y={25} width={18} height={10} rx={3} fill={I} />
      <Path d="M37.5 46.5L41 50L47.5 43.5M37.5 60L41 63.5L47.5 57M53 47H62.5M53 60.5H62.5" stroke={I} {...line(3.8)} />
    </>
  ),
  facts: (I) => (
    <>
      <Circle cx={45} cy={45} r={14} fill="none" stroke={I} strokeWidth={5.5} />
      <Path d="M55.5 55.5L71 71" stroke={I} {...line(8.5)} />
      <Path d="M37.5 42A8.5 8.5 0 0 1 42.5 36.8" stroke={I} {...line(3)} />
    </>
  ),
  photos: (I, K) => (
    <>
      <Path
        d="M24 44A7 7 0 0 1 31 37H37.5L42 30H58L62.5 37H69A7 7 0 0 1 76 44V64A7 7 0 0 1 69 71H31A7 7 0 0 1 24 64Z"
        fill={I}
      />
      <Circle cx={50} cy={54} r={12} fill={K} />
      <Circle cx={50} cy={54} r={7.5} fill={I} />
      <Circle cx={47} cy={51} r={2.2} fill={K} />
      <Circle cx={68} cy={44.5} r={2.4} fill={K} />
    </>
  ),
  contest: (I, K) => (
    <>
      <Path d="M35 28H65V40C65 49 58.3 56 50 56C41.7 56 35 49 35 40Z" fill={I} />
      <Path
        d="M35.5 32.5H29.5V37C29.5 42.5 33 45.5 37.5 46M64.5 32.5H70.5V37C70.5 42.5 67 45.5 62.5 46"
        stroke={I}
        {...line(4)}
      />
      <Path d="M46.5 55H53.5V65H46.5Z" fill={I} />
      <Rect x={37} y={64.5} width={26} height={8} rx={2.5} fill={I} />
      <Circle cx={50} cy={40} r={7} fill="none" stroke={K} strokeWidth={2.6} />
      <Circle cx={50} cy={40} r={2.4} fill={K} />
    </>
  ),
  softDrinks: (I, K) => (
    <>
      <Path
        d="M22 64V56.5C22 54 23.6 52.4 26 51.8L34.5 49.8L41.5 41.2C42.6 39.8 44.2 39 46 39H57C58.9 39 60.6 39.9 61.6 41.5L67 49.8L74 51.4C76.4 52 78 54 78 56.5V64Z"
        fill={I}
      />
      <Path d="M44.5 43.5H49.5V49.8H39.2ZM53 43.5H57L61 49.8H53Z" fill={K} />
      {[35, 65].map((cx) => (
        <G key={cx}>
          <Circle cx={cx} cy={64.5} r={9} fill={K} />
          <Circle cx={cx} cy={64.5} r={6.2} fill={I} />
          <Circle cx={cx} cy={64.5} r={2.2} fill={K} />
        </G>
      ))}
    </>
  ),
  weekdays: (I, _K, slots) => (
    <>
      <Circle cx={50} cy={50} r={5} fill={I} />
      {Array.from({ length: 7 }, (_, day) => {
        const [x, y] = pol(18.5, -90 + day * (360 / 7));
        return slots && !slots.filled[day] ? (
          <Circle key={day} cx={x} cy={y} r={4.6} fill="none" stroke={slots.off} strokeWidth={1.8} />
        ) : (
          <Circle key={day} cx={x} cy={y} r={5.6} fill={slots?.on ?? I} />
        );
      })}
    </>
  ),
  months: (I, _K, slots) => (
    <>
      <Circle cx={50} cy={50} r={5} fill={I} />
      {Array.from({ length: 12 }, (_, month) => {
        const from = -90 + month * 30 + 2.5;
        return slots && !slots.filled[month] ? (
          <Path key={month} d={sector(18, 32, from + 1, from + 24)} fill="none" stroke={slots.off} strokeWidth={2.2} />
        ) : (
          <Path key={month} d={sector(17, 33, from, from + 25)} fill={slots?.on ?? I} />
        );
      })}
    </>
  ),
  outsidePub: (I, K) => (
    <>
      <Path d="M29 49V72H71V49L50 32Z" fill={I} />
      <Path d="M61 31.5H68V44.5L61 39Z" fill={I} />
      <Path d="M21.5 51.5L50 28L78.5 51.5" stroke={I} {...line(5)} />
      <Rect x={45} y={57} width={10} height={15} rx={1.5} fill={K} />
      <Rect x={33.5} y={55} width={8} height={7} rx={1.2} fill={K} />
      <Rect x={58.5} y={55} width={8} height={7} rx={1.2} fill={K} />
    </>
  ),
  outdoors: (I) => (
    <>
      <Path
        d="M40 27L52 45H46.5L55 59H43V70H37V59H25L33.5 45H28ZM63.5 39L72.5 52H68.5L75 62.5H66V70H61V62.5H52L58.5 52H54.5Z"
        stroke={I}
        {...line(1.4)}
        fill={I}
      />
      <Path d="M66 17.5L68 23L73.5 25L68 27L66 32.5L64 27L58.5 25L64 23Z" fill={I} />
      <Path d="M22 72.5H78" stroke={I} {...line(3.8)} />
    </>
  ),
  bottles: (I, K) => (
    <>
      <Path
        d="M37 74V50C37 46.5 38.6 44.2 40.5 42.2V31H48.5V42.2C50.4 44.2 52 46.5 52 50V74Z"
        stroke={I}
        {...line(2)}
        fill={I}
      />
      <Rect x={39.5} y={26.5} width={10} height={4.5} rx={1.2} fill={I} />
      <Rect x={40.5} y={55} width={8} height={11} rx={1.2} fill={K} />
      <Circle cx={58.5} cy={47} r={2.7} fill={I} />
      <Circle cx={63.8} cy={38} r={3.7} fill={I} />
      <Circle cx={70} cy={27.5} r={5.1} fill={I} />
    </>
  ),
  cans: (I, K) => (
    <>
      <Path
        d="M35 35.5C35 32.5 37.2 30.5 40 30.5H60C62.8 30.5 65 32.5 65 35.5V69.5C65 72.5 62.8 74.5 60 74.5H40C37.2 74.5 35 72.5 35 69.5Z"
        fill={I}
      />
      <Path d="M38.5 37.5H61.5M38.5 67.5H61.5" stroke={K} {...line(2.4)} />
      <Path d="M38 54C43.5 50.5 56.5 57.5 62 54" stroke={K} {...line(2.8)} />
      <Path d="M44.5 30.5V27A5.5 5.5 0 0 1 55.5 27V30.5" stroke={I} {...line(3.4)} />
    </>
  ),
  nightOwl: (I, K) => (
    <>
      <Path
        d="M31 39L34 25.5L44 34C47.8 33 52.2 33 56 34L66 25.5L69 39C72.5 47.5 71.5 59 64.5 66C59 71.5 41 71.5 35.5 66C28.5 59 27.5 47.5 31 39Z"
        fill={I}
      />
      <Circle cx={42.5} cy={46} r={7.2} fill={K} />
      <Circle cx={57.5} cy={46} r={7.2} fill={K} />
      <Circle cx={43.5} cy={47} r={3.2} fill={I} />
      <Circle cx={56.5} cy={47} r={3.2} fill={I} />
      <Path d="M47.3 54L50 59.5L52.7 54Z" fill={K} />
      <Path d="M42 63.5L45.3 66L48.5 63.5L51.7 66L55 63.5" stroke={K} {...line(2.2)} />
    </>
  ),
  lunch: (I) => (
    <>
      <Circle cx={50} cy={52} r={14.5} fill="none" stroke={I} strokeWidth={4.5} />
      <Circle cx={50} cy={52} r={7.5} fill="none" stroke={I} strokeWidth={2.6} />
      <Path
        d="M23.5 29V39.5C23.5 42.5 25.2 44 27 44.2M30.5 29V39.5C30.5 42.5 28.8 44 27 44.2M27 44.2V74M27 29V38"
        stroke={I}
        {...line(3.4)}
      />
      <Path d="M73 74V48.5" stroke={I} {...line(4.8)} />
      <Path d="M75.5 28.5C69.5 31 68.5 41 69 49.5H75.5Z" stroke={I} {...line(1.5)} fill={I} />
    </>
  ),
  christmasEve: (I, K) => (
    <>
      <Path
        d="M23 52C29.5 41 43.5 36.5 56.5 43L69.5 34.5C71.8 40.5 71.8 45 69.6 51.5C71.8 58 71.8 62.5 69.5 68.5L56.5 60.5C43.5 67 29.5 63 23 52Z"
        fill={I}
      />
      <Path d="M41.5 41.5L48.5 32.5L55.5 42.5Z" stroke={I} {...line(1.6)} fill={I} />
      <Circle cx={31.5} cy={49.5} r={2.7} fill={K} />
      <Path
        d="M38 44C41 48 41 56 38 60M45.5 46C48 49 48 55 45.5 58M52.5 46.5C55 49.3 55 54.7 52.5 57.5"
        stroke={K}
        {...line(2.2)}
      />
    </>
  ),
  newYearsEve: (I) => (
    <>
      <Circle cx={50} cy={50} r={4.8} fill={I} />
      {Array.from({ length: 8 }, (_, k) => {
        const [x0, y0] = pol(10.5, k * 45);
        const [x1, y1] = pol(21, k * 45);
        const [dx, dy] = pol(25, 22.5 + k * 45);
        return (
          <G key={k}>
            <Path d={`M${x0} ${y0}L${x1} ${y1}`} stroke={I} {...line(4.6)} />
            <Circle cx={dx} cy={dy} r={2.7} fill={I} />
          </G>
        );
      })}
    </>
  ),
  beerDay: (I, K) => (
    <>
      <Path d="M50 29.5C50 25 52.5 21.5 57 20.5" stroke={I} {...line(3)} />
      <Path d="M55.5 21.5C61 16.5 69.5 17.5 73 23C66.5 27.5 60 26.5 55.5 21.5Z" fill={I} />
      <Path
        d="M50 28C59.5 32 65.5 41.5 64.5 52.5C63.5 63 56.5 71.5 50 76C43.5 71.5 36.5 63 35.5 52.5C34.5 41.5 40.5 32 50 28Z"
        fill={I}
      />
      <Path
        d="M37.5 43.5Q43.5 49.5 50 44.5Q56.5 49.5 62.5 43.5M36 55Q43 61.5 50 56Q57 61.5 64 55M40 66Q45.5 71 50 67Q54.5 71 60 66"
        stroke={K}
        {...line(2.4)}
      />
    </>
  ),
  secret: (I) => (
    <>
      <Path
        d="M39.5 40.5C39.5 34 44.6 29.5 50.5 29.5C56.6 29.5 61 33.6 61 39.2C61 43.8 58.3 46.3 54.8 48.4C51.8 50.2 50.5 52.2 50.5 56V58.5"
        stroke={I}
        {...line(6.5)}
      />
      <Circle cx={50.5} cy={68.5} r={4.2} fill={I} />
    </>
  ),
};

interface Palette {
  body: string;
  ink: string;
  detail: string;
  /** Outline of a locked medal; minted ones have none. */
  edge: string | null;
  highlight: string;
  shade: string;
}

function palette(tone: Tone): Palette {
  if (tone === 'blind' || tone === 'preview') {
    const preview = tone === 'preview';
    const line = over(Colors.foam, preview ? 0.3 : 0.2);
    return {
      body: over(Colors.foam, preview ? 0.08 : 0.06),
      ink: over(Colors.foam, preview ? 0.5 : 0.34),
      detail: line,
      edge: line,
      highlight: line,
      shade: line,
    };
  }
  const tin = tone === 'tin';
  return {
    body: { copper: Colors.mutedText, tin: over(Colors.foamMuted, 0.86), gold: Colors.amber, top: Colors.amber }[tone],
    ink: Colors.stout,
    detail: withAlpha(Colors.stout, tin ? 0.3 : 0.36),
    edge: null,
    highlight: tin ? withAlpha(Colors.foam, 0.95) : tone === 'copper' ? withAlpha(Colors.foam, 0.6) : Colors.neon,
    shade: withAlpha(Colors.stout, tin ? 0.2 : 0.3),
  };
}

function motif(badge: BadgeKey | 'secret', ink: string, knockout: string, scale: number, slots?: Slots) {
  return (
    <G scale={scale} origin="50, 50">
      {MOTIFS[badge](ink, knockout, slots)}
    </G>
  );
}

function Wreath({ color, edge }: { color: string; edge: string | null }) {
  return (
    <>
      {([-1, 1] as const).map((side) => {
        const from = side < 0 ? 112 : 68;
        const to = side < 0 ? 196 : -16;
        return (
          <G key={side}>
            <Path
              d={side < 0 ? arcPath(44, from, to) : arcPath(44, to, from)}
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              strokeLinecap="round"
            />
            {Array.from({ length: 5 }, (_, i) => {
              const angle = from + ((to - from) * (i + 0.5)) / 5;
              const [x, y] = pol(45.4, angle);
              return (
                <Ellipse
                  key={i}
                  cx={x}
                  cy={y}
                  rx={5.4}
                  ry={2.5}
                  rotation={r2(angle + 90 - side * 32)}
                  origin={`${x}, ${y}`}
                  fill={color}
                  stroke={edge ?? undefined}
                  strokeWidth={edge ? 1 : undefined}
                />
              );
            })}
          </G>
        );
      })}
    </>
  );
}

function Coin({ badge, frame, tone, filled }: { badge: BadgeKey; frame: 1 | 2 | 3 | 4 | 'ring'; tone: Tone; filled?: readonly boolean[] }) {
  const p = palette(tone);
  const blind = p.edge != null;
  const top = frame === 'ring' ? 2 : frame;
  const edge = (width = 1.3) => (p.edge ? { stroke: p.edge, strokeWidth: width } : {});
  const slots = filled ? { filled, on: Colors.amber, off: over(Colors.foam, 0.34) } : undefined;
  return (
    <>
      {top >= 4 ? <Wreath color={blind ? p.body : tone === 'top' ? Colors.neon : p.highlight} edge={p.edge} /> : null}
      {top >= 3 ? (
        <>
          <Path d={CROWN} fill={p.body} {...edge()} />
          {blind
            ? null
            : Array.from({ length: 21 }, (_, i) => {
                const angle = -90 + i * (360 / 21) + 360 / 42;
                const [x0, y0] = pol(36.6, angle);
                const [x1, y1] = pol(39.2, angle);
                return (
                  <Path key={i} d={`M${x0} ${y0}L${x1} ${y1}`} stroke={p.detail} strokeWidth={1.1} strokeLinecap="round" />
                );
              })}
          <Circle cx={50} cy={50} r={35} fill="none" stroke={p.edge ?? p.detail} strokeWidth={1.2} />
        </>
      ) : null}
      {top >= 2 ? (
        <>
          <Circle cx={50} cy={50} r={34.4} fill={p.body} {...(top === 2 ? edge() : {})} />
          {blind ? null : <Path d={arcPath(33, 195, 285)} fill="none" stroke={p.highlight} strokeWidth={1.5} strokeLinecap="round" />}
          <Circle cx={50} cy={50} r={29.3} fill="none" stroke={p.edge ?? p.detail} strokeWidth={1.3} />
          {frame === 'ring'
            ? null
            : Array.from({ length: 16 }, (_, i) => {
                const [x, y] = pol(31.9, i * 22.5);
                return <Circle key={i} cx={x} cy={y} r={1.35} fill={p.edge ?? p.detail} />;
              })}
        </>
      ) : null}
      <Circle cx={50} cy={50} r={28.4} fill={p.body} {...(top === 1 ? edge() : {})} />
      {blind ? null : (
        <>
          {/* A plain coin needs its own minted rim, or at 64 pt it reads as a flat disc. */}
          {top === 1 ? <Circle cx={50} cy={50} r={27.4} fill="none" stroke={withAlpha(Colors.stout, 0.35)} strokeWidth={2} /> : null}
          <Circle cx={50} cy={50} r={25} fill="none" stroke={p.shade} strokeWidth={1.8} />
          <Path
            d={arcPath(26.7, 198, 282)}
            fill="none"
            stroke={p.highlight}
            strokeWidth={tone === 'copper' ? 2.6 : 1.8}
            strokeLinecap="round"
          />
        </>
      )}
      {motif(badge, p.ink, p.body, 0.72, slots)}
    </>
  );
}

function Plaque({ badge, tone }: { badge: BadgeKey; tone: Tone }) {
  const p = palette(tone);
  return (
    <>
      <Path d={PLAQUE} fill={p.body} strokeLinejoin="round" {...(p.edge ? { stroke: p.edge, strokeWidth: 1.5 } : {})} />
      {p.edge ? null : (
        <>
          <Path d={PLAQUE_INNER} fill="none" stroke={p.detail} strokeWidth={1.3} strokeLinejoin="round" />
          {[
            [28.6, 28.6],
            [71.4, 28.6],
            [28.6, 71.4],
            [71.4, 71.4],
          ].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} fill={p.detail} />
          ))}
          <Path d="M22.6 58V34.2L34.2 22.6H58" stroke={p.highlight} {...line(1.8)} />
        </>
      )}
      {motif(badge, p.ink, p.body, 0.76)}
    </>
  );
}

function Secret() {
  const body = over(Colors.foam, 0.06);
  return (
    <>
      <Path
        d={PLAQUE}
        fill={body}
        stroke={over(Colors.foam, 0.32)}
        strokeWidth={1.5}
        strokeDasharray="3.4 3.4"
        strokeLinejoin="round"
      />
      {motif('secret', over(Colors.foam, 0.5), body, 0.66)}
    </>
  );
}

export const BadgeMedal = memo(function BadgeMedal({
  badge,
  look,
  size,
  dot = false,
}: {
  badge: BadgeKey;
  look: MedalLook;
  size: number;
  /** Amber dot of a medal you have not opened yet. */
  dot?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {look.shape === 'secret' ? (
        <Secret />
      ) : look.shape === 'plaque' ? (
        <Plaque badge={badge} tone={look.tone} />
      ) : (
        <Coin badge={badge} frame={look.shape === 'ring' ? 'ring' : look.frame} tone={look.tone} filled={look.shape === 'ring' ? look.filled : undefined} />
      )}
      {dot ? <Circle cx={86} cy={14} r={6} fill={Colors.amber} stroke={Colors.stout} strokeWidth={2.5} /> : null}
    </Svg>
  );
});
