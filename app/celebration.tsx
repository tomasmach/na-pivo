import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { fireSuccessHaptic } from '@/utils/haptics';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { openPubInMaps } from '@/utils/maps';
import { FoamDrip } from '@/components/celebration/FoamDrip';
import { FoamDrops } from '@/components/celebration/FoamDrops';
import { buildFoamTongues } from '@/components/celebration/foamAnchors';
import { BeerBubbles } from '@/components/celebration/BeerBubbles';
import { SoftGlow } from '@/components/celebration/SoftGlow';
import { GlowButton } from '@/components/shared/GlowButton';
import { BeerIcon, MapPinIcon } from '@/components/shared/IconGlyph';

/**
 * How far the foam SVG bleeds above the visible screen edge. Big enough that
 * even on devices with a tall status bar / dynamic island, the foam's cap
 * fully covers the top — the actual clip happens behind the device bezel.
 */
const FOAM_OVERHANG = 60;

type CelebrationLayout = {
  buttonHeight: number;
  cardPaddingHorizontal: number;
  cardPaddingVertical: number;
  contentWidth: number;
  foamBottom: number;
  foamHeight: number;
  headlineFontSize: number;
  headlineLineHeight: number;
  iconSize: number;
  justifyContent: 'center' | 'flex-start';
  paddingBottom: number;
  paddingTop: number;
  pubNameFontSize: number;
  subtitleMarginBottom: number;
  subtitlePaddingTop: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Continuous scaling instead of hard-coded buckets: `t` is 1 on every normal
// phone (full design, matching the original screens) and shrinks smoothly only
// when the viewport is genuinely short — e.g. an iPhone-compatibility window on
// iPad. The ScrollView below guarantees the back button stays reachable even if
// the content can't fully fit.
function getCelebrationLayout(width: number, height: number, topInset: number, bottomInset: number): CelebrationLayout {
  const usableHeight = height - topInset - bottomInset;
  const t = clamp(usableHeight / 740, 0.66, 1);

  return {
    buttonHeight: Math.round(clamp(64 * t, 48, 64)),
    cardPaddingHorizontal: Math.round(22 * t),
    cardPaddingVertical: Math.round(18 * t),
    contentWidth: Math.min(width - 48, 342),
    foamBottom: Math.round(108 * t),
    foamHeight: Math.round(236 * t),
    headlineFontSize: Math.round(84 * t),
    headlineLineHeight: Math.round(110 * t),
    iconSize: Math.round(96 * t),
    justifyContent: t < 0.85 ? 'flex-start' : 'center',
    paddingBottom: bottomInset + Math.round(24 * t),
    paddingTop: topInset + Math.round(170 * t),
    pubNameFontSize: Math.round(30 * t),
    subtitleMarginBottom: Math.round(24 * t),
    subtitlePaddingTop: Math.round(14 * t),
  };
}

export default function CelebrationScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const router = useRouter();
  const revealedPub = usePubStore((s) => s.revealedPub);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const reducedMotion = useReducedMotion();
  const hapticFiredRef = useRef(false);

  // Animation shared values
  const headlineScale = useSharedValue(reducedMotion ? 1 : 0.6);
  const contentOpacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (hapticEnabled && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      fireSuccessHaptic();
    }
  }, [hapticEnabled]);

  useEffect(() => {
    if (reducedMotion) {
      headlineScale.value = 1;
      contentOpacity.value = 1;
      return;
    }

    // Bounce in headline
    headlineScale.value = withSpring(1, { damping: 8, stiffness: 120 });

    // Fade in rest of content
    contentOpacity.value = withTiming(1, { duration: 250 });
  }, [contentOpacity, headlineScale, reducedMotion]);

  const headlineAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: headlineScale.value }],
  }));

  const contentAnimStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const pubName = revealedPub?.name ?? 'Hospoda';
  const layout = getCelebrationLayout(screenWidth, screenHeight, insets.top, insets.bottom);

  // Drop anchors: emerge from the bottom tip of each foam tongue.
  const dropAnchors = buildFoamTongues(screenWidth, layout.foamBottom).map((t) => ({
    x: t.centerX,
    y: t.bottomY - 4,
  }));

  return (
    <View style={styles.root}>
      {/* Background warm-glow — soft radial gradient behind the headline */}
      <View style={styles.glowLargeWrap} pointerEvents="none">
        <SoftGlow size={620} color={Colors.glow} opacity={0.18} />
      </View>
      <View style={styles.glowHeadlineWrap} pointerEvents="none">
        <SoftGlow size={340} color={Colors.amber} opacity={0.22} />
      </View>

      {/* Rising beer bubbles — ambient carbonation effect */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <BeerBubbles width={screenWidth} height={screenHeight} bubbleCount={32} />
      </View>

      {/* Foam cap at the very top — extends behind the status bar.
          The negative top + matching overhang lets the SVG draw above the
          visible screen edge, so the foam appears to bleed off the top of the
          device instead of being chopped flat. */}
      <View style={[styles.foamContainer, { top: -FOAM_OVERHANG }]} pointerEvents="none">
        <FoamDrip width={screenWidth} height={layout.foamHeight} overhang={FOAM_OVERHANG} />
      </View>

      {/* Drops periodically fall from the foam edge down the screen */}
      <View style={styles.foamContainer} pointerEvents="none">
        <FoamDrops
          width={screenWidth}
          fallDistance={screenHeight - 120}
          anchors={dropAnchors}
        />
      </View>

      {/* Main content, compacting in iPhone compatibility windows on iPad. */}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={[
          styles.content,
          {
            minHeight: screenHeight,
            justifyContent: layout.justifyContent,
            paddingTop: layout.paddingTop,
            paddingBottom: layout.paddingBottom,
          },
        ]}
      >
        {/* Beer mug icon */}
        <Animated.View style={[styles.emojiWrap, contentAnimStyle]}>
          <BeerIcon size={layout.iconSize} color={Colors.foam} />
        </Animated.View>

        {/* Headline — bounce-in animated */}
        <Animated.View style={[styles.headlineWrap, headlineAnimStyle]}>
          <Text
            style={[
              styles.headlineLine1,
              {
                fontSize: layout.headlineFontSize,
                lineHeight: layout.headlineLineHeight,
              },
            ]}
          >
            {cs.celebration.headlineLine1}
          </Text>
          <Text
            style={[
              styles.headlineLine2,
              {
                fontSize: layout.headlineFontSize,
                lineHeight: layout.headlineLineHeight,
              },
            ]}
          >
            {cs.celebration.headlineLine2}
          </Text>
        </Animated.View>

        {/* Subtitle */}
        <Animated.View style={contentAnimStyle}>
          <Text
            style={[
              styles.subtitle,
              {
                paddingTop: layout.subtitlePaddingTop,
                marginBottom: layout.subtitleMarginBottom,
              },
            ]}
          >
            {cs.celebration.subtitle}
          </Text>
        </Animated.View>

        {/* Pub card */}
        <Animated.View
          style={[
            styles.pubCard,
            contentAnimStyle,
            {
              width: layout.contentWidth,
              paddingHorizontal: layout.cardPaddingHorizontal,
              paddingVertical: layout.cardPaddingVertical,
            },
          ]}
        >
          <Text style={styles.pubCardEyebrow}>{cs.celebration.eyebrow}</Text>
          <Text
            style={[
              styles.pubCardName,
              {
                fontSize: layout.pubNameFontSize,
              },
            ]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            {pubName}
          </Text>

          {revealedPub != null && (
            <Pressable
              style={styles.mapsRow}
              onPress={() => openPubInMaps(revealedPub)}
              accessibilityRole="link"
              accessibilityLabel={cs.celebration.openInMaps}
            >
              <MapPinIcon size={14} color={Colors.neon} />
              <Text style={styles.mapsLabel}>{cs.celebration.openInMaps}</Text>
            </Pressable>
          )}
        </Animated.View>

        {/* Back to compass button */}
        <Animated.View style={[styles.buttonWrap, { width: layout.contentWidth }, contentAnimStyle]}>
          <GlowButton
            label={cs.celebration.backToCompass}
            onPress={() => router.back()}
            variant="primary"
            glow="strong"
            height={layout.buttonHeight}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    overflow: 'hidden',
  },

  // Warm glow — soft SVG radial gradients (no hard edges)
  glowLargeWrap: {
    position: 'absolute',
    top: -180,
    left: -160,
  },
  glowHeadlineWrap: {
    position: 'absolute',
    top: '28%',
    alignSelf: 'center',
  },

  foamContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },

  scroll: {
    flex: 1,
    zIndex: 20,
  },

  content: {
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 24,
  },

  emojiWrap: {
    marginBottom: 4,
  },

  headlineWrap: {
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: 0,
  },
  headlineLine1: {
    fontFamily: Fonts.display.extrabold,
    letterSpacing: -2,
    color: Colors.foam,
    textAlign: 'center',
  },
  headlineLine2: {
    fontFamily: Fonts.display.extrabold,
    letterSpacing: -2,
    color: Colors.amber,
    textAlign: 'center',
    textShadowColor: Colors.glow,
    textShadowRadius: 12,
    textShadowOffset: { width: 0, height: 0 },
  },

  subtitle: {
    fontFamily: Fonts.ui.medium,
    fontSize: 18,
    color: Colors.foamMuted,
    textAlign: 'center',
  },

  pubCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  pubCardEyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.8,
    color: Colors.mutedText,
    marginBottom: 4,
  },
  pubCardName: {
    fontFamily: Fonts.display.extrabold,
    letterSpacing: -1,
    color: Colors.amber,
  },
  mapsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 6,
  },
  mapsLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.neon,
  },

  buttonWrap: {},
});
