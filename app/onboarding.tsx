/**
 * One-time onboarding (route `/onboarding`) — a welcome pager shown on a fresh
 * install or once to an existing signed-out install (OnboardingGate in
 * app/_layout.tsx redirects here when onboardingStore decides 'show').
 *
 * Three slides in a horizontally paged FlatList: welcome + compass → beer
 * diary + parta → account nudge.
 *
 * Each slide is an illustration, one line, and THREE concrete things the app
 * does — drawn with the app's own glyphs and medallions, so the first screen a
 * person sees already looks like the product rather than a generic welcome
 * pager. It used to be a paragraph per slide: well written, and skipped. Three
 * short lines get read standing up with a thumb on "další"; a block does not. No permission prompts here on purpose:
 * the compass has its own location priming screen, and asking twice in a row
 * is worse than asking once in context. The account slide nudges toward
 * sign-in but never forces it (the product is local-first and an anonymous
 * account exists either way): the primary CTA finishes the onboarding and
 * pushes /auth over the tabs; "Zatím bez účtu" (and "Přeskočit" on earlier
 * slides) just lands on the tabs. A new registration then gets one concise
 * public/private profile choice before entering the app.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BeerIcon,
  CameraIcon,
  ChartColumnIcon,
  CompassIcon,
  DicesIcon,
  RefreshCwIcon,
  ShieldIcon,
  TrophyIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { CounterCta } from '@/counter/CounterCta';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { trackClientEvent } from '@/data/telemetryClient';
import { trackUiInteraction } from '@/data/uxTelemetry';

interface Slide {
  key: string;
  title: string;
  body: string;
  /** What the app actually does. Three, always — a fourth stops being scanned. */
  bullets: readonly string[];
  icons: readonly React.ComponentType<{ size?: number; color: string }>[];
  /** Full-bleed illustration on the stout background (generated brand art —
   *  the PNG background matches Colors.stout exactly, so it blends edge-free). */
  image: number;
}

const SLIDES: Slide[] = [
  {
    key: 'compass',
    title: cs.onboarding.slide1Title,
    body: cs.onboarding.slide1Body,
    bullets: cs.onboarding.slide1Bullets,
    icons: [BeerIcon, CompassIcon, ChartColumnIcon],
    image: require('../assets/images/onboarding/slide-compass.png'),
  },
  {
    key: 'diary',
    title: cs.onboarding.slide2Title,
    body: cs.onboarding.slide2Body,
    bullets: cs.onboarding.slide2Bullets,
    icons: [UsersIcon, DicesIcon, CameraIcon],
    image: require('../assets/images/onboarding/slide-diary.png'),
  },
  {
    key: 'account',
    title: cs.onboarding.slide3Title,
    body: cs.onboarding.slide3Body,
    bullets: cs.onboarding.slide3Bullets,
    icons: [RefreshCwIcon, TrophyIcon, ShieldIcon],
    image: require('../assets/images/onboarding/slide-account.png'),
  },
];

const LAST_INDEX = SLIDES.length - 1;

function OnboardingSlide({ item, width }: { item: Slide; width: number }) {
  const [artHeight, setArtHeight] = useState(0);
  // Smaller than it was: the art is the mood, the three lines under it are the
  // reason to keep the app, and the art used to take half the screen.
  const illustrationSide =
    artHeight > 0 ? Math.max(120, Math.min(210, Math.min(width * 0.5, artHeight - 16))) : 180;

  const handleArtLayout = useCallback((event: LayoutChangeEvent) => {
    setArtHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <View style={[styles.slide, { width }]}>
      <View style={styles.illustrationArea} onLayout={handleArtLayout}>
        <Image
          source={item.image}
          style={{ width: illustrationSide, height: illustrationSide }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        {item.title}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {item.key === 'account' && Platform.OS === 'android'
          ? cs.onboarding.slide3BodyAndroid
          : item.body}
      </Text>

      <View style={styles.bullets}>
        {(item.key === 'account' && Platform.OS === 'android'
          ? cs.onboarding.slide3BulletsAndroid
          : item.bullets
        ).map((line, index) => {
          const Icon = item.icons[index] ?? BeerIcon;
          return (
            <View key={line} style={styles.bullet}>
              {/* The same 12 % amber medallion the app uses for an icon in a
                  row (§2.2), so this reads as the product and not as a
                  marketing page bolted on the front. */}
              <View style={styles.bulletIcon}>
                <Icon size={17} color={Colors.amber} />
              </View>
              <Text style={styles.bulletText} maxFontSizeMultiplier={FontScaleCap.body}>
                {line}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const listRef = useRef<FlatList<Slide>>(null);
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
    trackUiInteraction('onboarding_auth_open');
    finishedRef.current = true;
    useOnboardingStore.getState().complete();
    void trackClientEvent({ event: 'onboarding_completed', context: { slide: indexRef.current + 1 } });
    void trackClientEvent({ event: 'onboarding_auth_opened' });
    // Land on the tabs first so closing the auth modal has a place to go back
    // to; a new registration replaces auth with the privacy choice.
    router.replace('/(tabs)' as Href);
    router.push('/auth' as Href);
  }, [router]);

  const handleNext = useCallback(() => {
    trackUiInteraction('onboarding_next');
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
    ({ item }: ListRenderItemInfo<Slide>) => <OnboardingSlide item={item} width={width} />,
    [width],
  );

  const isLast = index === LAST_INDEX;

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + Spacing.sm,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <View
          style={styles.dots}
          accessibilityRole="text"
          accessibilityLabel={cs.a11y.onboardingStep(index + 1, SLIDES.length)}
        >
          {SLIDES.map((slide, i) => (
            <View
              key={slide.key}
              style={[styles.dot, i === index && styles.dotActive, i < index && styles.dotDone]}
            />
          ))}
        </View>
      </View>

      <FlatList
        ref={listRef}
        style={styles.pager}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />

      <View style={styles.ctaWrap}>
        <CounterCta
          label={isLast ? cs.onboarding.slide3Cta : cs.onboarding.next}
          onPress={isLast ? handleOpenAuth : handleNext}
          accessibilityLabel={isLast ? cs.onboarding.slide3Cta : cs.onboarding.next}
        />
      </View>

      <View style={styles.secondaryCtaSlot} testID="onboarding-secondary-cta-slot">
        <Pressable
          onPress={() => {
            trackUiInteraction('onboarding_skip');
            finish(isLast ? 'onboarding_completed' : 'onboarding_skipped');
          }}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={isLast ? cs.onboarding.slide3Later : cs.onboarding.skip}
          hitSlop={8}
        >
          <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
            {isLast ? cs.onboarding.slide3Later : cs.onboarding.skip}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    gap: 12,
  },

  // ── Header ──
  header: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: Spacing.sm,
  },
  headerSpacer: { flex: 1 },

  // ── Slide ──
  pager: { flex: 1 },
  slide: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  illustrationArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '800',
    fontSize: 28,
    lineHeight: 36,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  body: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
    includeFontPadding: false,
  },
  // Left-aligned on purpose, under a centred title: a list you scan needs its
  // words to start in the same place, and centred bullets are decoration.
  bullets: { alignSelf: 'stretch', marginTop: Spacing.xl, gap: Spacing.md },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  bulletIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  bulletText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
    color: Colors.foam,
  },

  // ── Dots ──
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 20,
    height: 4,
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
  ctaWrap: { paddingHorizontal: 24 },
  secondaryCtaSlot: {
    height: 48,
    paddingHorizontal: 24,
  },
  secondaryButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.7,
  },
});
