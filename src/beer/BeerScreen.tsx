/**
 * "Pivo" — the merged tab hosting both the beer counter (Počítadlo) and the
 * personal evening history (Moje piva) behind a single segmented control. They
 * already share one data source (tallyStore), so combining them frees a slot in
 * the bottom tab bar without any data migration: this screen owns the top
 * safe-area inset + the segment, and renders the chosen child in `embedded`
 * mode (each child then drops its own top chrome).
 *
 * Switching segments unmounts the inactive child — the counter's geolocation
 * subscription and history's minute-tick only run for the visible half — while
 * the running tally itself lives in the persisted store, so nothing is lost.
 */

import React, { memo, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';
import CounterScreen from '@/counter/CounterScreen';
import MyBeersScreen from '@/myBeers/MyBeersScreen';

type BeerTab = 'count' | 'history';

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
    { key: 'history', label: cs.beer.segmentHistory, a11y: cs.a11y.beerSegmentHistory },
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
  const maybeAutoArchive = useTallyStore((s) => s.maybeAutoArchive);

  useEffect(() => {
    // Opening the tab is a natural sweep point: an evening left idle past the
    // timeout drops to history (becoming resumable) instead of lingering live.
    maybeAutoArchive();
  }, [maybeAutoArchive]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Segmented tab={tab} onChange={setTab} />
      </View>
      <View style={styles.body}>
        {tab === 'count' ? <CounterScreen embedded /> : <MyBeersScreen embedded />}
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

  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
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
    backgroundColor: Colors.amber,
  },
  segmentLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  segmentLabelActive: {
    color: Colors.stout,
  },
  segmentLabelMuted: {
    color: Colors.mutedText,
  },
});
