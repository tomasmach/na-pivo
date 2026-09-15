/**
 * TallyMarks — the hand-scratched beer tally ("čárky na tácku"): groups of
 * five, four uprights struck through by the fifth, the way a Czech waiter
 * pencils beers on the coaster. This is the visual signature of a published
 * night, on the feed card and on the story image alike.
 *
 * Strokes get a tiny deterministic jitter (per stroke index, no randomness at
 * render) so the tally reads as pencil work, not as a barcode. Overflow beyond
 * the cap renders as a "+N" so a big night never blows up the layout.
 */

import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { Fonts } from '@/theme/fonts';
import { tallyGroups } from '@/vycep/nightModel';

/** Fixed per-index jitter tables (degrees of lean, px of vertical slip). A
 *  stroke keeps its exact wobble forever, so re-renders never shimmer. */
const LEAN = [-3, 2, -1, 3, -2, 1, -3, 2, 0, -1, 3, -2];
const SLIP = [0.6, -0.4, 0.3, -0.6, 0.2, -0.3, 0.5, -0.2, 0.4, -0.5, 0.1, 0.6];

interface TallyMarksProps {
  count: number;
  /** Height of one upright stroke in px; everything scales from it. */
  markHeight?: number;
  color: string;
  strokeWidth?: number;
  /** Cap on drawn marks before falling back to "+N" (default 25). */
  maxMarks?: number;
  /** Color of the "+N" overflow label; defaults to `color`. */
  overflowColor?: string;
}

function TallyMarksBase({
  count,
  markHeight = 26,
  color,
  strokeWidth = 3,
  maxMarks = 25,
  overflowColor,
}: TallyMarksProps) {
  const { groups, overflow } = tallyGroups(count, maxMarks);
  if (groups.length === 0) return null;

  const gap = markHeight * 0.32;
  const groupPad = markHeight * 0.34;

  return (
    <View style={[styles.row, { gap: markHeight * 0.55 }]}>
      {groups.map((size, groupIdx) => {
        const uprights = Math.min(size, 4);
        const hasStrike = size === 5;
        // Global stroke index (5 pen strokes per full group) keyed purely off
        // the group position, so every stroke keeps its jitter across renders.
        const strokeBase = groupIdx * 5;
        const width = groupPad * 2 + (uprights - 1) * gap;
        const height = markHeight + 8;
        const lines = [];
        for (let i = 0; i < uprights; i += 1) {
          const jitter = (strokeBase + i) % LEAN.length;
          const x = groupPad + i * gap;
          const lean = (LEAN[jitter] / 90) * markHeight * 0.5;
          const slip = SLIP[jitter];
          lines.push(
            <Line
              key={`u${i}`}
              x1={x - lean / 2}
              y1={4 + slip}
              x2={x + lean / 2}
              y2={4 + markHeight + slip}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />,
          );
        }
        if (hasStrike) {
          const jitter = (strokeBase + 4) % SLIP.length;
          lines.push(
            <Line
              key="strike"
              x1={groupPad - gap * 0.7}
              y1={4 + markHeight * 0.72 + SLIP[jitter]}
              x2={groupPad + (uprights - 1) * gap + gap * 0.7}
              y2={4 + markHeight * 0.2 + SLIP[jitter]}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />,
          );
        }
        return (
          <Svg key={groupIdx} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            {lines}
          </Svg>
        );
      })}
      {overflow > 0 ? (
        <Text
          style={[
            styles.overflow,
            { color: overflowColor ?? color, fontSize: markHeight * 0.62 },
          ]}
          allowFontScaling={false}
        >
          {`+${overflow}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  overflow: {
    fontFamily: Fonts.display.extrabold,
    includeFontPadding: false,
  },
});

export const TallyMarks = memo(TallyMarksBase);
