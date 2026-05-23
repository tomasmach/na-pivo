import { ViewStyle } from 'react-native';
import { Colors, withAlpha } from './colors';

/**
 * Outer amber glow used on pill buttons, the celebration headline,
 * and other amber CTAs. Two variants: subtle and dramatic.
 */
export function amberGlow(radius: number = 18): ViewStyle {
  return {
    shadowColor: Colors.glow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: radius,
  };
}

/**
 * Strong amber glow for the arrival headline ("Na zdraví!") and
 * primary CTAs that need to feel hot.
 */
export function amberGlowStrong(radius: number = 32): ViewStyle {
  return {
    shadowColor: Colors.glow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: radius,
  };
}

/**
 * Subtle inset shadow for sunken elements like toggle thumb wells.
 * (RN doesn't support inset shadows natively — emulate with a darker
 * sibling layer when needed.)
 */
export function softDrop(): ViewStyle {
  return {
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  };
}

/**
 * Helper for SVG `filter` element — returns Gaussian-blur stdDeviation.
 */
export const SVG_GLOW_STD_DEVIATION = 10;

export const GlowColors = {
  amber: withAlpha(Colors.glow, 0.55),
  amberSoft: withAlpha(Colors.glow, 0.38),
  amberStrong: withAlpha(Colors.glow, 0.77),
} as const;
