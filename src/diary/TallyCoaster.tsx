/**
 * TallyCoaster — the diary, drawn.
 *
 * A paper beer mat with the night's tally chalked on it: four uprights and a
 * slash through them for every five beers, sitting on a short stack of the mats
 * that came before. It is the Deník counterpart of `BeerGlass` — the one piece
 * of personality on the screen, and the most Czech picture the app has.
 *
 * Design rules this file enforces:
 * - Vector, not a bitmap, and every colour comes from a theme token.
 * - Amber appears only where the spec allows: the mat's outline and the marks
 *   themselves. No filled amber surface, no glow — those belong to the screen's
 *   single primary button.
 * - The illustration reacts to data, never to time. Nothing here loops.
 * - The mark block is centred on the mat and geometrically clamped to ten marks
 *   (two groups, one row), which is what keeps it clear of the paper rim.
 * - Purely decorative: it carries no text, so it is hidden from screen readers
 *   and the surrounding card owns the accessibility label.
 */

import React, { memo } from 'react';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

/** Square drawing box, so the mat stays round at any width. */
const VIEW_BOX = 96;
const CENTER_X = 48;
const CENTER_Y = 46;
/** Top mat. */
const COASTER_R = 34;
/** Inner hairline — the printed paper rim. */
const RIM_R = 29;

/** Mats hinted underneath the top one, one per previous night. */
const MAX_STACK = 3;
const STACK_STEP_Y = 3;
const STACK_STEP_R = 1;

/** Beers that fill the mat. Past this the tally just stays at ten. */
const MAX_MARKS = 10;

/** Marks per group: four uprights plus the slash. */
const GROUP_SIZE = 5;
/** Length of one upright. */
const MARK_HEIGHT = 18;
/** Pitch between uprights inside a group. */
const MARK_GAP = 5;
/** Gap from a group's last upright to the next group's first. */
const GROUP_GAP = 10;
/** Width spanned by a full group's four uprights: 3 × 5 = 15. */
const GROUP_SPAN = (GROUP_SIZE - 2) * MARK_GAP;
/** Distance between the first uprights of two neighbouring groups: 25. */
const GROUP_PITCH = GROUP_SPAN + GROUP_GAP;
/** How far the slash sticks out past the uprights on each side. */
const SLASH_OVERHANG = 3;
const GROUPS_PER_ROW = 2;
const ROW_GAP = 8;

/**
 * One short highlight hugging the upper-left rim, so the mat reads as a lit
 * paper disc instead of a flat blob. Sampled off a radius-24 circle around the
 * centre at 215° and 250°, which keeps it above the tally block (y < 33) and
 * inside the rim.
 */
const HIGHLIGHT_PATH = 'M28.34 32.23 A24 24 0 0 1 39.79 23.45';

interface TallyStroke {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Lay out the chalk marks: split the count into fives, pack the groups into
 * rows of two, then centre every row on the mat. The slash overhangs a full
 * group symmetrically, so the uprights' centres alone define a row's midpoint.
 */
function buildTallyStrokes(count: number): TallyStroke[] {
  if (count <= 0) return [];

  const groups: number[] = [];
  for (let left = count; left > 0; left -= GROUP_SIZE) {
    groups.push(Math.min(GROUP_SIZE, left));
  }

  const rowCount = Math.ceil(groups.length / GROUPS_PER_ROW);
  const blockHeight = rowCount * MARK_HEIGHT + (rowCount - 1) * ROW_GAP;
  const firstRowTop = CENTER_Y - blockHeight / 2;

  const strokes: TallyStroke[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const start = rowIndex * GROUPS_PER_ROW;
    const row = groups.slice(start, start + GROUPS_PER_ROW);
    const top = firstRowTop + rowIndex * (MARK_HEIGHT + ROW_GAP);

    const lastIndex = row.length - 1;
    const lastSize = row[lastIndex];
    const lastCenter =
      lastIndex * GROUP_PITCH +
      (lastSize === GROUP_SIZE ? GROUP_SPAN : (lastSize - 1) * MARK_GAP);
    const offsetX = CENTER_X - lastCenter / 2;

    row.forEach((size, groupIndex) => {
      const base = offsetX + groupIndex * GROUP_PITCH;
      const uprights = Math.min(size, GROUP_SIZE - 1);

      for (let i = 0; i < uprights; i += 1) {
        const x = base + i * MARK_GAP;
        strokes.push({
          key: `u${rowIndex}-${groupIndex}-${i}`,
          x1: x,
          y1: top,
          x2: x,
          y2: top + MARK_HEIGHT,
        });
      }

      // The fifth mark: one slash across the four, bottom-left to top-right.
      if (size === GROUP_SIZE) {
        strokes.push({
          key: `s${rowIndex}-${groupIndex}`,
          x1: base - SLASH_OVERHANG,
          y1: top + MARK_HEIGHT - SLASH_OVERHANG,
          x2: base + GROUP_SPAN + SLASH_OVERHANG,
          y2: top + SLASH_OVERHANG,
        });
      }
    });
  }

  return strokes;
}

export const TallyCoaster = memo(function TallyCoaster({
  marks,
  nights,
  width = 88,
}: {
  /** Beers logged that night. 0 draws a clean mat. */
  marks: number;
  /** Evenings in the diary. Drives how deep the stack under the mat goes. */
  nights: number;
  /** Width in points; the height matches it so the mat stays round. */
  width?: number;
}) {
  const drawnMarks = Math.max(0, Math.min(MAX_MARKS, Math.floor(marks)));
  const stack = Math.max(0, Math.min(MAX_STACK, Math.floor(nights) - 1));
  const strokes = buildTallyStrokes(drawnMarks);

  // Deepest mat first, so each one is overlapped by the mat above it.
  const stackIndexes: number[] = [];
  for (let i = stack; i >= 1; i -= 1) stackIndexes.push(i);

  return (
    <Svg
      width={width}
      height={width}
      viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {/* The nights already written down: mats peeking out below, no outline. */}
      {stackIndexes.map((i) => (
        <Circle
          key={`stack-${i}`}
          cx={CENTER_X}
          cy={CENTER_Y + STACK_STEP_Y * i}
          r={COASTER_R - STACK_STEP_R * i}
          fill={withAlpha(Colors.foam, 0.05)}
        />
      ))}

      {/* Tonight's mat. The outline firms up once the first beer lands. */}
      <Circle
        cx={CENTER_X}
        cy={CENTER_Y}
        r={COASTER_R}
        fill={withAlpha(Colors.foam, 0.04)}
        stroke={withAlpha(Colors.amber, drawnMarks > 0 ? 0.55 : 0.32)}
        strokeWidth={2.5}
      />
      <Circle
        cx={CENTER_X}
        cy={CENTER_Y}
        r={RIM_R}
        fill="none"
        stroke={withAlpha(Colors.foam, 0.1)}
        strokeWidth={1}
      />

      <Path
        d={HIGHLIGHT_PATH}
        fill="none"
        stroke={withAlpha(Colors.foam, 0.1)}
        strokeWidth={3}
        strokeLinecap="round"
      />

      {/* The tally itself — nothing at zero, so an empty mat reads as empty. */}
      <G stroke={Colors.amberLight} strokeWidth={3} strokeLinecap="round">
        {strokes.map((stroke) => (
          <Line
            key={stroke.key}
            x1={stroke.x1}
            y1={stroke.y1}
            x2={stroke.x2}
            y2={stroke.y2}
          />
        ))}
      </G>
    </Svg>
  );
});
