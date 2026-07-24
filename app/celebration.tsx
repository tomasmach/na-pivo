import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerIcon, ChevronRightIcon } from '@/components/shared/IconGlyph';
import { BeerGlass } from '@/counter/BeerGlass';
import { CounterCta } from '@/counter/CounterCta';
import { cs } from '@/i18n/cs';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';
import { fireSuccessHaptic } from '@/utils/haptics';
import { openPubInMaps } from '@/utils/maps';

const FULL_GLASS_COUNT = 10;

export default function CelebrationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const revealedPub = usePubStore((state) => state.revealedPub);
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  useReducedMotion();

  const hapticFiredRef = useRef(false);
  const [bodyHeight, setBodyHeight] = useState(0);
  const glassWidth =
    bodyHeight > 0
      ? Math.max(80, Math.min(132, Math.round(bodyHeight * 0.26)))
      : 96;
  const headlineSize =
    bodyHeight > 0
      ? Math.max(44, Math.min(64, Math.round(bodyHeight * 0.15)))
      : 56;

  useEffect(() => {
    if (hapticEnabled && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      fireSuccessHaptic();
    }
  }, [hapticEnabled]);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
        <BeerIcon size={18} color={Colors.amber} />
        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.celebration.headerTitle}
        </Text>
      </View>

      <View style={styles.card}>
        <View
          style={styles.body}
          onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
        >
          <BeerGlass count={FULL_GLASS_COUNT} width={glassWidth} />

          <View style={styles.headlineWrap}>
            <Text
              style={[
                styles.headline,
                styles.headlineFoam,
                { fontSize: headlineSize, lineHeight: headlineSize * 1.24 },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={FontScaleCap.display}
            >
              {cs.celebration.headlineLine1}
            </Text>
            <Text
              style={[
                styles.headline,
                styles.headlineAmber,
                { fontSize: headlineSize, lineHeight: headlineSize * 1.24 },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={FontScaleCap.display}
            >
              {cs.celebration.headlineLine2}
            </Text>
          </View>

          <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.celebration.subtitle}
          </Text>
        </View>

        {revealedPub != null ? (
          <Pressable
            onPress={() => openPubInMaps(revealedPub)}
            style={({ pressed }) => [styles.footer, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.celebrationOpenMaps(revealedPub.name)}
          >
            <View style={styles.pubNameWrap}>
              <Text
                style={styles.pubName}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {revealedPub.name}
              </Text>
            </View>
            <View style={styles.mapDoor}>
              <Text
                style={styles.mapDoorLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.celebration.openInMaps}
              </Text>
              <ChevronRightIcon size={15} color={Colors.amber} />
            </View>
          </Pressable>
        ) : null}
      </View>

      <CounterCta
        label={cs.celebration.backToCompass}
        onPress={() => router.back()}
        accessibilityLabel={cs.a11y.celebrationBackToCompass}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    minHeight: 44,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerTitle: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  card: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  headlineWrap: {
    alignSelf: 'stretch',
  },
  headline: {
    fontFamily: Fonts.display.extrabold,
    letterSpacing: -1,
    textAlign: 'center',
    includeFontPadding: false,
  },
  headlineFoam: {
    color: Colors.foam,
  },
  headlineAmber: {
    color: Colors.amber,
  },
  caption: {
    marginTop: -6,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
  footer: {
    marginTop: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: HitArea.min,
  },
  pubNameWrap: {
    flex: 1,
    minWidth: 0,
  },
  pubName: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  mapDoor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mapDoorLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.85,
  },
});
