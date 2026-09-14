/**
 * `expo-glass-effect` ships ESM that Jest does not transform (its folder is
 * `expo-glass-effect`, not `expo/`, so `transformIgnorePatterns` misses it).
 * Suites used to mock it one by one, which broke the moment a screen reached
 * the glass through a new import path.
 *
 * Liquid glass reports as unavailable, so tests exercise the opaque fallback —
 * the branch that has to be right on every device that is not iOS 26 (§15.2).
 */

import React from 'react';

export const GlassView = (props: Record<string, unknown>) =>
  React.createElement('GlassView', props);

export const isLiquidGlassAvailable = () => false;
