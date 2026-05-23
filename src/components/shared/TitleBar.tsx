import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';
import { BeerIcon } from './IconGlyph';
import { cs } from '@/i18n/cs';

interface TitleBarProps {
  onSettings?: () => void;
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

export const TitleBar = memo(function TitleBar({ onSettings, showGear = true }: TitleBarProps) {
  return (
    <View style={styles.container}>
      {/* Centered logo: beer icon + title */}
      <View style={styles.logoRow}>
        <BeerIcon size={20} color={Colors.amber} />
        <Text style={styles.titleText}>{cs.compass.headerTitle}</Text>
      </View>

      {/* Subtle gear in the top-right corner (absolute so the title stays centered) */}
      {showGear && onSettings ? (
        <Pressable
          onPress={onSettings}
          style={styles.gearTouchable}
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
    alignItems: 'center',
    justifyContent: 'center',
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
});
