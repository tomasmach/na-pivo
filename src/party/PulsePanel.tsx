/**
 * DESIGN MOCK — the state band over the night's numbers.
 *
 * Straight off Strava's record screen: a coloured strip naming what is happening
 * ("Auto-paused"), the numbers under it, and an expand arrow that throws those
 * numbers up at full size. The four stats were previously four fixed labels, so
 * the panel read like a printed form — the values changed, but nothing on the
 * screen ever SAID anything.
 *
 * Expanded is not a decorative flourish: a phone lying on a pub table at arm's
 * length is the actual reading distance, and 22pt does not survive it.
 *
 * The band's colour follows the state — amber while the night is going, muted
 * once it has stalled — because that is the one glance you take without picking
 * the phone up.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { XIcon } from '@/components/shared/IconGlyph';
import { StatGrid } from '@/mocks/StatGrid';
import { MockColors, MockType } from '@/mocks/mockTheme';
import type { Pulse } from '@/party/nightPulse';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export function PulsePanel({
  pulse,
  stats,
}: {
  pulse: Pulse;
  stats: { label: string; value: string }[];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const insets = useSafeAreaInsets();

  const stalled = pulse.kind === 'paused' || pulse.kind === 'idle';

  return (
    <>
      <Pressable
        onPress={() => setExpanded(true)}
        style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${pulse.headline}. ${pulse.basis}. Zvětšit čísla.`}
      >
        <View style={[styles.band, stalled && styles.bandStalled]}>
          <View style={styles.grow}>
            <Text
              style={[styles.headline, stalled && styles.headlineStalled]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {pulse.headline}
            </Text>
            <Text
              style={[styles.basis, stalled && styles.basisStalled]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {pulse.basis}
            </Text>
          </View>
          {/* The glyph set has no diagonal-expand arrow; two chevron strokes
              would be a worse lie than a plain word. */}
          <Text
            style={[styles.expand, stalled && styles.basisStalled]}
            allowFontScaling={false}
          >
            Zvětšit
          </Text>
        </View>

        <View style={styles.stats}>
          <StatGrid columns={4} compact stats={stats} />
        </View>
      </Pressable>

      <Modal visible={expanded} animationType="fade" onRequestClose={() => setExpanded(false)}>
        <View style={[styles.full, { paddingTop: insets.top }]}>
          <View style={[styles.fullBand, stalled && styles.bandStalled]}>
            <Text
              style={[styles.fullHeadline, stalled && styles.headlineStalled]}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {pulse.headline}
            </Text>
            <Pressable
              onPress={() => setExpanded(false)}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Zmenšit"
              hitSlop={10}
            >
              <XIcon size={18} color={stalled ? Colors.foam : Colors.stout} />
            </Pressable>
          </View>

          <View style={styles.fullBody}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.fullStat}>
                <Text style={styles.fullValue} allowFontScaling={false} numberOfLines={1}>
                  {stat.value}
                </Text>
                <Text style={styles.fullLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={[styles.fullBasis, { marginBottom: insets.bottom + Spacing.xl }]}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {pulse.basis}
          </Text>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 22, overflow: 'hidden', backgroundColor: MockColors.surfaceHigh },
  grow: { flex: 1 },
  pressed: { opacity: 0.85 },

  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.amber,
  },
  bandStalled: { backgroundColor: withAlpha(Colors.foam, 0.1) },
  headline: { fontSize: 16, fontWeight: '800', color: Colors.stout },
  headlineStalled: { color: Colors.foam },
  basis: { fontSize: 12, fontWeight: '600', color: withAlpha(Colors.stout, 0.75), marginTop: 1 },
  basisStalled: { color: Colors.mutedText },
  expand: { fontSize: 12, fontWeight: '700', color: withAlpha(Colors.stout, 0.75) },

  stats: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.xs },

  // — Expanded —
  full: { flex: 1, backgroundColor: MockColors.bg },
  fullBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.amber,
  },
  fullHeadline: { flex: 1, fontSize: 24, fontWeight: '800', color: Colors.stout },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.14),
  },

  fullBody: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  fullStat: { width: '50%', alignItems: 'center', paddingVertical: Spacing.xl },
  fullValue: {
    fontSize: 56,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  fullLabel: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: 2 },
  fullBasis: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
    color: Colors.mutedText,
    paddingHorizontal: Spacing.lg,
  },

  // referenced by the pill radius token so the band never outruns the card
  pill: { borderRadius: Radius.pill },
});
