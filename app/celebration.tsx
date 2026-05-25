import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
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
import * as Haptics from 'expo-haptics';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { cs } from '@/i18n/cs';
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function CelebrationScreen() {
  const insets = useSafeAreaInsets();
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
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

  // Drop anchors: emerge from the bottom tip of each foam tongue.
  const FOAM_BOTTOM = 108;
  const dropAnchors = buildFoamTongues(SCREEN_W, FOAM_BOTTOM).map((t) => ({
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
        <BeerBubbles width={SCREEN_W} height={SCREEN_H} bubbleCount={32} />
      </View>

      {/* Foam cap at the very top — extends behind the status bar */}
      <View style={styles.foamContainer} pointerEvents="none">
        <FoamDrip width={SCREEN_W} height={150} />
      </View>

      {/* Drops periodically fall from the foam edge down the screen */}
      <View style={styles.foamContainer} pointerEvents="none">
        <FoamDrops
          width={SCREEN_W}
          fallDistance={SCREEN_H - 120}
          anchors={dropAnchors}
        />
      </View>

      {/* Main scrollable content, centered vertically with foam offset */}
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + 130,
            paddingBottom: insets.bottom + 24,
          },
        ]}
      >
        {/* Beer mug icon */}
        <Animated.View style={[styles.emojiWrap, contentAnimStyle]}>
          <BeerIcon size={96} color={Colors.foam} />
        </Animated.View>

        {/* Headline — bounce-in animated */}
        <Animated.View style={[styles.headlineWrap, headlineAnimStyle]}>
          <Text style={styles.headlineLine1}>{cs.celebration.headlineLine1}</Text>
          <Text style={styles.headlineLine2}>{cs.celebration.headlineLine2}</Text>
        </Animated.View>

        {/* Subtitle */}
        <Animated.View style={contentAnimStyle}>
          <Text style={styles.subtitle}>{cs.celebration.subtitle}</Text>
        </Animated.View>

        {/* Pub card */}
        <Animated.View style={[styles.pubCard, contentAnimStyle]}>
          <Text style={styles.pubCardEyebrow}>{cs.celebration.eyebrow}</Text>
          <Text style={styles.pubCardName}>{pubName}</Text>

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
        <Animated.View style={[styles.buttonWrap, contentAnimStyle]}>
          <GlowButton
            label={cs.celebration.backToCompass}
            onPress={() => router.back()}
            variant="primary"
            glow="strong"
            height={64}
          />
        </Animated.View>
      </View>
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
    top: SCREEN_H * 0.28,
    left: (SCREEN_W - 340) / 2,
  },

  foamContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
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
    fontSize: 84,
    lineHeight: 110,
    letterSpacing: -2,
    color: Colors.foam,
    textAlign: 'center',
  },
  headlineLine2: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 84,
    lineHeight: 110,
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
    paddingTop: 14,
    marginBottom: 24,
  },

  pubCard: {
    width: 342,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 18,
    paddingHorizontal: 22,
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
    fontSize: 30,
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

  buttonWrap: {
    width: 342,
  },
});
