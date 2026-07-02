/**
 * Onboarding wizard (route `/profile/setup`) — shown once, right after a user
 * signs in/up without a nickname (the ProfileGate in app/_layout.tsx redirects
 * here). A 3-step flow inside a single fullScreenModal with `gestureEnabled:
 * false` so STEP 1 (nickname) cannot be swiped away — it is the hard gate.
 *
 *   STEP 1  Nickname + photo (one screen) — "@" input + live availability, plus a
 *           tappable avatar (camera badge) that picks → uploads immediately. The
 *           photo is optional, so there is no skip button: leave it empty and
 *           continue. "Pokračovat" is disabled until the nickname is valid +
 *           available; submit calls updateProfile({nickname}); a 409 re-shows
 *           "taken".
 *   STEP 2  Visibility — toggle DEFAULT ON + the locked GDPR consent copy.
 *           "Pokračovat" persists is_public then advances to the friends step.
 *   STEP 3  First friends (optional, Parta 3.0 §A2) — show my invite code or skip;
 *           finishing router.replace → the profile tab.
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
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { GlowButton } from '@/components/shared/GlowButton';
import { CameraIcon, QrCodeIcon } from '@/components/shared/IconGlyph';
import { Avatar } from '@/profile/Avatar';
import CodeSheet from '@/friends/CodeSheet';
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

  // STEP 2 (visibility)
  const [isPublic, setIsPublic] = useState(true);
  const [visibilityError, setVisibilityError] = useState('');

  // STEP 3 (first friends)
  const [codeVisible, setCodeVisible] = useState(false);

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

  // ── STEP 2 → 3 (persist visibility, then offer first friends) ──
  const handleVisibilityContinue = useCallback(async () => {
    if (busy) return;
    setVisibilityError('');
    setBusy(true);
    try {
      const result = await updateProfile({ isPublic });
      if (!result.ok) {
        setVisibilityError(result.detail || cs.profile.setup.visibilitySaveError);
        return;
      }
      setStep(3);
    } finally {
      setBusy(false);
    }
  }, [busy, isPublic, updateProfile]);

  // ── STEP 3 finish (visibility already saved; friends are optional) ──
  const handleFinish = useCallback(() => {
    router.replace('/(tabs)/profile' as Href);
    showToast(cs.profile.edit.savedToast);
  }, [router, showToast]);

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

              {/* Tappable avatar — the photo IS the affordance; no separate button.
                  Picking uploads immediately, so continuing just keeps it. */}
              <View style={styles.avatarBlock}>
                <Pressable
                  onPress={permissionBlocked ? () => void Linking.openSettings() : handlePickAvatar}
                  disabled={avatarBusy}
                  style={({ pressed }) => [styles.avatarTap, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.profilePickPhoto}
                  hitSlop={8}
                >
                  <Avatar uri={avatarUrl} nickname={nickname} displayName={displayName} size={104} />
                  <View style={styles.avatarBadge}>
                    {avatarBusy ? (
                      <ActivityIndicator size="small" color={Colors.stout} />
                    ) : (
                      <CameraIcon size={18} color={Colors.stout} />
                    )}
                  </View>
                </Pressable>
                <Text style={styles.photoHint} maxFontSizeMultiplier={FontScaleCap.body}>
                  {permissionBlocked
                    ? cs.profile.setup.openSettings
                    : avatarUrl
                      ? cs.profile.setup.photoHintSet
                      : cs.profile.setup.photoHintEmpty}
                </Text>
                {!!avatarError && (
                  <Text style={[styles.errorText, styles.avatarErrorText]} maxFontSizeMultiplier={FontScaleCap.body}>
                    {avatarError}
                  </Text>
                )}
              </View>

              <View style={styles.fieldBlock}>
                <NicknameField
                  value={nicknameInput}
                  onChangeText={(value) => {
                    setNicknameInput(value);
                    if (nicknameError) setNicknameError('');
                  }}
                  onReadyChange={setNicknameReady}
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

              <View style={styles.consentCard}>
                <VisibilityToggle
                  value={isPublic}
                  onToggle={(next) => {
                    setIsPublic(next);
                    if (visibilityError) setVisibilityError('');
                  }}
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
                  label={busy ? cs.account.loading : cs.profile.setup.continue}
                  onPress={handleVisibilityContinue}
                  glow={busy ? 'none' : 'soft'}
                  accessibilityLabel={cs.profile.setup.continue}
                />
                {!!visibilityError && (
                  <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {visibilityError}
                  </Text>
                )}
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.eyebrow}>{cs.profile.setup.step3Eyebrow}</Text>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.profile.setup.step3Title}
              </Text>
              <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.profile.setup.step3Body}
              </Text>

              <View style={styles.cta}>
                <GlowButton
                  label={cs.profile.setup.step3ShowCode}
                  onPress={() => setCodeVisible(true)}
                  glow="soft"
                  icon={<QrCodeIcon size={20} color={Colors.stout} />}
                  accessibilityLabel={cs.profile.setup.step3ShowCode}
                />
              </View>
              <Pressable
                onPress={handleFinish}
                style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.profile.setup.step3Skip}
              >
                <Text style={styles.skipText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.profile.setup.step3Skip}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {busy && step === 2 && (
        <View style={styles.fullSpinner} pointerEvents="none">
          <ActivityIndicator color={Colors.amber} />
        </View>
      )}

      {codeVisible ? <CodeSheet onClose={() => setCodeVisible(false)} /> : null}
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
  skipButton: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  skipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },

  // ── Avatar (tappable, on the nickname step) ──
  avatarBlock: {
    alignItems: 'center',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  avatarTap: {
    position: 'relative',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.stout,
  },
  photoHint: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
    textAlign: 'center',
  },
  avatarErrorText: {
    textAlign: 'center',
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
