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
import { Confetti } from '@/components/celebration/Confetti';
import { ConfettiStatic } from '@/components/celebration/ConfettiStatic';
import { FoamDrip } from '@/components/celebration/FoamDrip';
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

  return (
    <View style={styles.root}>
      {/* Background warm-glow blobs */}
      <View style={styles.glowBlobLarge} pointerEvents="none" />
      <View style={styles.glowBlobSmall} pointerEvents="none" />

      {/* Static scattered confetti — persistent decoration */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <ConfettiStatic width={SCREEN_W} height={SCREEN_H} pieceCount={24} />
      </View>

      {/* Falling confetti — animated celebration */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Confetti width={SCREEN_W} height={SCREEN_H} pieceCount={18} />
      </View>

      {/* FoamDrip at the very top */}
      <View style={styles.foamContainer} pointerEvents="none">
        <FoamDrip width={SCREEN_W} height={110} />
      </View>

      {/* Main scrollable content, centered vertically with foam offset */}
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + 80,
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

  // Warm glow background blobs (simulated radial gradients via transparent circles)
  glowBlobLarge: {
    position: 'absolute',
    width: 590,
    height: 540,
    top: -160,
    left: -140,
    borderRadius: 295,
    backgroundColor: Colors.glow,
    opacity: 0.07,
  },
  glowBlobSmall: {
    position: 'absolute',
    width: 240,
    height: 240,
    top: SCREEN_H * 0.3,
    left: (SCREEN_W - 240) / 2,
    borderRadius: 120,
    backgroundColor: Colors.amber,
    opacity: 0.045,
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
