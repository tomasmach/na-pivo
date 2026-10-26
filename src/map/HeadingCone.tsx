import { useState } from 'react';
import { useAnimatedReaction, useSharedValue, runOnJS, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { Colors } from '@/theme/colors';
import { StaticMapMarker } from './StaticMapMarker';

const SIZE = 132;
const HALF_ANGLE = 26;
// A marker rotation crosses the bridge, so a still hand must not send one every frame.
const STEP_DEG = 4;

function wedgePath(): string {
  const c = SIZE / 2;
  const r = c - 2;
  const rad = (HALF_ANGLE * Math.PI) / 180;
  const x1 = c - r * Math.sin(rad);
  const x2 = c + r * Math.sin(rad);
  const y = c - r * Math.cos(rad);
  return `M${c} ${c} L${x1} ${y} A${r} ${r} 0 0 1 ${x2} ${y} Z`;
}

const WEDGE = wedgePath();

interface HeadingConeProps {
  latitude: number;
  longitude: number;
  heading: SharedValue<number | null>;
}

/** Where the phone points, drawn from the person's dot like the beam in Apple Maps. */
export function HeadingCone({ latitude, longitude, heading }: HeadingConeProps) {
  const [degrees, setDegrees] = useState<number | null>(null);
  const sent = useSharedValue<number | null>(null);
  useAnimatedReaction(
    () => heading.value,
    (next) => {
      const last = sent.value;
      if (next === null) {
        if (last !== null) {
          sent.value = null;
          runOnJS(setDegrees)(null);
        }
        return;
      }
      if (last !== null && Math.abs(((next - last + 540) % 360) - 180) < STEP_DEG) return;
      sent.value = next;
      runOnJS(setDegrees)(Math.round(next));
    },
    [heading],
  );

  if (degrees === null) return null;
  return (
    <StaticMapMarker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={degrees}
      zIndex={-1}
      tappable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={SIZE} height={SIZE}>
        <Defs>
          <RadialGradient id="cone" cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={Colors.amber} stopOpacity={0.5} />
            <Stop offset="1" stopColor={Colors.amber} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Path d={WEDGE} fill="url(#cone)" />
      </Svg>
    </StaticMapMarker>
  );
}
