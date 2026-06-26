/**
 * First-run/update explainer for pub reminders.
 *
 * This is deliberately a pre-permission screen: it explains why Na pivo needs
 * notifications + background location, then the native prompts only appear after
 * the user taps the primary CTA. The screen is shown once per app version while
 * the feature is off, so updates can reintroduce the capability without nagging
 * during normal launches.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BellRingIcon, ChevronLeftIcon, MapPinIcon, ShieldIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import {
  enablePubReminderNotifications,
} from '@/notifications/pubReminderNotifications';
import {
  getSeenPubReminderOnboardingVersion,
  markPubReminderOnboardingSeen,
  shouldShowPubReminderOnboarding,
} from '@/notifications/pubReminderOnboarding';
import { getCurrentAppVersion } from '@/data/releaseNotesClient';
import { useReleaseStore } from '@/stores/releaseStore';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';

function PourVisual() {
  const float = useSharedValue(0);
  const bell = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(withTiming(1, { duration: 2400 }), -1, true);
    bell.value = withDelay(450, withRepeat(withTiming(1, { duration: 1600 }), -1, true));
  }, [bell, float]);

  const foamAnim = useAnimatedStyle(() => ({
    opacity: 0.38 + float.value * 0.28,
    transform: [{ translateY: -3 + float.value * 6 }],
  }));

  const bellAnim = useAnimatedStyle(() => ({
    transform: [
      { translateY: -2 + bell.value * 4 },
      { rotate: `${-5 + bell.value * 10}deg` },
    ],
  }));

  return (
    <View style={styles.visual} accessibilityElementsHidden>
      <View style={styles.visualRail} />
      <View style={styles.pint}>
        <Animated.View style={[styles.foamCap, foamAnim]} />
        <View style={styles.beerFill} />
        <View style={styles.pintShine} />
      </View>
      <Animated.View style={[styles.bellBubble, bellAnim]}>
        <BellRingIcon size={26} color={Colors.stout} />
      </Animated.View>
      <View style={styles.locationBubble}>
        <MapPinIcon size={22} color={Colors.amberLight} />
      </View>
    </View>
  );
}

interface ReasonRowProps {
  icon: React.ReactNode;
  title: string;
  body: string;
}

function ReasonRow({ icon, title, body }: ReasonRowProps) {
  return (
    <View style={styles.reasonRow}>
      <View style={styles.reasonIcon}>{icon}</View>
      <View style={styles.reasonText}>
        <Text style={styles.reasonTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        <Text style={styles.reasonBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {body}
        </Text>
      </View>
    </View>
  );
}

export function PubReminderOnboardingModal() {
  const insets = useSafeAreaInsets();
  const releaseHasChecked = useReleaseStore((s) => s.hasChecked);
  const releaseNote = useReleaseStore((s) => s.pendingNote);
  const pubReminderEnabled = useSettingsStore((s) => s.pubReminderEnabled);
  const setPubReminderEnabled = useSettingsStore((s) => s.setPubReminderEnabled);
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'intro' | 'permissions'>('intro');
  const [version, setVersion] = useState<string | null>(null);
  const visible = eligible && !pubReminderEnabled;

  const progress = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;

    async function checkVisibility() {
      if (!releaseHasChecked || releaseNote) return;

      await waitForSettingsHydration();
      const currentVersion = getCurrentAppVersion();
      const seenVersion = await getSeenPubReminderOnboardingVersion();
      const enabled = useSettingsStore.getState().pubReminderEnabled;

      if (cancelled) return;
      const shouldShow = shouldShowPubReminderOnboarding({
        currentVersion,
        seenVersion,
        pubReminderEnabled: enabled,
      });
      setVersion(currentVersion);
      if (shouldShow) setStep('intro');
      setEligible(shouldShow);
    }

    void checkVisibility();
    return () => {
      cancelled = true;
    };
  }, [releaseHasChecked, releaseNote]);

  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = withSpring(1, { damping: 16, stiffness: 145, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: 140 });
    }
  }, [progress, visible]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.94 + progress.value * 0.06 },
      { translateY: (1 - progress.value) * 18 },
    ],
  }));

  const closeAsSeen = useCallback(async () => {
    await markPubReminderOnboardingSeen(version);
    setEligible(false);
    setStep('intro');
  }, [version]);

  const handleEnable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await enablePubReminderNotifications();
      await markPubReminderOnboardingSeen(version);
      if (result.ok) {
        setPubReminderEnabled(true);
        setEligible(false);
        setStep('intro');
        return;
      }
      setPubReminderEnabled(false);
      setEligible(false);
      setStep('intro');
      Alert.alert(cs.settings.pubReminders.deniedTitle, cs.settings.pubReminders.deniedBody);
    } finally {
      setBusy(false);
    }
  }, [busy, setPubReminderEnabled, version]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => void closeAsSeen()}
    >
      <View style={[styles.backdrop, { paddingTop: insets.top + Spacing.lg }]}>
        <Animated.View style={[styles.sheet, softDrop(), cardAnim]}>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {step === 'intro' ? (
              <>
                <View style={styles.heroBand}>
                  <View style={styles.eyebrowPill}>
                    <BellRingIcon size={14} color={Colors.amberLight} />
                    <Text style={styles.eyebrow}>{cs.pubReminderOnboarding.eyebrow}</Text>
                  </View>
                  <PourVisual />
                </View>

                <View style={styles.copy}>
                  <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.pubReminderOnboarding.title}
                  </Text>
                  <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.pubReminderOnboarding.body}
                  </Text>
                </View>

                <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
                  <GlowButton
                    label={cs.pubReminderOnboarding.introCta}
                    onPress={() => setStep('permissions')}
                    glow="none"
                    height={58}
                    accessibilityLabel={cs.pubReminderOnboarding.introCta}
                  />
                  <Pressable
                    onPress={() => void closeAsSeen()}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.pubReminderOnboarding.skip}
                  >
                    <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.pubReminderOnboarding.skip}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.detailHeader}>
                  <Pressable
                    onPress={() => setStep('intro')}
                    style={({ pressed }) => [styles.backButton, pressed && styles.secondaryPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.pubReminderOnboarding.back}
                    hitSlop={6}
                  >
                    <ChevronLeftIcon size={18} color={Colors.foam} />
                  </Pressable>
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                      {cs.pubReminderOnboarding.detailsTitle}
                    </Text>
                    <Text style={styles.detailBody} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.pubReminderOnboarding.detailsBody}
                    </Text>
                  </View>
                </View>

                <View style={styles.reasons}>
                  <ReasonRow
                    icon={<BellRingIcon size={20} color={Colors.amberLight} />}
                    title={cs.pubReminderOnboarding.notificationTitle}
                    body={cs.pubReminderOnboarding.notificationBody}
                  />
                  <ReasonRow
                    icon={<MapPinIcon size={20} color={Colors.amberLight} />}
                    title={cs.pubReminderOnboarding.locationTitle}
                    body={cs.pubReminderOnboarding.locationBody}
                  />
                  <ReasonRow
                    icon={<ShieldIcon size={20} color={Colors.amberLight} />}
                    title={cs.pubReminderOnboarding.privacyTitle}
                    body={cs.pubReminderOnboarding.privacyBody}
                  />
                </View>

                <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
                  <GlowButton
                    label={busy ? cs.pubReminderOnboarding.ctaBusy : cs.pubReminderOnboarding.cta}
                    onPress={() => void handleEnable()}
                    glow="none"
                    height={58}
                    accessibilityLabel={cs.pubReminderOnboarding.cta}
                  />
                  <Pressable
                    onPress={() => void closeAsSeen()}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.pubReminderOnboarding.skip}
                  >
                    <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.pubReminderOnboarding.skip}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.black, 0.82),
  },
  sheet: {
    maxHeight: '92%',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.26),
    backgroundColor: Colors.stout2,
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroBand: {
    minHeight: 178,
    padding: Spacing.lg,
    backgroundColor: Colors.stout3,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(Colors.border, 0.7),
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  detailCopy: {
    flex: 1,
  },
  detailTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 25,
    lineHeight: 30,
    color: Colors.foam,
  },
  detailBody: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  eyebrowPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
  },
  eyebrow: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: Colors.amberLight,
  },
  visual: {
    position: 'absolute',
    right: Spacing.xl,
    bottom: Spacing.lg,
    width: 150,
    height: 138,
  },
  visualRail: {
    position: 'absolute',
    left: 12,
    right: 4,
    bottom: 20,
    height: 1,
    backgroundColor: withAlpha(Colors.foam, 0.18),
  },
  pint: {
    position: 'absolute',
    left: 22,
    bottom: 18,
    width: 82,
    height: 108,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.36),
    overflow: 'hidden',
    backgroundColor: withAlpha(Colors.foam, 0.08),
    transform: [{ rotate: '-4deg' }],
  },
  foamCap: {
    position: 'absolute',
    left: -10,
    right: -10,
    top: 10,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foam,
  },
  beerFill: {
    position: 'absolute',
    left: 7,
    right: 7,
    bottom: 8,
    height: 66,
    borderRadius: 13,
    backgroundColor: Colors.amber,
  },
  pintShine: {
    position: 'absolute',
    top: 18,
    bottom: 18,
    left: 16,
    width: 8,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.white, 0.28),
  },
  bellBubble: {
    position: 'absolute',
    right: 6,
    top: 4,
    width: 58,
    height: 58,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amberLight,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.5),
  },
  locationBubble: {
    position: 'absolute',
    right: 20,
    bottom: 18,
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  copy: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  title: {
    maxWidth: 280,
    fontFamily: Fonts.display.extrabold,
    fontSize: 32,
    lineHeight: 36,
    color: Colors.foam,
  },
  body: {
    marginTop: Spacing.md,
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    lineHeight: 23,
    color: Colors.foamMuted,
  },
  reasons: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.stout, 0.55),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.58),
  },
  reasonIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  reasonText: {
    flex: 1,
    gap: 3,
  },
  reasonTitle: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.foam,
  },
  reasonBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  actions: {
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  secondaryPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  secondaryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
});
