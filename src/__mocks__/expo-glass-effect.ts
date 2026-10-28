/**
 * Test mock for expo-glass-effect (native view, untranspiled ESM source).
 * Tests run without liquid glass, so every glass surface takes its fallback.
 */

import { View } from 'react-native';

export const GlassView = View;

export function isLiquidGlassAvailable(): boolean {
  return false;
}
