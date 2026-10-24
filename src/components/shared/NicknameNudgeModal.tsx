/**
 * Post-changelog nudge for credential-backed accounts without a @nickname.
 *
 * Registration now requires picking a handle, but accounts created before that
 * change may still have none. This modal appears once per app version, only
 * AFTER the what's-new popup is dismissed (gated on releaseStore.checkSettled +
 * pendingNote, same as the pub-reminder onboarding), never during the first
 * launch session, and never blocks anything — the user can dismiss it and keep
 * using the app. It starts only while nothing covers the tabs and stays when a
 * route then opens above it. The nickname can be saved right here via
 * NicknameField.
 */

import { useRootNavigationState } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/shared/GlowButton';
import { t } from '@/i18n';
import { NicknameField } from '@/profile/NicknameField';
import {
  getSeenNicknameNudgeVersion,
  markNicknameNudgeSeen,
  shouldShowNicknameNudge,
} from '@/profile/nicknameNudge';
import { getCurrentAppVersion } from '@/data/releaseNotesClient';
import { selectNeedsNickname, useAccountStore } from '@/stores/accountStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { useLaunchModalMutex } from '@/stores/launchModalMutex';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

// iOS silently drops a Modal presented while another modal is still
// mid-dismissal, and the dropped host then swallows every touch.
const PRESENT_SETTLE_MS = 600;

// The root navigator wraps the app's Stack in its single `__root` route. A tab
// route pushed above a full-screen one inherits its modal presentation, so the
// focused route alone does not prove that nothing covers the tabs.
function rootHoldsOnlyTabs(rootState: ReturnType<typeof useRootNavigationState> | undefined) {
  const stack = rootState?.routes.length === 1 ? rootState.routes[0].state : undefined;
  return !!stack?.routes.length && stack.routes.every((route) => route.name === '(tabs)');
}

export function NicknameNudgeModal() {
  const insets = useSafeAreaInsets();
  // Gate on checkSettled, NOT hasChecked — see PubReminderOnboardingModal for
  // why racing WhatsNewModal wedges the UI on iOS.
  const releaseSettled = useReleaseStore((s) => s.checkSettled);
  const releaseNote = useReleaseStore((s) => s.pendingNote);
  const firstLaunchSession = useOnboardingStore((s) => s.firstLaunchSession);
  const needsNickname = useAccountStore(selectNeedsNickname);
  const updateProfile = useAccountStore((s) => s.updateProfile);
  const showToast = useToastStore((s) => s.show);

  const [eligible, setEligible] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let showTimer: ReturnType<typeof setTimeout> | null = null;

    async function checkVisibility() {
      if (!releaseSettled || releaseNote) return;
      const currentVersion = getCurrentAppVersion();
      const seenVersion = await getSeenNicknameNudgeVersion();
      if (cancelled) return;
      setVersion(currentVersion);
      if (!shouldShowNicknameNudge({ currentVersion, seenVersion })) return;
      showTimer = setTimeout(() => {
        if (!cancelled) setEligible(true);
      }, PRESENT_SETTLE_MS);
    }

    void checkVisibility();
    return () => {
      cancelled = true;
      if (showTimer) clearTimeout(showTimer);
    };
  }, [releaseSettled, releaseNote]);

  // A full-screen route such as auth or profile/privacy takes the root view off
  // the window. If the nudge presents then, or while that route is still
  // dismissing, iOS never presents it but its host stays above the app. The
  // medal sheet is an RN Modal outside the launch mutex, and presenting over it
  // wedges iOS the same way.
  const medalSheetOpen = useBadgeStore((s) => s.sheetOpen);
  const tabsUncovered = rootHoldsOnlyTabs(useRootNavigationState()) && !medalSheetOpen;
  const [tabsSettled, setTabsSettled] = useState(false);
  useEffect(() => {
    if (!tabsUncovered) return;
    const timer = setTimeout(() => setTabsSettled(true), PRESENT_SETTLE_MS);
    return () => {
      clearTimeout(timer);
      setTabsSettled(false);
    };
  }, [tabsUncovered]);

  const mutexHolder = useLaunchModalMutex((s) => s.holder);
  // Once presented, a route change must not hide the nudge: that would hand the
  // launch slot to the next popup before iOS has dismissed this one.
  const presented = mutexHolder === 'nickname-nudge';

  const wantVisible =
    eligible &&
    (presented || (tabsUncovered && tabsSettled)) &&
    needsNickname &&
    releaseNote === null &&
    !firstLaunchSession;

  useEffect(() => {
    const mutex = useLaunchModalMutex.getState();
    if (wantVisible) mutex.claim('nickname-nudge');
    else mutex.release('nickname-nudge');
  }, [wantVisible, mutexHolder]);
  useEffect(() => () => useLaunchModalMutex.getState().release('nickname-nudge'), []);
  const visible = wantVisible && presented;

  const progress = useSharedValue(0);
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

  const dismiss = useCallback(() => {
    void markNicknameNudgeSeen(version);
    setEligible(false);
  }, [version]);

  const handleSave = useCallback(async () => {
    if (busy || !ready) return;
    setError('');
    setBusy(true);
    try {
      const result = await updateProfile({ nickname: nickname.trim() });
      if (result.ok) {
        void markNicknameNudgeSeen(version);
        setEligible(false);
        showToast(t.nicknameNudge.savedToast);
        return;
      }
      setError(result.detail || t.account.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [busy, ready, nickname, updateProfile, version, showToast]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={[styles.backdrop, { paddingTop: insets.top + Spacing.lg }]}>
          <Animated.View style={[styles.sheet, softDrop(), cardAnim]}>
            <View style={styles.eyebrowPill}>
              <Text style={styles.at} maxFontSizeMultiplier={FontScaleCap.body}>
                @
              </Text>
              <Text style={styles.eyebrow}>{t.nicknameNudge.eyebrow}</Text>
            </View>

            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.nicknameNudge.title}
            </Text>
            <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.nicknameNudge.body}
            </Text>

            <NicknameField
              value={nickname}
              onChangeText={(value) => {
                setNickname(value);
                if (error) setError('');
              }}
              onReadyChange={setReady}
            />

            {!!error && (
              <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
                {error}
              </Text>
            )}

            <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
              <GlowButton
                label={busy ? t.nicknameNudge.ctaBusy : t.nicknameNudge.cta}
                onPress={() => void handleSave()}
                glow="none"
                height={56}
                disabled={!ready || busy}
                accessibilityLabel={t.nicknameNudge.cta}
              />
              <Pressable
                onPress={dismiss}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
                accessibilityRole="button"
                accessibilityLabel={t.nicknameNudge.skip}
              >
                <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.nicknameNudge.skip}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.black, 0.82),
  },
  sheet: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    padding: Spacing.xl,
    gap: Spacing.md,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.26),
    backgroundColor: Colors.stout2,
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
  at: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.amberLight,
  },
  eyebrow: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: Colors.amberLight,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    lineHeight: 33,
    color: Colors.foam,
  },
  body: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amberLight,
  },
  actions: {
    gap: Spacing.sm,
  },
  secondaryButton: {
    minHeight: 44,
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
