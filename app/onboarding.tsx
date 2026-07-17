/**
 * First-run onboarding (route `/onboarding`) — a one-time welcome pager shown
 * on a fresh install (OnboardingGate in app/_layout.tsx redirects here when
 * onboardingStore decides 'show').
 *
 * Five slides in a horizontally paged Animated.FlatList: welcome → compass →
 * beer diary → parta → account nudge. No permission prompts here on purpose:
 * the compass has its own location priming screen, and asking twice in a row
 * is worse than asking once in context. The account slide nudges toward
 * sign-in but never forces it (the product is local-first and an anonymous
 * account exists either way): the primary CTA finishes the onboarding and
 * pushes /auth over the tabs; "Zatím bez účtu" (and "Přeskočit" on earlier
 * slides) just lands on the tabs. A successful sign-in then flows into the
 * nickname wizard via ProfileGate.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type FlatList,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { GlowButton } from '@/components/shared/GlowButton';
import { BeerIcon, CompassIcon, UserIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { trackClientEvent } from '@/data/telemetryClient';

const GLYPH_SIZE = 136;
const GLYPH_ICON_SIZE = 56;

/** Hand-drawn tally group (four bars + the diagonal strike) — the counter's
 *  "čárky na tácku" brand motif, built from plain Views. */
function TallyGlyph() {
  return (
    <View style={styles.tally}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.tallyBar} />
      ))}
      <View style={styles.tallyStrike} />
    </View>
  );
}

interface Slide {
  key: string;
  title: string;
  body: string;
  glyph: React.ReactNode;
}

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    title: cs.onboarding.slide1Title,
    body: cs.onboarding.slide1Body,
    glyph: <BeerIcon size={GLYPH_ICON_SIZE} color={Colors.amber} />,
  },
  {
    key: 'compass',
    title: cs.onboarding.slide2Title,
    body: cs.onboarding.slide2Body,
    glyph: <CompassIcon size={GLYPH_ICON_SIZE} color={Colors.amber} />,
  },
  {
    key: 'diary',
    title: cs.onboarding.slide3Title,
    body: cs.onboarding.slide3Body,
    glyph: <TallyGlyph />,
  },
  {
    key: 'parta',
    title: cs.onboarding.slide4Title,
    body: cs.onboarding.slide4Body,
    glyph: <UsersIcon size={GLYPH_ICON_SIZE} color={Colors.amber} />,
  },
  {
    key: 'account',
    title: cs.onboarding.slide5Title,
    body: cs.onboarding.slide5Body,
    glyph: <UserIcon size={GLYPH_ICON_SIZE} color={Colors.amber} />,
  },
];

const LAST_INDEX = SLIDES.length - 1;

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const listRef = useRef<FlatList<Slide>>(null);
  // Animated driver + stable viewability callbacks live in state initializers
  // (not refs) so render never touches a ref (react-hooks/refs).
  const [scrollX] = useState(() => new Animated.Value(0));
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    void trackClientEvent({ event: 'onboarding_started' });
  }, []);

  const finish = useCallback(
    (event: 'onboarding_completed' | 'onboarding_skipped') => {
      // One-way, once: a double tap on a CTA must not navigate twice.
      if (finishedRef.current) return;
      finishedRef.current = true;
      useOnboardingStore.getState().complete();
      void trackClientEvent({ event, context: { slide: indexRef.current + 1 } });
      router.replace('/(tabs)' as Href);
    },
    [router],
  );

  const handleOpenAuth = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    useOnboardingStore.getState().complete();
    void trackClientEvent({ event: 'onboarding_completed', context: { slide: indexRef.current + 1 } });
    void trackClientEvent({ event: 'onboarding_auth_opened' });
    // Land on the tabs first so closing the auth modal has a place to go back
    // to; a successful sign-in continues into ProfileGate's nickname wizard.
    router.replace('/(tabs)' as Href);
    router.push('/auth' as Href);
  }, [router]);

  const handleNext = useCallback(() => {
    if (indexRef.current >= LAST_INDEX) {
      finish('onboarding_completed');
      return;
    }
    listRef.current?.scrollToIndex({ index: indexRef.current + 1, animated: true });
  }, [finish]);

  // Track the focused page for dots + the CTA swap on the last slide.
  const [viewabilityConfig] = useState(() => ({ itemVisiblePercentThreshold: 60 }));
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const first = viewableItems[0];
        if (first?.index != null) {
          indexRef.current = first.index;
          setIndex(first.index);
        }
      },
  );

  const renderSlide = useCallback(
    ({ item, index: slideIndex }: ListRenderItemInfo<Slide>) => {
      // Subtle focus animation: the settling slide's glyph scales up and fades
      // in as it reaches the center (native-driver interpolation).
      const inputRange = [(slideIndex - 1) * width, slideIndex * width, (slideIndex + 1) * width];
      const scale = scrollX.interpolate({
        inputRange,
        outputRange: [0.72, 1, 0.72],
        extrapolate: 'clamp',
      });
      const opacity = scrollX.interpolate({
        inputRange,
        outputRange: [0.25, 1, 0.25],
        extrapolate: 'clamp',
      });

      return (
        <View style={[styles.slide, { width }]}>
          <View style={styles.glyphArea}>
            <Animated.View style={[styles.glyphBadge, { transform: [{ scale }], opacity }]}>
              {item.glyph}
            </Animated.View>
          </View>
          <Animated.View style={{ opacity }}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {item.title}
            </Text>
            <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
              {item.body}
            </Text>
          </Animated.View>
        </View>
      );
    },
    [scrollX, width],
  );

  const isLast = index === LAST_INDEX;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Spacing.lg) },
      ]}
    >
      {/* Skip — top right, gone on the last slide (its CTA is the exit). */}
      <View style={styles.skipRow}>
        {!isLast && (
          <Pressable
            onPress={() => finish('onboarding_skipped')}
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.onboarding.skip}
            hitSlop={8}
          >
            <Text style={styles.skipText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.onboarding.skip}
            </Text>
          </Pressable>
        )}
      </View>

      <Animated.FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />

      {/* Progress dots — same bar style as the profile setup wizard. */}
      <View style={styles.dots}>
        {SLIDES.map((slide, i) => (
          <View
            key={slide.key}
            style={[styles.dot, i === index && styles.dotActive, i < index && styles.dotDone]}
          />
        ))}
      </View>

      <View style={styles.ctaBlock}>
        {isLast ? (
          <>
            <GlowButton
              label={cs.onboarding.slide5Cta}
              onPress={handleOpenAuth}
              glow="strong"
              accessibilityLabel={cs.onboarding.slide5Cta}
            />
            <Pressable
              onPress={() => finish('onboarding_completed')}
              style={({ pressed }) => [styles.laterButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.onboarding.slide5Later}
            >
              <Text style={styles.laterText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.onboarding.slide5Later}
              </Text>
            </Pressable>
          </>
        ) : (
          <GlowButton
            label={cs.onboarding.next}
            onPress={handleNext}
            glow="soft"
            accessibilityLabel={cs.onboarding.next}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },

  // ── Skip ──
  skipRow: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.lg,
  },
  skipButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  skipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },

  // ── Slide ──
  slide: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.xl,
  },
  glyphArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphBadge: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...amberGlow(28),
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    lineHeight: 37,
    color: Colors.foam,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15.5,
    lineHeight: 23,
    color: Colors.foamMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },

  // ── Tally glyph (slide 3) ──
  tally: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tallyBar: {
    width: 5,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  tallyStrike: {
    position: 'absolute',
    width: 74,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amberLight,
    transform: [{ rotate: '-24deg' }],
  },

  // ── Dots ──
  dots: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  dot: {
    width: 28,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  dotActive: {
    backgroundColor: Colors.amber,
  },
  dotDone: {
    backgroundColor: withAlpha(Colors.amber, 0.5),
  },

  // ── CTAs ──
  ctaBlock: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  laterButton: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },
  pressed: {
    opacity: 0.7,
  },
});
