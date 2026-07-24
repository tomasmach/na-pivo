/**
 * CoasterStack — the whole career, drawn.
 *
 * A pile of beer mats seen from slightly above: one mat for every rung of the
 * lifetime ladder the drinker has cleared, and always one bare outline resting
 * on top saying "there is still room to grow". It is the Profil counterpart of
 * `BeerGlass` (one evening), `TallyCoaster` (one night) and `PartyTable` (one
 * table) — the same drawing language pointed at a longer timescale.
 *
 * Design rules this file enforces:
 * - Vector, not a bitmap, and every colour comes from a theme token.
 * - Amber appears only where the spec allows: the mats themselves and their
 *   outlines. No glow — that belongs to the screen's single primary button.
 * - The illustration reacts to data, never to time. Nothing here loops.
 * - Every coordinate is computed from the constants below, and the fit inside
 *   the fixed viewBox is arithmetic (see `BASE_DECK_Y`), not eyeballing.
 * - Purely decorative: it carries no text, so it is hidden from screen readers
 *   and the surrounding card owns the accessibility label.
 */

import React, { memo } from 'react';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

/** Fixed drawing box, shared with `BeerGlass` so the two sit at the same scale. */
const VIEW_BOX_W = 88;
const VIEW_BOX_H = 132;

/**
 * One mat, drawn as a squat cylinder: a deck ellipse for the printed face and a
 * short side below it so the mat has visible thickness instead of reading as a
 * flat disc.
 */
const CENTER_X = VIEW_BOX_W / 2;
const DECK_RX = 32;
const DECK_RY = 8;
/** How far the bottom edge sits below the deck — the mat's thickness. */
const SIDE_H = 7;
const OUTLINE_W = 1.5;
/** Leftmost / rightmost point of both ellipses: 12 and 76. */
const EDGE_LEFT = CENTER_X - DECK_RX;
const EDGE_RIGHT = CENTER_X + DECK_RX;

/**
 * Rungs of the lifetime ladder. A mat lands on the stack for every rung the
 * drinker has passed, so the picture fills fast at the start and then makes
 * you earn it — the first beer is worth as much of the drawing as the 250th.
 */
const RUNGS = [1, 10, 50, 100, 250, 500, 1000];

/** Vertical pitch of the stack — also exactly how much of each mat stays visible. */
const STEP_Y = 13;

/**
 * Deck of the bottom mat.
 *
 * The lowest ink in the drawing is that mat's bottom edge plus half its
 * outline: BASE_DECK_Y + SIDE_H + DECK_RY + OUTLINE_W / 2 = BASE_DECK_Y + 15.75,
 * which has to stay inside the 132-tall box — so the deck cannot sit below
 * 116.25. The highest ink is the empty outline resting on a full stack:
 * 116 - 7 * 13 = 25 for its deck, minus DECK_RY and half an outline = 16.25.
 * Both ends clear the box, and the widest ink is 76.75 < 88.
 */
const BASE_DECK_Y = 116;

/**
 * The ring a glass leaves on the top mat. It is a circle of radius 12 lying on
 * the deck, so on screen it carries the deck's own foreshortening — anything
 * rounder would float above the mat instead of sitting on it.
 */
const RING_RX = 12;
const RING_RY = (RING_RX * DECK_RY) / DECK_RX;

const DECK_FILL_ID = 'coasterStackDeck';

/** Deck of the mat at `index`, counting from the bottom of the stack. */
function deckY(index: number): number {
  return BASE_DECK_Y - index * STEP_Y;
}

/** Rungs cleared, i.e. how many full mats the stack holds: 0 … RUNGS.length. */
function clearedRungs(beers: number): number {
  let cleared = 0;
  for (const rung of RUNGS) {
    if (beers >= rung) cleared += 1;
  }
  return cleared;
}

/**
 * The side of one mat: down the left edge, around the bottom rim, up the right
 * edge and back along the front of the deck. Drawing it as one closed path
 * (rather than a rectangle plus an ellipse) means the outline traces the real
 * silhouette, with no unstroked seam where the rim meets the deck.
 */
function sidePath(y: number): string {
  return [
    `M ${EDGE_LEFT} ${y}`,
    `L ${EDGE_LEFT} ${y + SIDE_H}`,
    `A ${DECK_RX} ${DECK_RY} 0 0 0 ${EDGE_RIGHT} ${y + SIDE_H}`,
    `L ${EDGE_RIGHT} ${y}`,
    `A ${DECK_RX} ${DECK_RY} 0 0 1 ${EDGE_LEFT} ${y}`,
    'Z',
  ].join(' ');
}

/**
 * One mat. Full mats are poured amber with a darker side so the thickness
 * reads; the empty one on top is the same shape left as a bare outline.
 */
function Coaster({ y, filled }: { y: number; filled: boolean }) {
  const outline = withAlpha(Colors.amber, filled ? 0.55 : 0.32);
  const side = filled ? withAlpha(Colors.amber, 0.55) : withAlpha(Colors.foam, 0.05);
  const deck = filled ? `url(#${DECK_FILL_ID})` : withAlpha(Colors.foam, 0.05);

  return (
    <G>
      <Path d={sidePath(y)} fill={side} stroke={outline} strokeWidth={OUTLINE_W} />
      <Ellipse
        cx={CENTER_X}
        cy={y}
        rx={DECK_RX}
        ry={DECK_RY}
        fill={deck}
        stroke={outline}
        strokeWidth={OUTLINE_W}
      />
    </G>
  );
}

export const CoasterStack = memo(function CoasterStack({
  beers,
  width = 88,
}: {
  /** Beers over the drinker's whole life. 0 draws the bare outline only. */
  beers: number;
  /** Width in points; the height keeps the fixed 88:132 ratio. */
  width?: number;
}) {
  const height = Math.round((width / VIEW_BOX_W) * VIEW_BOX_H);
  const total = Number.isFinite(beers) ? Math.max(0, Math.floor(beers)) : 0;
  const filled = clearedRungs(total);

  // Bottom mat first: each one is then overlapped by the mat resting on it, so
  // only its rim shows and the pile reads as a pile.
  const filledIndexes: number[] = [];
  for (let i = 0; i < filled; i += 1) filledIndexes.push(i);

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEW_BOX_W} ${VIEW_BOX_H}`}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Defs>
        <LinearGradient id={DECK_FILL_ID} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.amberLight} stopOpacity={0.95} />
          <Stop offset="1" stopColor={Colors.amber} stopOpacity={0.8} />
        </LinearGradient>
      </Defs>

      {filledIndexes.map((index) => (
        <Coaster key={`mat-${index}`} y={deckY(index)} filled />
      ))}

      {/* The ring the last glass left behind — one mark, on the top mat only, so
          the stack never reads as a plain amber column. */}
      {filled > 0 ? (
        <Ellipse
          cx={CENTER_X}
          cy={deckY(filled - 1)}
          rx={RING_RX}
          ry={RING_RY}
          fill="none"
          stroke={withAlpha(Colors.foam, 0.16)}
          strokeWidth={2}
        />
      ) : null}

      {/* Always one bare mat on top: "there is still room to grow". At zero it
          is the entire drawing, which is exactly what an empty career is. */}
      <Coaster y={deckY(filled)} filled={false} />
    </Svg>
  );
});
