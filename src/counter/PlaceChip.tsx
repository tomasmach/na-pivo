/**
 * PlaceChip — block 1 of the Tácek counter surface: where you are, tappable to
 * change. Purely presentational: the parent decides the kind and label, the
 * chip only renders and fires `onPress`. Design rule enforced here: the chip is
 * always pressable (even mid-detection), and only the 'unknown' state may raise
 * its voice — amber chrome that quietly asks "Kde sedíš?" — everything else
 * stays calm so the screen's single glow remains the CTA.
 */

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { t } from '@/i18n';
import {
  ChevronDownIcon,
  HouseIcon,
  MapPinIcon,
  TreePineIcon,
} from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export type PlaceChipKind = 'pub' | 'private' | 'outdoors' | 'other' | 'detecting' | 'unknown';

const KIND_ICON: Record<PlaceChipKind, typeof MapPinIcon> = {
  pub: MapPinIcon,
  private: HouseIcon,
  outdoors: TreePineIcon,
  other: MapPinIcon,
  detecting: MapPinIcon,
  unknown: MapPinIcon,
};

const CHIP_HEIGHT = 38;
/** Grow the 38pt row to the 44pt minimum touch target. */
const VERTICAL_SLOP = (44 - CHIP_HEIGHT) / 2;

export function PlaceChip({
  kind,
  label,
  onPress,
}: {
  kind: PlaceChipKind;
  label: string;
  onPress: () => void;
}) {
  const Icon = KIND_ICON[kind];
  const isUnknown = kind === 'unknown';
  const isDetecting = kind === 'detecting';

  const labelColor = isDetecting
    ? Colors.mutedText
    : isUnknown
      ? Colors.amber
      : Colors.foam;
  const chevronColor = isUnknown ? Colors.amber : Colors.mutedText;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP }}
      accessibilityRole="button"
      accessibilityLabel={t.a11y.counterPlaceChip(label)}
      style={({ pressed }) => [
        styles.chip,
        isUnknown ? styles.chipUnknown : styles.chipDefault,
        pressed && styles.pressed,
      ]}
    >
      <Icon size={16} color={Colors.amber} />
      <Text
        style={[styles.label, { color: labelColor }]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {label}
      </Text>
      {!isDetecting && <ChevronDownIcon size={14} color={chevronColor} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: Radius.pill,
    flexShrink: 1,
  },
  // Where you are is the screen's title, not a control fighting for attention:
  // no fill, no outline. Only the "Kde sedíš?" state gets a chip, because there
  // it IS a call to act.
  chipDefault: {
    borderWidth: 0,
    paddingHorizontal: 0,
  },
  chipUnknown: {
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    paddingHorizontal: Spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontWeight: '800',
    fontSize: 18,
    flexShrink: 1,
    includeFontPadding: false,
  },
});
