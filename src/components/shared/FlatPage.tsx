/**
 * The flat page language of the approved pub page (DESIGN.md "Schválená stránka
 * hospody"): sections on the ground, dark bands between them, hairline rows.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

export const PAGE_PAD = 20;

export function RoundButton({
  onPress,
  label,
  selected,
  testID,
  children,
}: {
  onPress: () => void;
  label: string;
  selected?: boolean;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      {children}
    </Pressable>
  );
}

/** The dark gap between sections; runs edge to edge (DESIGN.md §5.2). */
export function Band() {
  return <View style={styles.band} />;
}

export function SectionTitle({ title, aside }: { title: string; aside?: string | null }) {
  return (
    <View style={styles.sectionHead}>
      <Text
        style={styles.sectionTitle}
        accessibilityRole="header"
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {title}
      </Text>
      {aside ? (
        <Text style={styles.sectionAside} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {aside}
        </Text>
      ) : null}
    </View>
  );
}

/** A row that opens something: title, optional subtitle, value and chevron. */
export function ListRow({
  title,
  subtitle,
  value,
  leading,
  onPress,
  first = false,
  testID,
}: {
  title: string;
  subtitle?: string | null;
  value?: string | null;
  leading?: React.ReactNode;
  onPress: () => void;
  first?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowDivided, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
    >
      {leading}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {value}
        </Text>
      ) : null}
      <ChevronRightIcon size={16} color={Colors.mutedText} />
    </Pressable>
  );
}

function Toggle({
  value,
  onToggle,
  accessibilityLabel,
  testID,
}: {
  value: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const offset = useSharedValue(value ? 24 : 2);

  useEffect(() => {
    offset.value = withSpring(value ? 24 : 2, { mass: 0.6, damping: 14, stiffness: 200 });
  }, [offset, value]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Pressable
      testID={testID}
      onPress={onToggle}
      style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
    >
      <Animated.View
        style={[styles.toggleThumb, value ? styles.toggleThumbOn : styles.toggleThumbOff, softDrop(), thumbStyle]}
      />
    </Pressable>
  );
}

/** A switch row. The switch's label carries its state, e.g. "Vibrace: zapnuto". */
export function ToggleRow({
  title,
  subtitle,
  value,
  onToggle,
  toggleLabel,
  first = false,
  testID,
}: {
  title: string;
  subtitle?: string | null;
  value: boolean;
  onToggle: () => void;
  toggleLabel: string;
  first?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.row, !first && styles.rowDivided]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={3} maxFontSizeMultiplier={FontScaleCap.body}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Toggle testID={testID} value={value} onToggle={onToggle} accessibilityLabel={toggleLabel} />
    </View>
  );
}

const styles = StyleSheet.create({
  roundButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.65,
  },
  band: {
    height: 10,
    marginTop: Spacing.lg,
    marginHorizontal: -PAGE_PAD,
    backgroundColor: Colors.deep,
  },
  sectionHead: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: Colors.foam,
  },
  sectionAside: {
    flexShrink: 1,
    fontSize: 13,
    color: Colors.mutedText,
  },
  row: {
    minHeight: 60,
    paddingVertical: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.foam,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 14,
    color: Colors.mutedText,
  },
  rowValue: {
    flexShrink: 1,
    fontSize: 15,
    color: Colors.mutedText,
  },
  toggle: {
    width: 50,
    height: 30,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: withAlpha(Colors.amber, 0.32),
    borderColor: withAlpha(Colors.amber, 0.45),
  },
  toggleOff: {
    backgroundColor: Colors.stout3,
    borderColor: withAlpha(Colors.foam, 0.08),
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
  },
  toggleThumbOn: { backgroundColor: Colors.foam },
  toggleThumbOff: { backgroundColor: Colors.mutedText },
});
