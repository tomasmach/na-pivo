/**
 * DESIGN MOCK — the compass as the head cell of the pub list (§17.5).
 *
 * The point of this file is that the dial is REAL. An earlier pass drew a
 * static `CompassIcon` glyph, which is a picture of a compass, not a compass —
 * the one thing the product is known for, reduced to decoration.
 *
 * So it mounts the same `CompassContainer` the full screen uses, fed by the
 * same magnetometer stream (`useDeviceHeading`) through the same rotation
 * helper (`shortestRotationTarget`). There is no second source of truth and no
 * second animation path; this is the compass, smaller.
 *
 * Note it will sit still in the simulator — there is no magnetometer there.
 * On a device it turns.
 *
 * The needle points at the target's bearing MINUS the device heading, which is
 * what turns "north is that way" into "the pub is that way".
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { splitDistance, type PubListItem } from '@/pubs/pubPresentation';
import { useCompassRotation } from '@/pubs/useCompassRotation';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const DIAL = 66;

type CompassPub = PubListItem | {
  name: string;
  distance: string;
  lat: number;
  lng: number;
  open: boolean;
  hours: string;
  beer: string;
};

/** The list's head cell always points at the nearest real pub. */
export function CompassCell({
  pub,
  position,
  badge,
  onPress,
}: {
  pub: CompassPub;
  position?: { lat: number; lng: number };
  /** Why this pub owns the head cell. */
  badge: string;
  onPress?: () => void;
}) {
  const distance = splitDistance(pub.distance);
  const rotation = useCompassRotation(
    position ?? { lat: pub.lat, lng: pub.lng },
    { lat: pub.lat, lng: pub.lng },
  );
  const meta = 'hoursLabel' in pub
    ? `${pub.hoursLabel} · ${pub.beerLabel}`
    : `${pub.open ? 'Otevřeno' : 'Zavřeno'} ${pub.hours} · ${pub.beer}`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${badge} hospoda ${pub.name}, ${pub.distance}`}
    >
      <CompassContainer rotation={rotation} size={DIAL} />

      {/* Name first: that is what you are looking for. The distance is a
          property OF the pub, so it reads underneath — and the badge says why
          this one is at the top of the list at all. */}
      <View style={styles.body}>
        <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.name}
        </Text>
        <View style={styles.distanceRow}>
          <Text style={styles.distance} allowFontScaling={false}>
            {distance.value}
          </Text>
          <Text style={styles.unit} allowFontScaling={false}>
            {distance.unit}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText} allowFontScaling={false}>
              {badge}
            </Text>
          </View>
        </View>
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    // Packeta highlights the nearest branch with a tinted row, not a bordered
    // card — the fill says "this is the one" without adding a frame. One tinted
    // row among plain ones stays calm; tinting every row is what read as busy.
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm + 2,
    marginHorizontal: -(Spacing.sm + 2),
    borderRadius: MockLayout.cardRadius,
    backgroundColor: withAlpha(Colors.amber, 0.09),
  },
  pressed: { opacity: 0.7 },
  body: { flex: 1 },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  badge: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
    marginLeft: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: Colors.amber },
  distance: {
    fontSize: 34,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  unit: { ...MockType.bodySmall, color: Colors.mutedText },
  pub: { ...MockType.titleS, color: Colors.foam },
  meta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
});
