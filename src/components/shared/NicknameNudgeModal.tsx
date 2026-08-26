/**
 * Post-changelog nudge for credential-backed accounts without a @nickname.
 *
 * Registration now requires picking a handle, but accounts created before that
 * change may still have none. This modal appears once per app version, only
 * AFTER the what's-new popup is dismissed (gated on releaseStore.checkSettled +
 * pendingNote, same as the pub-reminder onboarding), never during the first
 * launch session, and never blocks anything — the user can dismiss it and keep
 * using the app. The nickname can be saved right here via NicknameField.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { t } from '@/i18n';
import { NicknameField } from '@/profile/NicknameField';
import {
  getSeenNicknameNudgeVersion,
  markNicknameNudgeSeen,
  shouldShowNicknameNudge,
} from '@/profile/nicknameNudge';
import { getCurrentAppVersion } from '@/data/releaseNotesClient';
import { selectNeedsNickname, useAccountStore } from '@/stores/accountStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { MockLayout, MockType } from '@/mocks/mockTheme';

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
      // Present a beat later: iOS silently drops a Modal presented while the
      // what's-new modal is still mid-dismissal, wedging the UI.
      showTimer = setTimeout(() => {
        if (!cancelled) setEligible(true);
      }, 600);
    }

    void checkVisibility();
    return () => {
      cancelled = true;
      if (showTimer) clearTimeout(showTimer);
    };
  }, [releaseSettled, releaseNote]);

  // `needsNickname` keeps this quiet for anonymous sessions, signed-out users,
  // accounts that already have a handle, and while the profile hasn't loaded.
  const wantVisible =
    eligible && needsNickname && releaseNote === null && !firstLaunchSession;

  const dismiss = useCallback(() => {
    if (busy) return;
    void markNicknameNudgeSeen(version);
    setEligible(false);
  }, [busy, version]);

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
    <BottomSheetModal
      visible={wantVisible}
      onClose={dismiss}
      keyboardLift
      presentationId="nickname-nudge"
    >
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.nicknameNudge.title}
            </Text>
            <CloseButton onPress={dismiss} label={t.nicknameNudge.skip} disabled={busy} />
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={() => void handleSave()}
              disabled={!ready || busy}
              accessibilityRole="button"
              accessibilityLabel={t.nicknameNudge.cta}
              style={({ pressed }) => [
                styles.primaryButton,
                (!ready || busy) && styles.primaryDisabled,
                pressed && styles.primaryPressed,
              ]}
            >
              <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.display}>
                {busy ? t.nicknameNudge.ctaBusy : t.nicknameNudge.cta}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  content: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.sm,
  },
  contentContainer: {
    paddingBottom: Spacing.sm,
  },
  errorText: {
    marginTop: Spacing.sm,
    ...MockType.bodySmall,
    color: Colors.amber,
  },
  actions: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  primaryButton: {
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryDisabled: {
    opacity: 0.45,
  },
  primaryPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  primaryText: {
    ...MockType.buttonLabel,
    color: Colors.stout,
  },
});
