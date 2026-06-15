/**
 * Onboarding wizard (route `/profile/setup`) — shown once, right after a user
 * signs in/up without a nickname (the ProfileGate in app/_layout.tsx redirects
 * here). A 3-step flow inside a single fullScreenModal with `gestureEnabled:
 * false` so STEP 1 (nickname) cannot be swiped away — it is the hard gate.
 *
 *   STEP 1  Nickname — "@" input + live availability. "Pokračovat" disabled
 *           until valid + available; submit calls updateProfile({nickname});
 *           a 409 re-shows "taken".
 *   STEP 2  Avatar (optional) — Google pre-fill shown when present; pick → upload;
 *           "Přeskočit" advances with whatever avatar (or none) is set.
 *   STEP 3  Visibility — toggle DEFAULT ON + the locked GDPR consent copy.
 *           "Hotovo" persists is_public then router.replace → the profile tab.
 *
 * Every store action is an AuthResult (never throws); failures surface inline.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { GlowButton } from '@/components/shared/GlowButton';
import { Avatar } from '@/profile/Avatar';
import { NicknameField } from '@/profile/NicknameField';
import { VisibilityToggle } from '@/profile/VisibilityToggle';
import { pickAndPrepareAvatar } from '@/profile/avatarPicker';
import { nicknameServerReasonMessage } from '@/profile/nickname';
import {
  useAccountStore,
  selectNickname,
  selectAvatarUrl,
} from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';

type Step = 1 | 2 | 3;

export default function ProfileSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);

  const profile = useAccountStore((s) => s.profile);
  const nickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const updateProfile = useAccountStore((s) => s.updateProfile);
  const uploadAvatar = useAccountStore((s) => s.uploadAvatar);

  const [step, setStep] = useState<Step>(1);

  // STEP 1
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameReady, setNicknameReady] = useState(false);
  const [nicknameError, setNicknameError] = useState('');

  // STEP 2
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  // Permission permanently denied (canAskAgain=false) → offer Settings, not re-prompt.
  const [permissionBlocked, setPermissionBlocked] = useState(false);

  // STEP 3
  const [isPublic, setIsPublic] = useState(true);

  const [busy, setBusy] = useState(false);

  const displayName = profile?.displayName?.trim() || '';

  // ── STEP 1 submit ──
  const handleNicknameContinue = useCallback(async () => {
    if (busy || !nicknameReady) return;
    setNicknameError('');
    setBusy(true);
    try {
      const result = await updateProfile({ nickname: nicknameInput.trim() });
      if (result.ok) {
        setStep(2);
        return;
      }
      // 409 (taken) or 400 (invalid/reserved) — re-show inline. The backend may
      // send either a coded body (`nickname_taken`) or a bare status (`http_409`).
      if (result.code === 'nickname_taken' || result.code === 'http_409') {
        setNicknameError(cs.profile.setup.nicknameTaken);
      } else {
        setNicknameError(result.detail || nicknameServerReasonMessage(result.code));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, nicknameReady, nicknameInput, updateProfile]);

  // ── STEP 2 pick avatar ──
  const handlePickAvatar = useCallback(async () => {
    if (avatarBusy) return;
    setAvatarError('');
    setPermissionBlocked(false);
    setAvatarBusy(true);
    try {
      const picked = await pickAndPrepareAvatar();
      if (picked.status === 'cancelled') return;
      if (picked.status === 'denied') {
        setAvatarError(cs.profile.setup.permissionBody);
        return;
      }
      if (picked.status === 'denied-permanent') {
        setAvatarError(cs.profile.setup.permissionBlockedBody);
        setPermissionBlocked(true);
        return;
      }
      if (picked.status === 'error') {
        setAvatarError(cs.profile.setup.avatarUploadError);
        return;
      }
      const result = await uploadAvatar(picked.uri);
      if (!result.ok) {
        setAvatarError(result.detail || cs.profile.setup.avatarUploadError);
      }
    } finally {
      setAvatarBusy(false);
    }
  }, [avatarBusy, uploadAvatar]);

  // ── STEP 3 finish ──
  const handleFinish = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateProfile({ isPublic });
      // Whether or not the visibility write succeeded, the nickname (the hard
      // gate) is set — land the user on their profile rather than trapping them.
      router.replace('/(tabs)/profile');
      showToast(cs.profile.edit.savedToast);
    } finally {
      setBusy(false);
    }
  }, [busy, isPublic, updateProfile, router, showToast]);

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + Spacing.xl, paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Step dots */}
          <View style={styles.dots}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[styles.dot, n === step && styles.dotActive, n < step && styles.dotDone]} />
            ))}
          </View>

          {step === 1 && (
            <>
              <Text style={styles.eyebrow}>{cs.profile.setup.step1Eyebrow}</Text>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.profile.setup.step1Title}
              </Text>
              <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.profile.setup.step1Body}
              </Text>

              <View style={styles.fieldBlock}>
                <NicknameField
                  value={nicknameInput}
                  onChangeText={(value) => {
                    setNicknameInput(value);
                    if (nicknameError) setNicknameError('');
                  }}
                  onReadyChange={setNicknameReady}
                  autoFocus
                />
                {!!nicknameError && (
                  <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {nicknameError}
                  </Text>
                )}
              </View>

              <View style={styles.cta}>
                <GlowButton
                  label={busy ? cs.account.loading : cs.profile.setup.continue}
                  onPress={handleNicknameContinue}
                  glow={nicknameReady && !busy ? 'soft' : 'none'}
                  accessibilityLabel={cs.profile.setup.continue}
                />
                {(!nicknameReady || busy) && <View style={styles.ctaDisabledVeil} pointerEvents="none" />}
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.eyebrow}>{cs.profile.setup.step2Eyebrow}</Text>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.profile.setup.step2Title}
              </Text>
              <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.profile.setup.step2Body}
              </Text>

              <View style={styles.avatarBlock}>
                <Avatar uri={avatarUrl} nickname={nickname} displayName={displayName} size={120} />
              </View>

              {!!avatarError && (
                <Text style={[styles.errorText, styles.avatarErrorText]} maxFontSizeMultiplier={FontScaleCap.body}>
                  {avatarError}
                </Text>
              )}

              <View style={styles.cta}>
                {permissionBlocked ? (
                  <GlowButton
                    label={cs.profile.setup.openSettings}
                    onPress={() => void Linking.openSettings()}
                    variant="secondary"
                    glow="none"
                    accessibilityLabel={cs.profile.setup.openSettings}
                  />
                ) : (
                  <GlowButton
                    label={
                      avatarBusy
                        ? cs.account.loading
                        : avatarUrl
                          ? cs.profile.setup.changePhoto
                          : cs.profile.setup.pickPhoto
                    }
                    onPress={handlePickAvatar}
                    variant="secondary"
                    glow="none"
                    accessibilityLabel={cs.a11y.profilePickPhoto}
                  />
                )}
              </View>

              <Pressable
                onPress={() => setStep(3)}
                style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.profile.setup.skip}
                hitSlop={8}
              >
                <Text style={styles.skipText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.profile.setup.skip}
                </Text>
              </Pressable>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.eyebrow}>{cs.profile.setup.step3Eyebrow}</Text>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.profile.setup.step3Title}
              </Text>

              <View style={styles.consentCard}>
                <VisibilityToggle
                  value={isPublic}
                  onToggle={setIsPublic}
                  label={cs.profile.setup.visibilityToggleLabel}
                  accessibilityLabel={cs.a11y.profileVisibilityToggle(
                    isPublic ? cs.a11y.toggleOn : cs.a11y.toggleOff,
                  )}
                />
                <View style={styles.consentDivider} />
                <Text style={styles.consentText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.profile.setup.consentPublic}
                </Text>
                {!isPublic && (
                  <Text style={styles.consentPrivate} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.profile.setup.consentPrivate}
                  </Text>
                )}
              </View>

              <View style={styles.cta}>
                <GlowButton
                  label={busy ? cs.account.loading : cs.profile.setup.finish}
                  onPress={handleFinish}
                  glow={busy ? 'none' : 'soft'}
                  accessibilityLabel={cs.profile.setup.finish}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {busy && step === 3 && (
        <View style={styles.fullSpinner} pointerEvents="none">
          <ActivityIndicator color={Colors.amber} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },

  // ── Step dots ──
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: Spacing.sm,
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

  // ── Copy ──
  eyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: Colors.foam,
  },
  body: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
  },

  // ── Fields ──
  fieldBlock: {
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amberLight,
  },

  // ── CTA ──
  cta: {
    position: 'relative',
    marginTop: Spacing.md,
  },
  ctaDisabledVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.55),
  },

  // ── Avatar step ──
  avatarBlock: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  avatarErrorText: {
    textAlign: 'center',
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  skipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.mutedText,
  },

  // ── Visibility step ──
  consentCard: {
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginTop: Spacing.sm,
  },
  consentDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  consentText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.foamMuted,
  },
  consentPrivate: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.amber,
  },

  fullSpinner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
