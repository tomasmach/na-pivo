import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius } from '@/theme/layout';
import type { PubHoursTone } from '@/utils/pubHoursLine';

interface CardAction {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}

export interface MapTargetCardProps {
  /** Formatted, e.g. "350 m" or "2,5 km"; null before the first fix. */
  distance: string | null;
  /** Null while the name is a secret. */
  pubName: string | null;
  hoursLabel: string | null;
  hoursTone: PubHoursTone;
  beerLine: string | null;
  showDetailLink: boolean;
  /** Opens the pub page, or reveals the name while it is a secret. */
  onPressPub: () => void;
  pubAccessibilityLabel: string;
  primary: CardAction;
  secondary: CardAction;
}

function hoursColor(tone: PubHoursTone): string {
  if (tone === 'open') return Colors.open;
  if (tone === 'closed') return Colors.closed;
  return Colors.mutedText;
}

/** The compass target on the home map: where it is, how far, and the two things to do about it. */
export function MapTargetCard({
  distance,
  pubName,
  hoursLabel,
  hoursTone,
  beerLine,
  showDetailLink,
  onPressPub,
  pubAccessibilityLabel,
  primary,
  secondary,
}: MapTargetCardProps) {
  const unitAt = distance ? distance.lastIndexOf(' ') : -1;
  const distanceValue = distance && unitAt > 0 ? distance.slice(0, unitAt) : distance;
  const distanceUnit = distance && unitAt > 0 ? distance.slice(unitAt + 1) : null;

  return (
    <View>
      <View style={styles.top}>
        <Pressable
          onPress={onPressPub}
          style={({ pressed }) => [styles.pub, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={pubAccessibilityLabel}
        >
          {pubName === null ? (
            <Text style={styles.revealHint} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.compass.revealHint}
            </Text>
          ) : (
            <>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {pubName}
                </Text>
                {showDetailLink ? <ChevronRightIcon size={18} color={Colors.mutedText} /> : null}
              </View>
              {hoursLabel !== null ? (
                <View style={styles.metaRow}>
                  <View style={[styles.dot, { backgroundColor: hoursColor(hoursTone) }]} />
                  <Text
                    style={[styles.hours, { color: hoursColor(hoursTone) }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {hoursLabel}
                  </Text>
                </View>
              ) : null}
              {beerLine !== null ? (
                <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {beerLine}
                </Text>
              ) : null}
            </>
          )}
        </Pressable>
        {distanceValue ? (
          <View style={styles.distance} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.distanceValue} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.display}>
              {distanceValue}
            </Text>
            {distanceUnit ? (
              <Text style={styles.distanceUnit} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.display}>
                {distanceUnit}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={primary.onPress}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={primary.accessibilityLabel}
        >
          <Text style={styles.primaryLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.display}>
            {primary.label}
          </Text>
        </Pressable>
        <Pressable
          onPress={secondary.onPress}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={secondary.accessibilityLabel}
        >
          <Text
            style={styles.secondaryLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {secondary.label}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  pub: {
    flex: 1,
    minWidth: 0,
    minHeight: HitArea.min,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    lineHeight: 23,
    color: Colors.foam,
    includeFontPadding: false,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
  },
  hours: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    marginTop: 3,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  revealHint: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  distance: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  distanceValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -0.6,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  distanceUnit: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  actions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  primary: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 16,
    color: Colors.stout,
    includeFontPadding: false,
  },
  secondary: {
    flexShrink: 1,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
});
