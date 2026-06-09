/**
 * Screen 05 — Settings (Nastavení)
 * Presented as a bottom-sheet modal from the compass screen.
 *
 * Sections:
 *  1. Header row  (back button + centered title)
 *  2. Distance card  (custom discrete slider)
 *  3. Preferences card  (haptics + sound toggles)
 *  4. About card  (about + privacy rows)
 *  5. Footer  (attribution)
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  LayoutChangeEvent,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import { getAppVersionLabel } from '@/utils/appVersion';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RadiusIcon,
  BellRingIcon,
  Volume2Icon,
  BeerOffIcon,
  InfoIcon,
  ShieldIcon,
  HeartIcon,
} from '@/components/shared/IconGlyph';
import { InstagramIcon, LinkedinIcon } from '@/components/shared/BrandIcon';

// ---------------------------------------------------------------------------
// Discrete slider positions
// ---------------------------------------------------------------------------

// Ordered low → high reach. `null` ("Bez limitu") sits at the far RIGHT so the
// thumb travels left→right as the search radius grows, and the fill bar is full
// at unlimited — matching the user's mental model of "maximum reach".
const SLIDER_POSITIONS: Array<number | null> = [0.5, 1, 1.5, 2, 2.5, 5, 10, null];
const SLIDER_STEPS = SLIDER_POSITIONS.length - 1; // 7

function positionIndexForKm(km: number | null): number {
  if (km === null) return SLIDER_POSITIONS.length - 1;
  const idx = SLIDER_POSITIONS.indexOf(km);
  return idx === -1 ? SLIDER_POSITIONS.length - 1 : idx;
}

function formatCzKm(km: number): string {
  // Format number Czech-style: decimal point → comma, strip trailing ,0
  let s = km.toString().replace('.', ',');
  if (s.endsWith(',0')) s = s.slice(0, -2);
  return s;
}

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

interface ToggleProps {
  value: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
}

function Toggle({ value, onToggle, accessibilityLabel }: ToggleProps) {
  const offset = useSharedValue(value ? 24 : 2);

  const handlePress = useCallback(() => {
    onToggle();
    offset.value = withSpring(value ? 2 : 24, {
      mass: 0.6,
      damping: 14,
      stiffness: 200,
    });
  }, [value, onToggle, offset]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Animated.View style={[styles.toggleThumb, softDrop(), thumbStyle]} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Distance slider
// ---------------------------------------------------------------------------

interface SliderProps {
  positionIndex: number;
  onSnap: (index: number) => void;
}

function DistanceSlider({ positionIndex, onSnap }: SliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const snapIndex = useSharedValue(positionIndex);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const commitSnap = useCallback(
    (index: number) => {
      onSnap(index);
    },
    [onSnap],
  );

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (trackWidth === 0) return;
      const rawFraction = e.x / trackWidth;
      const clamped = Math.max(0, Math.min(1, rawFraction));
      const snapped = Math.round(clamped * SLIDER_STEPS);
      if (snapped !== snapIndex.value) {
        snapIndex.value = snapped;
        runOnJS(commitSnap)(snapped);
      }
    })
    .onEnd((e) => {
      if (trackWidth === 0) return;
      const rawFraction = e.x / trackWidth;
      const clamped = Math.max(0, Math.min(1, rawFraction));
      const snapped = Math.round(clamped * SLIDER_STEPS);
      snapIndex.value = snapped;
      runOnJS(commitSnap)(snapped);
    });

  const fillStyle = useAnimatedStyle(() => {
    const frac = SLIDER_STEPS > 0 ? snapIndex.value / SLIDER_STEPS : 0;
    return { width: `${frac * 100}%` };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const frac = SLIDER_STEPS > 0 ? snapIndex.value / SLIDER_STEPS : 0;
    const x = frac * trackWidth - 14; // 14 = half of 28px thumb
    return { transform: [{ translateX: x }] };
  });

  // Keep shared value in sync when parent updates
  React.useEffect(() => {
    snapIndex.value = positionIndex;
  }, [positionIndex, snapIndex]);

  return (
    <View style={styles.sliderWrapper}>
      <GestureDetector gesture={pan}>
        <View style={styles.trackOuter} onLayout={onTrackLayout}>
          {/* Fill bar */}
          <Animated.View style={[styles.trackFill, fillStyle]} />
          {/* Thumb — absolutely positioned */}
          <Animated.View
            style={[styles.thumb, amberGlow(14), thumbStyle]}
          />
        </View>
      </GestureDetector>

      {/* Range labels */}
      <View style={styles.rangeLabels}>
        <Text style={styles.rangeLabel}>{cs.settings.distance.rangeMin}</Text>
        <Text style={styles.rangeLabel}>{cs.settings.distance.rangeMax}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Preference row
// ---------------------------------------------------------------------------

interface PrefRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  toggleLabel: string;
  borderTop?: boolean;
}

function PrefRow({ icon, title, subtitle, value, onToggle, toggleLabel, borderTop }: PrefRowProps) {
  return (
    <View style={[styles.prefRow, borderTop && styles.prefRowBorderTop]}>
      {/* Icon well */}
      <View style={styles.iconWell}>{icon}</View>

      {/* Text stack */}
      <View style={styles.prefText}>
        <Text style={styles.prefTitle}>{title}</Text>
        <Text style={styles.prefSubtitle}>{subtitle}</Text>
      </View>

      {/* Toggle */}
      <Toggle value={value} onToggle={onToggle} accessibilityLabel={toggleLabel} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// About / nav row
// ---------------------------------------------------------------------------

interface AboutRowProps {
  icon: React.ReactNode;
  title: string;
  rightLabel?: string;
  onPress: () => void;
  borderTop?: boolean;
}

function AboutRow({ icon, title, rightLabel, onPress, borderTop }: AboutRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.aboutRow,
        borderTop && styles.prefRowBorderTop,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
    >
      <View style={styles.iconWell}>{icon}</View>
      <Text style={styles.aboutTitle}>{title}</Text>
      <View style={styles.aboutRight}>
        {rightLabel != null && (
          <Text style={styles.aboutVersion}>{rightLabel}</Text>
        )}
        <ChevronRightIcon size={16} color={Colors.mutedText} />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Social button (creator links)
// ---------------------------------------------------------------------------

interface SocialButtonProps {
  icon: React.ReactNode;
  label: string;
  url: string;
}

function SocialButton({ icon, label, url }: SocialButtonProps) {
  const handlePress = useCallback(() => {
    void Linking.openURL(url);
  }, [url]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.socialButton, pressed && styles.rowPressed]}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={4}
    >
      {icon}
      <Text style={styles.socialButtonLabel}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const maxDistanceKm = useSettingsStore((s) => s.maxDistanceKm);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const hideClosedPubs = useSettingsStore((s) => s.hideClosedPubs);
  const setMaxDistanceKm = useSettingsStore((s) => s.setMaxDistanceKm);
  const setHapticEnabled = useSettingsStore((s) => s.setHapticEnabled);
  const setSoundEnabled = useSettingsStore((s) => s.setSoundEnabled);
  const setHideClosedPubs = useSettingsStore((s) => s.setHideClosedPubs);

  const sliderIndex = positionIndexForKm(maxDistanceKm);
  const appVersionLabel = getAppVersionLabel();

  const handleSliderSnap = useCallback(
    (index: number) => {
      setMaxDistanceKm(SLIDER_POSITIONS[index] ?? null);
    },
    [setMaxDistanceKm],
  );

  const toggleHaptic = useCallback(() => {
    setHapticEnabled(!hapticEnabled);
  }, [hapticEnabled, setHapticEnabled]);

  const toggleSound = useCallback(() => {
    setSoundEnabled(!soundEnabled);
  }, [soundEnabled, setSoundEnabled]);

  const toggleHideClosed = useCallback(() => {
    setHideClosedPubs(!hideClosedPubs);
  }, [hideClosedPubs, setHideClosedPubs]);

  // Distance display
  const distanceDisplay =
    maxDistanceKm === null ? (
      <Text style={styles.distanceUnlimited}>{cs.settings.distance.unlimited}</Text>
    ) : (
      <View style={styles.distanceValueRow}>
        <Text style={styles.distanceNumber}>{formatCzKm(maxDistanceKm)}</Text>
        <Text style={styles.distanceUnit}>{cs.settings.distance.kmShort}</Text>
      </View>
    );

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>

        <Text style={styles.headerTitle}>{cs.settings.title}</Text>

        {/* Invisible spacer keeps title centered */}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Distance card ── */}
        <View style={styles.card}>
          {/* Section header */}
          <View style={styles.cardSectionHeader}>
            <RadiusIcon size={14} color={Colors.amber} />
            <Text style={styles.cardSectionHeaderText}>
              {cs.settings.distance.header}
            </Text>
          </View>

          {/* Big distance display */}
          <View style={styles.distanceDisplay}>{distanceDisplay}</View>

          {/* Custom slider */}
          <DistanceSlider
            positionIndex={sliderIndex}
            onSnap={handleSliderSnap}
          />

          {/* Helper text */}
          <Text style={styles.distanceHelper}>{cs.settings.distance.helper}</Text>
        </View>

        {/* ── Preferences card ── */}
        <View style={[styles.card, styles.cardNoPaddingV]}>
          <PrefRow
            icon={<BellRingIcon size={18} color={Colors.foamMuted} />}
            title={cs.settings.haptics.title}
            subtitle={cs.settings.haptics.subtitle}
            value={hapticEnabled}
            onToggle={toggleHaptic}
            toggleLabel={`${cs.settings.haptics.title}: ${hapticEnabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
          />
          <PrefRow
            icon={<Volume2Icon size={18} color={Colors.foamMuted} />}
            title={cs.settings.sound.title}
            subtitle={cs.settings.sound.subtitle}
            value={soundEnabled}
            onToggle={toggleSound}
            toggleLabel={`${cs.settings.sound.title}: ${soundEnabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
            borderTop
          />
          <PrefRow
            icon={<BeerOffIcon size={18} color={Colors.foamMuted} />}
            title={cs.settings.hideClosed.title}
            subtitle={cs.settings.hideClosed.subtitle}
            value={hideClosedPubs}
            onToggle={toggleHideClosed}
            toggleLabel={`${cs.settings.hideClosed.title}: ${hideClosedPubs ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
            borderTop
          />
        </View>

        {/* ── About card ── */}
        <View style={[styles.card, styles.cardNoPaddingV]}>
          <AboutRow
            icon={<InfoIcon size={18} color={Colors.foamMuted} />}
            title={cs.settings.about.title}
            rightLabel={appVersionLabel || undefined}
            onPress={() => {
              // TODO: navigate to about screen when built
            }}
          />
          <AboutRow
            icon={<ShieldIcon size={18} color={Colors.foamMuted} />}
            title={cs.settings.privacy}
            onPress={() => router.push('/privacy')}
            borderTop
          />
        </View>

        {/* ── Creator card ── */}
        <View style={styles.card}>
          <View style={styles.creatorHeaderRow}>
            <Text style={styles.creatorName}>{cs.settings.creator.name}</Text>
            <View style={styles.creatorLabel}>
              <HeartIcon size={14} color={Colors.amber} />
              <Text style={styles.cardSectionHeaderText}>
                {cs.settings.creator.header}
              </Text>
            </View>
          </View>

          <View style={styles.socialRow}>
            <SocialButton
              icon={<InstagramIcon size={18} color={Colors.foam} />}
              label={cs.settings.creator.instagram}
              url={cs.settings.creator.instagramUrl}
            />
            <SocialButton
              icon={<LinkedinIcon size={18} color={Colors.foam} />}
              label={cs.settings.creator.linkedin}
              url={cs.settings.creator.linkedinUrl}
            />
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{cs.settings.footer}</Text>
          <Text style={styles.attributionText}>{cs.settings.attribution}</Text>
        </View>

        {/* Extra bottom breathing room */}
        <View style={{ height: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TRACK_HEIGHT = 14;
const THUMB_SIZE = 28;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.stout,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },

  // ── ScrollView ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  // ── Cards ──
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    paddingBottom: 18,
  },
  cardNoPaddingV: {
    padding: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    paddingVertical: 6,
    overflow: 'hidden',
  },

  // ── Distance card internals ──
  cardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
  },
  cardSectionHeaderText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  distanceDisplay: {
    alignItems: 'center',
    marginTop: 0,
    marginBottom: 20,
  },
  distanceUnlimited: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 44,
    color: Colors.foam,
    lineHeight: 56,
  },
  distanceValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  distanceNumber: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 56,
    color: Colors.foam,
    lineHeight: 70,
  },
  distanceUnit: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.amber,
  },

  // ── Slider ──
  sliderWrapper: {
    gap: 8,
  },
  trackOuter: {
    height: TRACK_HEIGHT,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'visible',
    position: 'relative',
    justifyContent: 'center',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  thumb: {
    position: 'absolute',
    top: -(THUMB_SIZE / 2 - TRACK_HEIGHT / 2),
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foam,
    borderWidth: 3,
    borderColor: Colors.amber,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rangeLabel: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
  },
  distanceHelper: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    lineHeight: 17,
    marginTop: 8,
  },

  // ── Preference rows ──
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 58,
    gap: 12,
  },
  prefRowBorderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefText: {
    flex: 1,
  },
  prefTitle: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    marginBottom: 2,
  },
  prefSubtitle: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
  },

  // ── Toggle ──
  toggle: {
    width: 52,
    height: 30,
    borderRadius: Radius.pill,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: Colors.amber,
  },
  toggleOff: {
    backgroundColor: Colors.stout3,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foam,
  },

  // ── About rows ──
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 56,
    gap: 12,
  },
  aboutTitle: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  aboutRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aboutVersion: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
  },
  rowPressed: {
    opacity: 0.65,
  },

  // ── Creator card ──
  creatorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  creatorName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  creatorLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 10,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  socialButtonLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },

  // ── Footer ──
  footer: {
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
  },
  footerText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  attributionText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 10,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
