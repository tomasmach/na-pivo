import React, { memo } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

const VIEW_BOX = 96;
const CENTER_X = 48;
const CENTER_Y = 46;
const COASTER_R = 34;
const RIM_R = 29;
const MAX_STACK = 3;
const STACK_STEP_Y = 3;
const STACK_STEP_R = 1;
const PIN_PATH =
  'M48 25 C38.6 25 31 32.6 31 42 C31 55.2 48 70.5 48 70.5 C48 70.5 65 55.2 65 42 C65 32.6 57.4 25 48 25 Z';

export const PinMat = memo(function PinMat({
  count,
  width = 88,
}: {
  count: number;
  width?: number;
}) {
  const stack = Math.max(0, Math.min(MAX_STACK, Math.floor(count) - 1));
  const stackIndexes: number[] = [];
  for (let index = stack; index >= 1; index -= 1) stackIndexes.push(index);
  const active = count > 0;

  return (
    <Svg
      width={width}
      height={width}
      viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {stackIndexes.map((index) => (
        <Circle
          key={`stack-${index}`}
          cx={CENTER_X}
          cy={CENTER_Y + STACK_STEP_Y * index}
          r={COASTER_R - STACK_STEP_R * index}
          fill={withAlpha(Colors.foam, 0.05)}
        />
      ))}

      <Circle
        cx={CENTER_X}
        cy={CENTER_Y}
        r={COASTER_R}
        fill={withAlpha(Colors.foam, 0.04)}
        stroke={withAlpha(Colors.amber, active ? 0.55 : 0.32)}
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
        d="M28.34 32.23 A24 24 0 0 1 39.79 23.45"
        fill="none"
        stroke={withAlpha(Colors.foam, 0.1)}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <Path
        d={PIN_PATH}
        fill={active ? Colors.amber : withAlpha(Colors.foam, 0.05)}
        stroke={withAlpha(Colors.amber, active ? 0.55 : 0.32)}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={CENTER_X} cy={42} r={5.5} fill={Colors.stout2} />
    </Svg>
  );
});
