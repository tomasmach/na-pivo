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

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { initialBearing } from '@/compass/bearing';
import { shortestRotationTarget } from '@/compass/rotation';
import { useDeviceHeading } from '@/compass/useDeviceHeading';
import { MOCK_COMPASS_TARGET } from '@/pubs/mockPubs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const DIAL = 66;
/** Stand-in for the device position until the mock is wired to location. */
const HERE = { lat: 50.077, lng: 14.4165 };

const SPRING = { damping: 18, stiffness: 140, mass: 0.6 } as const;

export function CompassCell({ onPress }: { onPress?: () => void }) {
  const t = MOCK_COMPASS_TARGET;
  const { smoothedHeading } = useDeviceHeading(true);

  const bearing = useMemo(
    () =>
      initialBearing({
        lat1: HERE.lat,
        lng1: HERE.lng,
        lat2: t.lat,
        lng2: t.lng,
      }),
    [t.lat, t.lng],
  );

  const rotation = useSharedValue(0);
  const lastTarget = useSharedValue(0);
  const hasTarget = useSharedValue(false);

  // "Where is the pub" = its bearing, less wherever the phone is facing.
  const arrow = useDerivedValue(() =>
    smoothedHeading.value === null ? null : bearing - smoothedHeading.value,
  );

  useAnimatedReaction(
    () => arrow.value,
    (target, previous) => {
      if (target === null || target === previous) return;
      const current = hasTarget.value ? lastTarget.value : rotation.value;
      const next = shortestRotationTarget(current, target);
      hasTarget.value = true;
      lastTarget.value = next;
      rotation.value = withSpring(next, SPRING);
    },
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Nejbližší hospoda ${t.name}, ${t.distance} ${t.unit}`}
    >
      <CompassContainer rotation={rotation} size={DIAL} />

      {/* Name first: that is what you are looking for. The distance is a
          property OF the pub, so it reads underneath — and the badge says why
          this one is at the top of the list at all. */}
      <View style={styles.body}>
        <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.name}
        </Text>
        <View style={styles.distanceRow}>
          <Text style={styles.distance} allowFontScaling={false}>
            {t.distance}
          </Text>
          <Text style={styles.unit} allowFontScaling={false}>
            {t.unit}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText} allowFontScaling={false}>
              Nejbližší
            </Text>
          </View>
        </View>
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.hours} · {t.beer}
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
    padding: Spacing.md,
    borderRadius: MockLayout.cardRadius,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.24),
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
