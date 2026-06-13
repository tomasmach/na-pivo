import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';
import { LinearBackdrop } from './Gradient';
import { BeerIcon } from './IconGlyph';
import { cs } from '@/i18n/cs';

interface TitleBarProps {
  align?: 'center' | 'left';
  onSettings?: () => void;
  onSettingsLongPress?: () => void;
  showGear?: boolean;
}

// Two-tone wordmark split for "na pivo": muted lead + amber accent.
const WORDMARK_LEAD = 'na ';
const WORDMARK_ACCENT = 'pivo';

// Brushed-brass medallion with a beer mug embossed into it — the same
// brass-disk-with-dark-glyph language as the locked pub card, so the wordmark
// reads unmistakably "beer" while staying on the premium brass palette.
function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <View style={[styles.brandMark, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearBackdrop
        vertical
        stops={[
          { offset: 0, color: Colors.amberLight },
          { offset: 0.5, color: Colors.amber },
          { offset: 1, color: Colors.brassShadow },
        ]}
      />
      <BeerIcon size={Math.round(size * 0.62)} color={Colors.enamel} />
    </View>
  );
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
    <View>
      <View style={[styles.container, isLeftAligned && styles.containerLeft]}>
        <View style={styles.logoRow}>
          <BrandMark size={22} />
          <Text style={styles.titleText} maxFontSizeMultiplier={FontScaleCap.heading}>
            <Text style={styles.titleLead}>{WORDMARK_LEAD}</Text>
            <Text style={styles.titleAccent}>{WORDMARK_ACCENT}</Text>
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
            <View style={styles.gearDisk}>
              <GearIcon size={20} color={Colors.mutedText} />
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* engraved hairline: 1px highlight above a 1px rule */}
      <View style={styles.hairlineHighlight} />
      <View style={styles.hairlineRule} />
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
  brandMark: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    letterSpacing: -0.5,
  },
  titleLead: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.foamMuted,
  },
  titleAccent: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
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
  gearDisk: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.04),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.5),
  },
  hairlineHighlight: {
    height: 1,
    backgroundColor: withAlpha(Colors.foam, 0.05),
  },
  hairlineRule: {
    height: 1,
    backgroundColor: withAlpha(Colors.border, 0.4),
  },
});
