import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, {
  Path,
  Defs,
  Filter,
  FeGaussianBlur,
} from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';
import { Colors } from '@/theme/colors';
import { CompassSize } from '@/theme/layout';

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
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.rotatingArrow,
        {
          width: size,
          height: size,
        },
        animatedStyle,
      ]}
    >
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${CompassSize} ${CompassSize}`}
      >
        <Defs>
          <Filter id="arrowGlowFilter" x="-80%" y="-80%" width="260%" height="260%">
            <FeGaussianBlur stdDeviation="5" />
          </Filter>
        </Defs>

        {/* Glow layer behind arrow */}
        <Path
          d={GLOW_PATH}
          fill={Colors.glow}
          opacity={0.22}
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
      </Svg>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  rotatingArrow: {
    transformOrigin: 'center',
  },
});
