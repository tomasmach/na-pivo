/**
 * Mapy.com attribution logo — required by the Mapy.com REST API terms whenever
 * the API is used (including the /v1/suggest place search this app relies on).
 *
 * Uses the official PLAIN logo variant rendered as a vector via `SvgXml`, so it
 * stays crisp at any size and works offline (unlike SvgUri, which would fetch
 * at runtime). The wordmark artwork is black, so callers MUST place it on a
 * light backing (see the white chip in app/index.tsx) — the logo itself must
 * never be recoloured, per Mapy.com's attribution rules.
 *
 * Minimum height outside a map is 10 px for this variant; we default a little
 * larger for legibility. viewBox is 0 0 100 30 (aspect ratio 10:3).
 */

import React, { memo } from 'react';
import { SvgXml } from 'react-native-svg';

import { MAPY_LOGO_PLAIN } from './mapyLogoSvg';

const ASPECT_RATIO = 100 / 30;

interface MapyLogoProps {
  /** Rendered height in px (>= 10 to satisfy Mapy.com attribution rules). */
  height?: number;
}

export const MapyLogo = memo(function MapyLogo({ height = 14 }: MapyLogoProps) {
  return <SvgXml xml={MAPY_LOGO_PLAIN} height={height} width={height * ASPECT_RATIO} />;
});
