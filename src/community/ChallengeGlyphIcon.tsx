/**
 * The glyph on a challenge card.
 *
 * One per kind of challenge, because the card's job is to tell three of them
 * apart across a scroll: a pin for "go somewhere new", a calendar for "keep a
 * rhythm", a beer for "taste something else". They all used to carry the same
 * sparkle, which told you a card was a card.
 *
 * Its own module so the list and anything else that draws a challenge cannot
 * pick different pictures for the same thing.
 */

import React from 'react';

import { BeerIcon, HistoryIcon, MapPinnedIcon } from '@/components/shared/IconGlyph';
import type { ChallengeGlyph } from '@/data/challengesClient';

const GLYPHS: Record<ChallengeGlyph, React.ComponentType<{ size?: number; color: string }>> = {
  places: MapPinnedIcon,
  rhythm: HistoryIcon,
  taste: BeerIcon,
};

export function ChallengeGlyphIcon({
  glyph,
  size = 17,
  color,
}: {
  glyph: ChallengeGlyph;
  size?: number;
  color: string;
}) {
  const Icon = GLYPHS[glyph] ?? MapPinnedIcon;
  return <Icon size={size} color={color} />;
}
