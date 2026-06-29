/**
 * ScanMenuButton — the entry affordance for AI menu scanning.
 *
 * Two states in one self-contained, memoized component so the perpetual scanning
 * animation runs on the UI thread (Reanimated) and never re-renders the heavy
 * ContributeScreen form around it:
 *
 *  - idle:     a tactile amber-tinted pill (Camera + label + a Sparkles hint that
 *              this is the AI shortcut). Press scales it down + fires a light haptic.
 *  - scanning: the same pill with a soft amber light beam sweeping across it on a
 *              seamless loop while the photo is read — Brass Taproom, alive, calm.
 *
 * Respects the OS reduce-motion setting: when on, the scanning state is static
 * (no sweeping beam), matching Toast/MapPubSheet. Single amber accent, no emoji.
 */

import React, { memo, useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { CameraIcon } from '@/components/shared/IconGlyph';
import { BetaBadge } from '@/components/shared/BetaBadge';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { cs } from '@/i18n/cs';

const BEAM_WIDTH = 96;

interface ScanMenuButtonProps {
  scanning: boolean;
  onPress: () => void;
}

function ScanMenuButtonImpl({ scanning, onPress }: ScanMenuButtonProps) {
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  // Loop progress 0->1 drives the sweeping beam (UI thread, never React state).
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (scanning && !reduceMotion) {
      sweep.value = 0;
      sweep.value = withRepeat(
        withTiming(1, { duration: 1300, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(sweep);
      sweep.value = 0;
    }
    return () => cancelAnimation(sweep);
  }, [scanning, reduceMotion, sweep]);

  const beamStyle = useAnimatedStyle(() => {
    // Beam re-enters from the left as it exits the right → a continuous sweep.
    const travel = width + BEAM_WIDTH;
    return {
      opacity: width > 0 ? 1 : 0,
      transform: [{ translateX: -BEAM_WIDTH + sweep.value * travel }, { skewX: '-18deg' }],
    };
  });

  const handlePress = () => {
    fireLightImpactHaptic();
    onPress();
  };

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (scanning) {
    return (
      <View
        style={[styles.pill, styles.pillScanning]}
        onLayout={onLayout}
        accessibilityRole="progressbar"
        accessibilityLabel={cs.contribute.scanMenu.loading}
        accessibilityLiveRegion="polite"
      >
        {!reduceMotion && (
          <Animated.View pointerEvents="none" style={[styles.beam, beamStyle]}>
            <Svg width="100%" height="100%">
              <Defs>
                <SvgLinearGradient id="scanBeam" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={Colors.amber} stopOpacity={0} />
                  <Stop offset="0.5" stopColor={Colors.amber} stopOpacity={0.24} />
                  <Stop offset="1" stopColor={Colors.amber} stopOpacity={0} />
                </SvgLinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#scanBeam)" />
            </Svg>
          </Animated.View>
        )}
        <CameraIcon size={18} color={Colors.amber} />
        <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.contribute.scanMenu.loading}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      onLayout={onLayout}
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.contribute.scanMenu.button}
    >
      <CameraIcon size={18} color={Colors.amber} />
      <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.contribute.scanMenu.button}
      </Text>
      <BetaBadge tone="muted" />
    </Pressable>
  );
}

export const ScanMenuButton = memo(ScanMenuButtonImpl);

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: HitArea.min,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.36),
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  pillPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: withAlpha(Colors.amber, 0.18),
  },
  pillScanning: {
    backgroundColor: withAlpha(Colors.amber, 0.16),
  },
  beam: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    width: BEAM_WIDTH,
  },
  label: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.amber,
  },
});
