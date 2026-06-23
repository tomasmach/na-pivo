/**
 * Maps an amenity's bundled IconGlyph export NAME (as stored in the catalogue,
 * e.g. 'CreditCardIcon') to the actual IconGlyph component. The catalogue stores
 * a string so it can stay a plain data module; the sheet resolves it here. A key
 * the build doesn't know falls back to a neutral map-pin glyph rather than
 * crashing — forward-compat with a newer backend amenity (no-emoji rule means
 * icons are always app-shipped, so this is only a safety net).
 */

import React, { type ComponentType, type ReactElement } from 'react';

import {
  CreditCardIcon,
  BanknoteIcon,
  TreePineIcon,
  AccessibilityIcon,
  BabyIcon,
  TargetIcon,
  DicesIcon,
  Gamepad2Icon,
  RadioIcon,
  MicIcon,
  TvIcon,
  DogIcon,
  CigaretteIcon,
  WifiIcon,
  SquareParkingIcon,
  UtensilsIcon,
  BeerIcon,
  MapPinnedIcon,
} from '@/components/shared/IconGlyph';

interface IconProps {
  size?: number;
  color: string;
}

const ICON_BY_NAME: Record<string, ComponentType<IconProps>> = {
  CreditCardIcon,
  BanknoteIcon,
  TreePineIcon,
  AccessibilityIcon,
  BabyIcon,
  TargetIcon,
  DicesIcon,
  Gamepad2Icon,
  RadioIcon,
  MicIcon,
  TvIcon,
  DogIcon,
  CigaretteIcon,
  WifiIcon,
  SquareParkingIcon,
  UtensilsIcon,
  BeerIcon,
};

/**
 * Render an amenity glyph by its catalogue export name (MapPinned fallback).
 * Returns an element rather than a component so call sites never "create a
 * component during render" — the lookup picks a stable, module-level component.
 */
export function renderAmenityIcon(name: string, props: IconProps): ReactElement {
  const Icon: ComponentType<IconProps> = ICON_BY_NAME[name] ?? MapPinnedIcon;
  return React.createElement(Icon, props);
}
