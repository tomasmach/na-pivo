/**
 * DESIGN MOCK — the night's numbers as a real chart, with a type switcher.
 *
 * Two views of the same data, because they answer different questions:
 *
 *   sloupce   how it moved — order matters, so time and tempo go here
 *   koláč     how it split — proportion matters, so "which beer" and "who"
 *
 * Both are SwiftUI Charts through `@expo/ui`, not hand-drawn Views. The hand-
 * drawn version was a row of coloured `<View>`s with a percentage width: fine
 * until you want a pie, an axis, a legend or an animated transition between
 * types, at which point you are writing a charting library. `ExpoUI` is already
 * in the Podfile, so this is a component we already ship.
 *
 * The type switcher is Spendee's: two small icon buttons, not a third segmented
 * control. The segment above already asks "what am I looking at"; this asks
 * "how do I want it drawn", and the two must not look like the same question.
 *
 * Pie needs iOS 17+. Below that the switcher hides and bars are the only answer,
 * rather than offering a control that renders nothing.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Chart, Host } from '@expo/ui/swift-ui';

import { ChartColumnIcon, ChartPieIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export type ChartShape = 'bar' | 'pie';

/**
 * Slice colours. A pie needs one per slice or every wedge is the same amber and
 * the chart says nothing — so this is a warm ramp off the brand rather than a
 * rainbow, which would drag a second palette into the app.
 */
const SLICES = ['#E8A317', '#C4841A', '#9C651C', '#F0BE5C', '#7A4E18', '#FBF3E0'];

const CHART_HEIGHT = 190;

export function NightChart({
  rows,
  shape,
  onShape,
  control,
}: {
  rows: { label: string; value: number }[];
  shape: ChartShape;
  onShape: (next: ChartShape) => void;
  /** Rendered on the same row as the type switcher — what is measured on the
   *  left, how it is drawn on the right. */
  control?: React.ReactNode;
}) {
  // `Host` is `requireNativeView('ExpoUI', ...)` — the view only exists on iOS,
  // so on Android rendering it throws rather than degrading. SwiftUI Charts get
  // a plain RN fallback below.
  const native = Platform.OS === 'ios';
  const pieAvailable = native && Number.parseInt(String(Platform.Version), 10) >= 17;
  const effective: ChartShape = pieAvailable ? shape : 'bar';

  if (rows.length === 0) {
    return (
      <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
        Zatím není co kreslit.
      </Text>
    );
  }

  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);

  const data = rows.map((row, index) => ({
    x: row.label,
    y: row.value,
    // Bars stay one colour — they are one series measured over an axis. A pie
    // has no axis, so the colour IS the category.
    ...(effective === 'pie' ? { color: SLICES[index % SLICES.length] } : {}),
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.controls}>
        {control ?? <View style={styles.grow} />}
        {pieAvailable ? (
          <View style={styles.switcher}>
          <ShapeButton
            active={shape === 'bar'}
            label="Sloupcový graf"
            onPress={() => onShape('bar')}
          >
            <ChartColumnIcon size={16} color={shape === 'bar' ? Colors.stout : Colors.mutedText} />
          </ShapeButton>
            <ShapeButton
              active={shape === 'pie'}
              label="Koláčový graf"
              onPress={() => onShape('pie')}
            >
              <ChartPieIcon size={16} color={shape === 'pie' ? Colors.stout : Colors.mutedText} />
            </ShapeButton>
          </View>
        ) : null}
      </View>

      {native ? (
        <Host style={styles.host} colorScheme="dark" seedColor={Colors.amber}>
          <Chart
            data={data}
            type={effective}
            animate
            showGrid={effective === 'bar'}
            showLegend={effective === 'pie'}
            barStyle={{ cornerRadius: 6 }}
            pieStyle={{ innerRadius: 0.55, angularInset: 1.5 }}
          />
        </Host>
      ) : (
        <View style={styles.fallback}>
          {rows.map((row) => (
            <View key={row.label} style={styles.fallbackRow}>
              <Text
                style={styles.fallbackLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {row.label}
              </Text>
              <View style={styles.fallbackTrack}>
                <View
                  style={[
                    styles.fallbackFill,
                    { width: `${peak > 0 ? Math.max(4, (row.value / peak) * 100) : 4}%` },
                  ]}
                />
              </View>
              <Text style={styles.fallbackValue} allowFontScaling={false}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ShapeButton({
  active,
  label,
  children,
  onPress,
}: {
  active: boolean;
  label: string;
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.shape, active && styles.shapeOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      hitSlop={6}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  pressed: { opacity: 0.7 },
  host: { height: CHART_HEIGHT },
  empty: { fontSize: 14, fontWeight: '400', color: Colors.mutedText },

  grow: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switcher: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.07),
  },
  shape: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  shapeOn: { backgroundColor: Colors.amber },

  // Android: no SwiftUI host, so horizontal bars in plain RN. Deliberately not
  // a pretend pie — a hand-drawn pie is a lot of arithmetic for a shape that
  // says less than a bar does.
  fallback: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  fallbackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fallbackLabel: { width: 92, fontSize: 13, fontWeight: '600', color: Colors.foam },
  fallbackTrack: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    backgroundColor: withAlpha(Colors.foam, 0.07),
    overflow: 'hidden',
  },
  fallbackFill: { height: '100%', borderRadius: 6, backgroundColor: Colors.amber },
  fallbackValue: {
    width: 28,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
});
