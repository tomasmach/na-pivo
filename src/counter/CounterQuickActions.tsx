/**
 * The two shortcuts that make logging easier, inside the evening card.
 *
 * "Jiné pivo" used to be a secondary button under the CTA that only appeared
 * once there was a last beer to repeat, and "Zmapuj hospodu" was a row inside
 * the "…" sheet. Both are things people reach for with a beer already in hand,
 * so both now sit on the surface, in the card, one tap from anywhere.
 *
 * They are outline chips (amber at 6 %), never filled: the screen's one full
 * amber surface is still its one big button. An action with no handler drops its
 * chip — outside a pub there is nothing to map — and with no handlers at all the
 * row renders nothing rather than an empty strip.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MapPinnedIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius } from '@/theme/layout';

export interface CounterQuickActionsProps {
  /** Opens "Co si dáš?" for a beer that isn't the last one. */
  onPickOther?: () => void;
  /** Opens the community mapping hub. Pub only. */
  onMapPub?: () => void;
}

export const CounterQuickActions = memo(function CounterQuickActions({
  onPickOther,
  onMapPub,
}: CounterQuickActionsProps) {
  if (!onPickOther && !onMapPub) return null;

  return (
    <View style={styles.row}>
      {onPickOther ? (
        <Chip
          label={t.counter.quickOtherBeer}
          a11yLabel={t.a11y.counterQuickOtherBeer}
          icon={<PlusIcon size={17} color={Colors.amber} />}
          onPress={onPickOther}
        />
      ) : null}
      {onMapPub ? (
        <Chip
          label={t.counter.quickMapPub}
          a11yLabel={t.a11y.counterQuickMapPub}
          icon={<MapPinnedIcon size={17} color={Colors.amber} />}
          onPress={onMapPub}
        />
      ) : null}
    </View>
  );
});

function Chip({
  label,
  a11yLabel,
  icon,
  onPress,
}: {
  label: string;
  a11yLabel: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      {icon}
      <Text
        style={styles.label}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    height: HitArea.min,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.18),
    backgroundColor: withAlpha(Colors.amber, 0.06),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    flexShrink: 1,
    fontWeight: '700',
    fontSize: 14,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
});
