import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';
import { BeerIcon } from './IconGlyph';
import { cs } from '@/i18n/cs';

interface TitleBarProps {
  align?: 'center' | 'left';
  onSettings?: () => void;
  onSettingsLongPress?: () => void;
  showGear?: boolean;
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
}: TitleBarProps) {
  const isLeftAligned = align === 'left';

  return (
    <View style={[styles.container, isLeftAligned && styles.containerLeft]}>
      <View style={styles.logoRow}>
        <BeerIcon size={20} color={Colors.amber} />
        <Text style={styles.titleText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.compass.headerTitle}
        </Text>
      </View>

      {showGear && onSettings ? (
        <Pressable
          onPress={onSettings}
          onLongPress={onSettingsLongPress}
          style={[styles.gearTouchable, isLeftAligned && styles.gearTouchableLeft]}
          hitSlop={12}
          accessibilityLabel={cs.a11y.settingsButton}
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
    height: 40,
    paddingTop: 2,
    alignItems: 'flex-start',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleText: {
    fontFamily: Fonts.display.extrabold,
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
});
