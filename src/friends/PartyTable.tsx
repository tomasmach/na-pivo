/**
 * PartyTable — the Parta, drawn.
 *
 * A round pub table seen from above with a half-litre at every taken seat: a
 * full glass for everyone who said "Jdu", a bare outline for everyone who said
 * "Možná", and a thin ring of foam around my own glass when I am sitting there
 * too. It is the Parta counterpart of `TallyCoaster` — the one
 * piece of personality on the screen, and the thing that makes the party read
 * as a table instead of a feed.
 *
 * Design rules this file enforces:
 * - Vector, not a bitmap, and every colour comes from a theme token.
 * - Amber appears only where the spec allows: the tabletop's outline and the
 *   glasses. No amber surface anywhere else, no glow — those belong to the
 *   screen's single primary button.
 * - The illustration reacts to data, never to time. Nothing here loops.
 * - Every coordinate is computed (`Math.cos` / `Math.sin`), never eyeballed,
 *   and the clearances between tabletop, glasses and the overflow stack are
 *   part of the constants below rather than something a redraw can quietly
 *   break.
 * - Purely decorative: it carries no text, so it is hidden from screen readers
 *   and the surrounding card owns the accessibility label.
 */

import React, { memo } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

/**
 * The drawing grid is the specced 120x120 square, but the window around it is
 * padded on every side. A glass sits on a radius-52 orbit and its handle reaches
 * 11.66 further out, so the outermost ink lands 64.41 from the centre — 4.41
 * past the bare grid, which would clip the top glass's handle clean off. Padding
 * the viewBox keeps every drawn coordinate exactly as specified and only widens
 * what we look through; the rendered box stays square.
 */
const GRID = 120;
const PAD = 6;
const VIEW_BOX = `${-PAD} ${-PAD} ${GRID + PAD * 2} ${GRID + PAD * 2}`;
const CENTER = GRID / 2;

/** The tabletop. Outer edge including its 2.5 stroke lands at 41.25. */
const TABLE_R = 40;
const TABLE_STROKE = 2.5;

/** The mat in the middle of the table — always there, even at an empty table. */
const COASTER_R = 13;

/** Seats: one glass per taken seat, six around the table before we stop. */
const SEATS = 6;
const SEAT_ORBIT = 52;
/** Straight up. Seats then run clockwise, the way you'd count them at a table. */
const START_DEG = -90;

/** One half-litre from above: the glass, then the handle hooked onto its rim. */
const MUG_R = 8;
const MUG_STROKE = 1.5;
/** Handle radius, and how far its two feet sit from the outward radial line. */
const HANDLE_R = 3.5;
const HANDLE_SPREAD_DEG = 25;

/** My own glass wears a ring of foam so I can find myself at the table. */
const MINE_RING_R = 10.5;

/**
 * More people than seats: a short stack of spare mats saying "a další".
 *
 * It cannot sit at the bottom of the table the way a stack of coasters would in
 * real life — a full table always has a glass at the bottom seat (six seats
 * starting at the top puts one at exactly 90°), and the mats would land inside
 * it. So the stack takes the free gap between two seats instead, which reads as
 * mats waiting for the people who haven't sat down yet. Anchored a shade
 * further out than the glasses so the top mat clears the tabletop's rim.
 */
const STACK_DEG = 60;
const STACK_ORBIT = 54;
const STACK_COUNT = 3;
const STACK_RX = 9;
const STACK_RY = 3;
const STACK_STEP_Y = 3;

const MUG_FILL_ID = 'partyMugFill';

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Trim the float noise out of a generated path string. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Seat {
  key: string;
  cx: number;
  cy: number;
  /** The handle, as an arc hooked onto the glass's rim. */
  handle: string;
  /** True for "Jdu" (poured), false for "Možná" (outline only). */
  poured: boolean;
}

/**
 * Place the glasses evenly around the table and build each handle.
 *
 * The handle is a single arc between two points on the glass's rim, drawn the
 * long way round (large-arc) so it bulges outward into a proper loop instead of
 * a shallow lump. Its widest point sits 8.83 from the glass's centre — outside
 * the glass — so the arc never dips back into the body and the two shapes read
 * as one object with no seam across it.
 */
function buildSeats(total: number, poured: number): Seat[] {
  const seats: Seat[] = [];
  if (total <= 0) return seats;

  const step = 360 / total;

  for (let i = 0; i < total; i += 1) {
    const degrees = START_DEG + i * step;
    const radians = toRadians(degrees);
    const cx = CENTER + SEAT_ORBIT * Math.cos(radians);
    const cy = CENTER + SEAT_ORBIT * Math.sin(radians);

    const footA = toRadians(degrees + HANDLE_SPREAD_DEG);
    const footB = toRadians(degrees - HANDLE_SPREAD_DEG);
    const ax = cx + MUG_R * Math.cos(footA);
    const ay = cy + MUG_R * Math.sin(footA);
    const bx = cx + MUG_R * Math.cos(footB);
    const by = cy + MUG_R * Math.sin(footB);

    seats.push({
      key: `seat-${i}`,
      cx,
      cy,
      // large-arc 1 + sweep 0 is the arc that bows away from the table centre.
      handle: `M ${round(ax)} ${round(ay)} A ${HANDLE_R} ${HANDLE_R} 0 1 0 ${round(bx)} ${round(by)}`,
      poured: i < poured,
    });
  }

  return seats;
}

export const PartyTable = memo(function PartyTable({
  going,
  maybe,
  mine,
  width = 96,
}: {
  /** People sitting at the table or already in with "Jdu" — poured glasses. */
  going: number;
  /** People who said "Možná" — outlined glasses, no beer in them yet. */
  maybe: number;
  /** I'm at the table too: the first glass gets a ring of foam. */
  mine: boolean;
  /** Width in points; the height matches it so the table stays round. */
  width?: number;
}) {
  const goingCount = Math.max(0, Math.floor(going));
  const maybeCount = Math.max(0, Math.floor(maybe));
  const taken = goingCount + maybeCount;

  const total = Math.min(taken, SEATS);
  const seats = buildSeats(total, Math.min(goingCount, total));
  const overflow = taken > SEATS;

  const stackX = CENTER + STACK_ORBIT * Math.cos(toRadians(STACK_DEG));
  const stackY = CENTER + STACK_ORBIT * Math.sin(toRadians(STACK_DEG));

  return (
    <Svg
      width={width}
      height={width}
      viewBox={VIEW_BOX}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Defs>
        <LinearGradient id={MUG_FILL_ID} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.amberLight} stopOpacity={0.95} />
          <Stop offset="1" stopColor={Colors.amber} stopOpacity={0.8} />
        </LinearGradient>
      </Defs>

      {/* The tabletop. Its outline firms up as soon as anybody takes a seat. */}
      <Circle
        cx={CENTER}
        cy={CENTER}
        r={TABLE_R}
        fill={withAlpha(Colors.foam, 0.05)}
        stroke={withAlpha(Colors.amber, taken > 0 ? 0.55 : 0.32)}
        strokeWidth={TABLE_STROKE}
      />

      {/* The mat in the middle — the table is never completely bare. */}
      <Circle
        cx={CENTER}
        cy={CENTER}
        r={COASTER_R}
        fill={withAlpha(Colors.foam, 0.05)}
        stroke={withAlpha(Colors.foam, 0.14)}
        strokeWidth={1}
        strokeDasharray="3 3"
      />

      {/* "…a další": spare mats for the people who didn't get a seat drawn. */}
      {overflow
        ? Array.from({ length: STACK_COUNT }, (_, i) => (
            <Ellipse
              key={`stack-${i}`}
              cx={stackX}
              cy={stackY - i * STACK_STEP_Y}
              rx={STACK_RX}
              ry={STACK_RY}
              fill={withAlpha(Colors.foam, 0.05)}
            />
          ))
        : null}

      {/* My glass, ringed with foam. Drawn under the glass so it reads as a
          halo around it rather than a second outline on top of it. */}
      {mine && seats.length > 0 ? (
        <Circle
          cx={seats[0].cx}
          cy={seats[0].cy}
          r={MINE_RING_R}
          fill="none"
          stroke={withAlpha(Colors.foam, 0.35)}
          strokeWidth={1}
        />
      ) : null}

      {/* The glasses themselves — nothing at all when nobody has answered, so
          an empty table reads as empty instead of as a table nobody drew on. */}
      {seats.map((seat) => {
        const stroke = withAlpha(Colors.amber, seat.poured ? 0.55 : 0.32);
        return (
          <G key={seat.key}>
            <Path
              d={seat.handle}
              fill="none"
              stroke={stroke}
              strokeWidth={MUG_STROKE}
              strokeLinecap="round"
            />
            <Circle
              cx={seat.cx}
              cy={seat.cy}
              r={MUG_R}
              fill={seat.poured ? `url(#${MUG_FILL_ID})` : 'none'}
              stroke={stroke}
              strokeWidth={MUG_STROKE}
            />
          </G>
        );
      })}
    </Svg>
  );
});
