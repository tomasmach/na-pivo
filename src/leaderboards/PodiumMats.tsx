import React, { memo } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

interface PodiumMatsProps {
  rank: number | null;
  width: number;
}

const MAT_PATHS = {
  second: 'M5 54 Q5 49 10 49 H39 Q44 49 44 54 V101 H5 Z',
  first: 'M48 30 Q48 25 53 25 H82 Q87 25 87 30 V101 H48 Z',
  third: 'M91 69 Q91 64 96 64 H125 Q130 64 130 69 V101 H91 Z',
  fourth: 'M121 88 Q121 84 125 84 H135 V101 H121 Z',
} as const;

export const PodiumMats = memo(function PodiumMats({ rank, width }: PodiumMatsProps) {
  const activeKey =
    rank === 1 ? 'first' : rank === 2 ? 'second' : rank === 3 ? 'third' : rank != null ? 'fourth' : null;

  return (
    <Svg
      width={width}
      height={width * 0.8}
      viewBox="0 0 140 112"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Defs>
        <LinearGradient id="podiumAmber" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.amberLight} stopOpacity={0.98} />
          <Stop offset="1" stopColor={Colors.amber} stopOpacity={0.88} />
        </LinearGradient>
      </Defs>

      {Object.entries(MAT_PATHS).map(([key, path]) => {
        const active = key === activeKey;
        return (
          <Path
            key={key}
            d={path}
            fill={active ? 'url(#podiumAmber)' : withAlpha(Colors.foam, 0.05)}
            stroke={withAlpha(Colors.amber, active ? 0.55 : 0.32)}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        );
      })}
    </Svg>
  );
});
