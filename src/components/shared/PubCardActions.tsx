import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

interface PubCardAction {
  label: string;
  accessibilityLabel?: string;
  icon: ReactNode;
  onPress: () => void;
}

interface PubCardActionsProps {
  primary: PubCardAction;
  secondary: PubCardAction;
  tertiary?: PubCardAction;
}

export function PubCardActions({ primary, secondary, tertiary }: PubCardActionsProps) {
  return (
    <View style={styles.footer}>
      <Pressable
        onPress={primary.onPress}
        hitSlop={8}
        style={({ pressed }) => [styles.action, styles.primaryAction, pressed && styles.pressed]}
        accessibilityLabel={primary.accessibilityLabel ?? primary.label}
        accessibilityRole="button"
      >
        {primary.icon}
        <Text
          style={styles.primaryText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {primary.label}
        </Text>
      </Pressable>

      <Pressable
        onPress={secondary.onPress}
        hitSlop={8}
        style={({ pressed }) => [styles.action, styles.secondaryAction, pressed && styles.pressed]}
        accessibilityLabel={secondary.accessibilityLabel ?? secondary.label}
        accessibilityRole="button"
      >
        {secondary.icon}
        <Text
          style={styles.secondaryText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {secondary.label}
        </Text>
      </Pressable>

      {tertiary ? (
        <Pressable
          onPress={tertiary.onPress}
          hitSlop={8}
          style={({ pressed }) => [styles.action, styles.tertiaryAction, pressed && styles.pressed]}
          accessibilityLabel={tertiary.accessibilityLabel ?? tertiary.label}
          accessibilityRole="button"
        >
          {tertiary.icon}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 2,
    paddingTop: 8,
    paddingHorizontal: 4,
    paddingBottom: 4,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.stout, 0.34),
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
    minHeight: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  primaryAction: {
    flex: 1.15,
    borderRadius: 12,
    backgroundColor: Colors.amber,
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.22),
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  tertiaryAction: {
    flex: 0,
    width: 38,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
    backgroundColor: withAlpha(Colors.foam, 0.04),
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  primaryText: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 11.5,
    lineHeight: 14,
    color: Colors.stout,
    textAlign: 'center',
    includeFontPadding: false,
    transform: [{ translateY: 1 }],
  },
  secondaryText: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 10.8,
    lineHeight: 13,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
});
