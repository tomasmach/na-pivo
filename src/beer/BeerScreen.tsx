/**
 * "Štamgast" — the tab hosting the beer counter (Počítat) and the personal
 * trail (Deník) behind a single segmented control.
 *
 * It used to have three segments; "Výkon" and "Historie" turned out to be the
 * same screen wearing two hats — both opened on the last evening, both listed
 * what came before — so they merged into "Deník", which now also holds every
 * lifetime number one tap deep. Two segments, one data source (tallyStore), no
 * data migration: this screen owns the top safe-area inset + the segment, and
 * renders the chosen child in `embedded` mode (each child drops its own top
 * chrome).
 *
 * Switching segments unmounts the inactive child — the counter's geolocation
 * subscription and history's minute-tick only run for the visible half — while
 * the running tally itself lives in the persisted store, so nothing is lost.
 */

import React, { memo, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { reconcileLiveBeerActivityAndAutoArchive } from '@/liveActivity/liveBeerActivity';
import CounterScreen from '@/counter/CounterScreen';
import DiaryScreen from '@/diary/DiaryScreen';

type BeerTab = 'count' | 'diary';

interface SegmentedProps {
  tab: BeerTab;
  onChange: (tab: BeerTab) => void;
}

const Segmented = memo(function Segmented({ tab, onChange }: SegmentedProps) {
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);

  const press = (next: BeerTab) => {
    if (next === tab) return;
    if (hapticEnabled) fireLightImpactHaptic();
    onChange(next);
  };

  const segments: { key: BeerTab; label: string; a11y: string }[] = [
    { key: 'count', label: cs.beer.segmentCount, a11y: cs.a11y.beerSegmentCount },
    { key: 'diary', label: cs.beer.segmentDiary, a11y: cs.a11y.diarySegment },
  ];

  return (
    <View style={styles.segment}>
      {segments.map((seg) => {
        const active = seg.key === tab;
        return (
          <Pressable
            key={seg.key}
            onPress={() => press(seg.key)}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={seg.a11y}
          >
            <Text
              style={[styles.segmentLabel, active ? styles.segmentLabelActive : styles.segmentLabelMuted]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {seg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

export default function BeerScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<BeerTab>('count');

  useEffect(() => {
    // A deep link can mount this child before RootLayout's async initialization.
    // Hydrate and commit native additions before deciding that an evening is idle.
    void reconcileLiveBeerActivityAndAutoArchive();
  }, []);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Segmented tab={tab} onChange={setTab} />
      </View>
      <View style={styles.body}>
        {tab === 'count' ? <CounterScreen embedded /> : <DiaryScreen embedded />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  body: { flex: 1 },

  // Deliberately unlit: amber belongs to the count and the one button on the
  // counter below. A filled amber segment up here made three yellow blocks
  // compete on the same screen.
  segment: {
    flexDirection: 'row',
    backgroundColor: withAlpha(Colors.foam, 0.04),
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.08),
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: HitArea.min - 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
  },
  segmentItemActive: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  segmentLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    letterSpacing: 0.2,
    includeFontPadding: false,
  },
  segmentLabelActive: {
    color: Colors.foam,
  },
  segmentLabelMuted: {
    color: Colors.mutedText,
  },
});
