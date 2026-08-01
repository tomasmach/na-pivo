/**
 * A filter chip that drops a real iOS menu out of itself.
 *
 * This is the control Spendee uses on "add transaction" — tap the pill, a UIMenu
 * unfurls FROM it, anchored, with a checkmark on the current answer. We had an
 * `ActionSheetIOS` instead: the same system component, but presented from the
 * bottom of the screen, which loses the one thing that makes the anchored menu
 * good — you can see what you are changing while you change it.
 *
 * The earlier attempt at this went through `react-native-ios-context-menu`, and
 * that failed to link: `ld: cannot link directly with 'SwiftUICore'`. Fixing it
 * meant building React from source (`RCT_USE_PREBUILT_RNCORE=0`), which is a
 * permanent tax on every clean build for one control. None of that is needed —
 * `@expo/ui` ships SwiftUI's own `Menu`, it is already in the Podfile, and it
 * links because Expo's module already handles the SwiftUI dependency.
 *
 * The options are a `Picker`, not a list of `Button`s: SwiftUI renders a picker
 * inside a menu as a checkmarked single-choice list, which is exactly what a
 * filter is, and it means the tick is drawn by the system rather than by us
 * guessing which row is current.
 *
 * Android has no SwiftUI host, so it keeps the action-sheet chip. It is the
 * platform's own idiom there anyway.
 */

import React from 'react';
import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { HStack, Host, Image, Menu, Picker, Text as UIText } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  glassEffect,
  padding,
  pickerStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';

import { ChevronDownIcon } from '@/components/shared/IconGlyph';
import { MockLayout } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** Warm enough to read as ours, weak enough that it is still glass and not
 *  paint — §15.1: the material has to show what is behind it. */
const GLASS_TINT = withAlpha(Colors.amber, 0.12);

export function MenuChip({
  value,
  options,
  title,
  onChange,
}: {
  value: string;
  options: readonly string[];
  /** The question the menu answers, shown as its header. */
  title: string;
  onChange: (next: string) => void;
}) {
  if (Platform.OS === 'ios') {
    return (
      <Host matchContents colorScheme="dark" seedColor={Colors.amber}>
        <Menu
          // The label is composed in SwiftUI, not left as a bare string: a
          // string renders as text with a leading SF symbol and no chip at all,
          // which next to the app's own pills read as a broken control. This is
          // Spendee's shape — a liquid-glass capsule, the label, then a trailing
          // chevron — and being real glass it picks up whatever is behind it.
          label={
            <HStack
              spacing={5}
              modifiers={[
                padding({ horizontal: 14, vertical: 7 }),
                glassEffect({
                  glass: { variant: 'regular', interactive: true, tint: GLASS_TINT },
                  shape: 'capsule',
                }),
              ]}
            >
              <UIText modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(Colors.amber)]}>
                {value}
              </UIText>
              <Image systemName="chevron.down" size={10} color={Colors.amber} />
            </HStack>
          }
        >
          <Picker
            label={title}
            selection={value}
            onSelectionChange={(next) => {
              if (typeof next === 'string') onChange(next);
            }}
            modifiers={[pickerStyle('inline')]}
          >
            {options.map((option) => (
              <UIText key={option} modifiers={[tag(option)]}>
                {option}
              </UIText>
            ))}
          </Picker>
        </Menu>
      </Host>
    );
  }

  const open = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...options, 'Zrušit'],
        cancelButtonIndex: options.length,
        title,
        userInterfaceStyle: 'dark',
      },
      (index) => {
        if (index < options.length) onChange(options[index]);
      },
    );
  };

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
    >
      <Text style={styles.chipText} allowFontScaling={false}>
        {value}
      </Text>
      <ChevronDownIcon size={13} color={Colors.amber} />
    </Pressable>
  );
}

/** The plain toggle chip beside the menus — no menu, one bit of state. */
export function ToggleChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text
        style={[styles.chipText, !active && styles.chipTextOff]}
        allowFontScaling={false}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.65 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: MockLayout.pillHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  chipOn: { borderColor: withAlpha(Colors.amber, 0.5) },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.amber },
  chipTextOff: { color: Colors.mutedText },
});

/** Kept so screens can render the row without re-deriving the gap. */
export const CHIP_GAP = Spacing.xs;
export const ChipRow = View;
