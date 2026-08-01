/**
 * DESIGN MOCK — the night's state and its numbers, at the top of the hub.
 *
 * It started as Strava's record panel: a coloured band naming the state, the
 * numbers under it, all inside a card. The card was the problem — a panel drawn
 * around the four biggest numbers on the screen frames them as a widget, when
 * they ARE the screen. So the box goes and the numerals sit straight on the
 * ground, big enough to read from across the table.
 *
 * Labels go too. "Tvoje 1" needs the word; "1 pivo" does not, so the unit rides
 * with the value and a whole row of muted captions disappears.
 *
 * The state line ("Rozjezd · První pivo právě teď") is gone from the compact
 * view. Over four big numbers it was a caption on something that needs none, and
 * at the start of an evening it announced that nothing had happened yet. It
 * survives in the EXPANDED view, where there is room for the night to say
 * something and where you have asked to look at it.
 *
 * Tapping still blows the numbers up full screen: a phone lying on a pub table
 * is at arm's length and 34pt does not survive that.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { XIcon } from '@/components/shared/IconGlyph';
import { MockColors, MockType } from '@/mocks/mockTheme';
import type { Pulse } from '@/party/nightPulse';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export interface PulseStat {
  value: string;
  /** Rides with the numeral instead of captioning it. */
  unit?: string;
}

export function PulsePanel({ pulse, stats }: { pulse: Pulse; stats: PulseStat[] }) {
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
        <View style={styles.numbers}>
          {stats.map((stat) => (
            <Text
              key={`${stat.value}-${stat.unit ?? ''}`}
              style={styles.value}
              allowFontScaling={false}
              numberOfLines={1}
            >
              {stat.value}
              {stat.unit ? <Text style={styles.unit}> {stat.unit}</Text> : null}
            </Text>
          ))}
        </View>
      </Pressable>

      <Modal visible={expanded} animationType="fade" onRequestClose={() => setExpanded(false)}>
        <View style={[styles.full, { paddingTop: insets.top + Spacing.md }]}>
          <View style={styles.fullHead}>
            <View style={styles.grow}>
              <Text
                style={[styles.fullHeadline, stalled && styles.headlineStalled]}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {pulse.headline}
              </Text>
              <Text style={styles.basis} maxFontSizeMultiplier={FontScaleCap.body}>
                {pulse.basis}
              </Text>
            </View>
            <Pressable
              onPress={() => setExpanded(false)}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Zmenšit"
              hitSlop={10}
            >
              <XIcon size={18} color={Colors.foam} />
            </Pressable>
          </View>

          <View style={styles.fullBody}>
            {stats.map((stat) => (
              <View key={`${stat.value}-${stat.unit ?? ''}`} style={styles.fullStat}>
                <Text style={styles.fullValue} allowFontScaling={false} numberOfLines={1}>
                  {stat.value}
                </Text>
                {stat.unit ? (
                  <Text style={styles.fullUnit} maxFontSizeMultiplier={FontScaleCap.body}>
                    {stat.unit}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  grow: { flex: 1 },
  pressed: { opacity: 0.75 },

  stateRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  headline: { fontSize: 15, fontWeight: '800', color: Colors.amber },
  headlineStalled: { color: Colors.mutedText },
  basis: { flex: 1, fontSize: 13, fontWeight: '500', color: Colors.mutedText },

  numbers: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.lg, flexWrap: 'wrap' },
  value: {
    fontSize: 34,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 15, fontWeight: '600', color: Colors.mutedText, letterSpacing: 0 },

  // — Expanded —
  full: { flex: 1, backgroundColor: MockColors.bg, paddingHorizontal: Spacing.lg },
  fullHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fullHeadline: { fontSize: 24, fontWeight: '800', color: Colors.amber },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  fullBody: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullStat: { width: '50%', alignItems: 'center', paddingVertical: Spacing.xl },
  fullValue: {
    fontSize: 58,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  fullUnit: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: 2 },
});
