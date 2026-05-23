import React, { memo } from 'react';
import Svg, {
  G,
  Path,
  Defs,
  Filter,
  FeGaussianBlur,
} from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withSpring,
  cancelAnimation,
  SharedValue,
} from 'react-native-reanimated';
import { Colors } from '@/theme/colors';
import { CompassSize } from '@/theme/layout';

// Create Animated version of the SVG G group
const AnimatedG = Animated.createAnimatedComponent(G);

interface CompassArrowProps {
  rotation: SharedValue<number>;
  size?: number;
}

// North half — narrow swallowtail spear, tip at top, pinch just above hub.
// Center is (160,160). Shape: tip → wide right → notch → wide left → close.
const ARROW_PATH =
  'M160 42 L171 155 L160 147 L149 155 Z';

// South half — mirror of ARROW_PATH across the horizontal centerline.
// Tip at bottom, pinch just below hub. Same length so the needle is symmetric.
const TAIL_PATH =
  'M160 278 L149 165 L160 173 L171 165 Z';

// Glow shape behind the north arrow (slightly larger for the soft halo).
const GLOW_PATH =
  'M160 35 L174 158 L160 148 L146 158 Z';

export const CompassArrow = memo(function CompassArrow({
  rotation,
  size = CompassSize,
}: CompassArrowProps) {
  const cx = size / 2;
  const cy = size / 2;

  const animatedGProps = useAnimatedProps(() => {
    return {
      rotation: rotation.value,
      originX: cx,
      originY: cy,
    };
  });

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${CompassSize} ${CompassSize}`}
    >
      <Defs>
        <Filter id="arrowGlowFilter" x="-80%" y="-80%" width="260%" height="260%">
          <FeGaussianBlur stdDeviation="10" />
        </Filter>
      </Defs>

      {/* Rotating group — driven by Reanimated */}
      <AnimatedG animatedProps={animatedGProps}>
        {/* Glow layer behind arrow */}
        <Path
          d={GLOW_PATH}
          fill={Colors.glow}
          opacity={0.45}
          filter="url(#arrowGlowFilter)"
        />

        {/* Tail fin (depth indicator) */}
        <Path
          d={TAIL_PATH}
          fill={Colors.foamMuted}
          stroke={Colors.stout}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Main arrow */}
        <Path
          d={ARROW_PATH}
          fill={Colors.amberLight}
          stroke={Colors.stout}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </AnimatedG>
    </Svg>
  );
});

// ── Hook ──────────────────────────────────────────────────────────────────

export function useArrowRotation() {
  const rotation = useSharedValue(0);

  function setRotation(deg: number) {
    rotation.value = withSpring(deg, {
      damping: 18,
      stiffness: 90,
    });
  }

  function stopRotation() {
    cancelAnimation(rotation);
  }

  return { rotation, setRotation, stopRotation };
}
