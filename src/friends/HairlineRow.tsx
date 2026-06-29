import React, { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { Spacing } from '@/theme/layout';

export interface HairlineRowProps {
  children: ReactNode;
  /** When provided the row becomes pressable with an opacity dip. */
  onPress?: () => void;
  /** First row in a group skips the top hairline so the stack opens flush. */
  first?: boolean;
}

/**
 * Generic hairline-separated list row drawn straight on the bare stout ground
 * (no card). Top hairline (`StyleSheet.hairlineWidth`, faint border) closes the
 * row above it; the first row in a group omits it. Tappable rows dip opacity on
 * press — no scale (lists hold their size; elevation is reserved for the live
 * loop cards).
 */
function HairlineRowComponent({ children, onPress, first }: HairlineRowProps) {
  const baseStyle: ViewStyle = first ? styles.rowFirst : styles.row;

  if (!onPress) {
    return <View style={baseStyle}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [baseStyle, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowFirst: {
    paddingVertical: Spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default memo(HairlineRowComponent);
