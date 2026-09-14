import React, { memo, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';
import { BeerIcon } from './IconGlyph';
import { t } from '@/i18n';

interface TitleBarProps {
  align?: 'center' | 'left';
  onSettings?: () => void;
  onSettingsLongPress?: () => void;
  showGear?: boolean;
  /** Hidden long-press on the logo (used as a dev shortcut). */
  onLogoLongPress?: () => void;
  /** Optional control rendered centered in the header. */
  filterSlot?: ReactNode;
}

function GearIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      <Path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <Path d="M12 2v2" />
      <Path d="M12 20v2" />
      <Path d="m4.93 4.93 1.41 1.41" />
      <Path d="m17.66 17.66 1.41 1.41" />
      <Path d="M2 12h2" />
      <Path d="M20 12h2" />
      <Path d="m6.34 17.66-1.41 1.41" />
      <Path d="m19.07 4.93-1.41 1.41" />
    </Svg>
  );
}

export const TitleBar = memo(function TitleBar({
  align = 'center',
  onSettings,
  onSettingsLongPress,
  showGear = true,
  onLogoLongPress,
  filterSlot,
}: TitleBarProps) {
  const isLeftAligned = align === 'left';

  return (
    <View style={[styles.container, isLeftAligned && styles.containerLeft]}>
      <Pressable
        style={styles.logoRow}
        onLongPress={onLogoLongPress}
        // Long-press is a hidden dev shortcut; the logo is otherwise inert, so
        // disable the press ripple/feedback to keep it feeling non-interactive.
        android_disableSound
      >
        <BeerIcon size={20} color={Colors.amber} />
        <Text style={styles.titleText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.compass.headerTitle}
        </Text>
      </Pressable>

      {/* Centered in the header. box-none so the empty side areas pass touches
          through to the logo behind it (only the control itself is tappable). */}
      {filterSlot ? (
        <View
          style={[styles.filterSlot, isLeftAligned && styles.filterSlotLeft]}
          pointerEvents="box-none"
        >
          {filterSlot}
        </View>
      ) : null}

      {showGear && onSettings ? (
        <Pressable
          onPress={onSettings}
          onLongPress={onSettingsLongPress}
          style={[styles.gearTouchable, isLeftAligned && styles.gearTouchableLeft]}
          hitSlop={12}
          accessibilityLabel={t.a11y.settingsButton}
          accessibilityRole="button"
        >
          <GearIcon size={20} color={Colors.foamMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    height: 48,
    paddingTop: 10,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  containerLeft: {
    height: 48,
    paddingTop: 2,
    alignItems: 'flex-start',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleText: {
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    letterSpacing: 0.2,
  },
  gearTouchable: {
    position: 'absolute',
    right: 20,
    top: 10,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  gearTouchableLeft: {
    top: 2,
  },
  // Right-aligned to mirror the logo on the left — both sit 24px from their
  // edge for a symmetric header. left:0 keeps the box full-width (with box-none
  // the empty left area still passes touches to the logo).
  filterSlot: {
    position: 'absolute',
    left: 0,
    right: 24,
    top: 8,
    bottom: 8,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  filterSlotLeft: {
    top: 2,
    bottom: 2,
  },
});
