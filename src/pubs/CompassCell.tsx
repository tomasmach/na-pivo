import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { XIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import type { PubPosition, PubPresentation } from '@/pubs/pubPresentation';
import { useCompassRotation } from '@/pubs/useCompassRotation';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const DIAL = 66;

export function CompassCell({
  pub,
  position,
  badge,
  onPress,
  onClose,
}: {
  pub: PubPresentation;
  position: PubPosition;
  badge: string;
  onPress?: () => void;
  /** Present only while the needle is borrowed by a friend's handoff — tapping
   *  it hands the head cell back to the list's own first pub. */
  onClose?: () => void;
}) {
  const rotation = useCompassRotation(position, { lat: pub.pub.lat, lng: pub.pub.lng });

  /**
   * "Schovávat názvy hospod" (settings). The needle still points, the distance
   * still counts down — only the name and the facts that would give it away
   * wait for a tap, exactly like the 2.x compass card. The reveal is keyed by
   * pub id, so the next pub the head cell picks is a secret again.
   */
  const hidePubNames = useSettingsStore((state) => state.hidePubNames);
  const [revealedId, setRevealedId] = React.useState<string | null>(null);
  const hidden = hidePubNames && revealedId !== pub.id;
  const name = hidden ? cs.compass.hiddenPubName : pub.name;
  const meta = hidden
    ? cs.compass.hiddenPubHint
    : [pub.openLabel, pub.beerLine].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={hidden ? () => setRevealedId(pub.id) : onPress}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${badge} hospoda ${name}, ${pub.distanceLabel ?? 'vzdálenost neznámá'}`}
    >
      <CompassContainer rotation={rotation} size={DIAL} />

      <View style={styles.body}>
        <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {name}
        </Text>
        <View style={styles.distanceRow}>
          <Text style={styles.distance} allowFontScaling={false}>
            {pub.distanceValue}
          </Text>
          <Text style={styles.unit} allowFontScaling={false}>
            {pub.distanceUnit}
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

      {onClose ? (
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={cs.compass.backToNearest}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <XIcon size={16} color={Colors.mutedText} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm + 2,
    marginHorizontal: -(Spacing.sm + 2),
    borderRadius: MockLayout.cardRadius,
    backgroundColor: withAlpha(Colors.amber, 0.09),
  },
  pressed: { opacity: 0.7 },
  body: { flex: 1 },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
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
