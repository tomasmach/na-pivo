/**
 * Auth screen — sign in / sign up (route `/auth`).
 *
 * A two-tab toggle switches between "Přihlásit se" and "Registrovat". Both modes
 * share email + password fields (register adds a required @nickname). Below
 * the primary CTA: a "nebo" divider, then the native social buttons (Apple only
 * on iOS) and a "Zapomenuté heslo?" inline flow.
 *
 * Every store action resolves to an AuthResult and never throws. A newly
 * registered account continues to the one-screen privacy choice; returning
 * users pop back to the app. On `ok:false` with code !== 'cancelled' we surface
 * `detail` inline. Client-side validation runs before any network call.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Linking,
  StyleSheet,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { AppleIcon, GoogleIcon } from '@/components/shared/BrandIcon';
import { GlowButton } from '@/components/shared/GlowButton';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { NicknameField } from '@/profile/NicknameField';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { isAppleSignInSupported, isGoogleSignInConfigured } from '@/data/socialAuth';
import { trackUiInteraction } from '@/data/uxTelemetry';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

// ---------------------------------------------------------------------------
// Field — labelled text input mirroring add-pub.tsx styling.
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  keyboardType,
  secureTextEntry,
  autoComplete,
  textContentType,
}: FieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.mutedText}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoComplete={autoComplete}
        textContentType={textContentType}
        accessibilityLabel={accessibilityLabel}
        maxFontSizeMultiplier={FontScaleCap.body}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Social button — secondary GlowButton with a brand glyph.
// ---------------------------------------------------------------------------

interface SocialButtonProps {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  /**
   * White, the way Apple's own button looks.
   *
   * Sign in with Apple has two sanctioned styles, black and white, and on a
   * stout-brown screen the black one is a dark button on a dark background —
   * the one control here that people recognise by SHAPE goes invisible. White
   * is both compliant and the only thing on the screen that reads as "the
   * system is doing this, not the app".
   */
  light?: boolean;
}

function SocialButton({
  label,
  icon,
  onPress,
  accessibilityLabel,
  disabled,
  light,
}: SocialButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.socialButton,
        light && styles.socialButtonLight,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      {icon}
      <Text
        style={[styles.socialButtonLabel, light && styles.socialButtonLabelLight]}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);

  const register = useAccountStore((s) => s.register);
  const login = useAccountStore((s) => s.login);
  const signInGoogle = useAccountStore((s) => s.signInGoogle);
  const signInApple = useAccountStore((s) => s.signInApple);
  const requestPasswordReset = useAccountStore((s) => s.requestPasswordReset);
  const updateProfile = useAccountStore((s) => s.updateProfile);
  const sessionRecoveryRequired = useAccountStore((s) => s.status === 'reauth-required');

  // Registration is the default: this screen exists to get somebody an
  // account. Signing in is the rarer errand and lives in a link at the foot.
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameReady, setNicknameReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<null | 'submit' | 'google' | 'apple' | 'reset'>(null);
  const operationInFlight = useRef(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  const appleSupported = useMemo(() => isAppleSignInSupported(), []);
  const googleConfigured = useMemo(() => isGoogleSignInConfigured(), []);

  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)' as Href);
    }
  }, [router]);

  const switchMode = useCallback((next: Mode) => {
    trackUiInteraction(next === 'login' ? 'auth_login_mode' : 'auth_register_mode', 'select');
    setMode(next);
    setError('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (operationInFlight.current) return;
    trackUiInteraction('auth_email_submit', 'submit');
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      trackUiInteraction('auth_email_submit', 'failure');
      setError(cs.account.errorEmailInvalid);
      return;
    }
    if (password.length < MIN_PASSWORD) {
      trackUiInteraction('auth_email_submit', 'failure');
      setError(cs.account.errorPasswordShort);
      return;
    }
    const trimmedNickname = nickname.trim();
    if (mode === 'register') {
      if (!trimmedNickname) {
        trackUiInteraction('auth_email_submit', 'failure');
        setError(cs.account.errorNicknameMissing);
        return;
      }
      if (!nicknameReady) {
        trackUiInteraction('auth_email_submit', 'failure');
        setError(cs.account.errorNicknameNotReady);
        return;
      }
    }
    operationInFlight.current = true;
    setError('');
    setBusy('submit');
    try {
      const result =
        mode === 'login'
          ? await login({ email: trimmedEmail, password })
          : await register({ email: trimmedEmail, password });

      if (result.ok) {
        trackUiInteraction('auth_email_submit', 'success');
        if (mode === 'register') {
          // The handle is claimed right after the account exists. Losing the
          // race (or a network hiccup) must not block registration — the
          // nickname stays editable in the profile.
          if (trimmedNickname) {
            const nickResult = await updateProfile({ nickname: trimmedNickname });
            if (!nickResult.ok) {
              showToast(cs.account.nicknameSetFailedToast);
            }
          }
          if (!result.profile.emailVerified) {
            showToast(cs.account.verifyEmailSentToast);
          }
          router.replace('/profile/privacy' as Href);
        } else {
          leave();
        }
        return;
      }
      if (result.code !== 'cancelled') {
        trackUiInteraction('auth_email_submit', 'failure');
        setError(result.detail || cs.account.errorGeneric);
      } else {
        trackUiInteraction('auth_email_submit', 'cancel');
      }
    } finally {
      operationInFlight.current = false;
      setBusy(null);
    }
  }, [
    email,
    password,
    nickname,
    nicknameReady,
    mode,
    login,
    register,
    updateProfile,
    leave,
    router,
    showToast,
  ]);

  const handleSocial = useCallback(
    async (provider: 'google' | 'apple') => {
      if (operationInFlight.current) return;
      operationInFlight.current = true;
      const target = provider === 'google' ? 'auth_google_submit' : 'auth_apple_submit';
      trackUiInteraction(target, 'submit');
      setError('');
      setBusy(provider);
      try {
        const result = provider === 'google' ? await signInGoogle() : await signInApple();
        if (result.ok) {
          trackUiInteraction(target, 'success');
          // Social buttons serve both login and registration. The backend marks
          // new accounts; a missing nickname is the compatibility fallback for
          // claimed anonymous accounts where `created` can be false.
          if (result.profile.created === true || result.profile.nickname == null) {
            router.replace('/profile/privacy' as Href);
          } else {
            leave();
          }
          return;
        }
        if (result.code !== 'cancelled') {
          trackUiInteraction(target, 'failure');
          setError(result.detail || cs.account.errorGeneric);
        } else {
          trackUiInteraction(target, 'cancel');
        }
      } finally {
        operationInFlight.current = false;
        setBusy(null);
      }
    },
    [leave, signInGoogle, signInApple, router],
  );

  const handleSendReset = useCallback(async () => {
    if (operationInFlight.current) return;
    trackUiInteraction('auth_reset_submit', 'submit');
    const trimmed = resetEmail.trim();
    if (!isValidEmail(trimmed)) {
      trackUiInteraction('auth_reset_submit', 'failure');
      setError(cs.account.errorEmailInvalid);
      return;
    }
    operationInFlight.current = true;
    setError('');
    setBusy('reset');
    try {
      const result = await requestPasswordReset(trimmed);
      if (!result.ok) {
        trackUiInteraction('auth_reset_submit', 'failure');
        setError(result.detail || cs.account.errorGeneric);
        return;
      }
      setResetOpen(false);
      trackUiInteraction('auth_reset_submit', 'success');
      setResetEmail('');
      showToast(cs.account.resetSentToast);
      router.push('/auth/reset');
    } finally {
      operationInFlight.current = false;
      setBusy(null);
    }
  }, [resetEmail, requestPasswordReset, showToast, router]);

  const submitLabel =
    busy === 'submit'
      ? cs.account.loading
      : mode === 'login'
        ? cs.account.submitLogin
        : cs.account.submitRegister;
  const visibleError =
    error ||
    (sessionRecoveryRequired
      ? cs.account.sessionExpired
      : '');

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable
          onPress={leave}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.account.authTitle}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 24, 32) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
          {/* ── Fields ── */}
          {mode === 'register' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.account.nicknameLabel}
              </Text>
              <NicknameField
                value={nickname}
                onChangeText={(value) => {
                  setNickname(value);
                  if (error) setError('');
                }}
                onReadyChange={setNicknameReady}
              />
            </View>
          )}
          <Field
            label={cs.account.emailLabel}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (error) setError('');
            }}
            placeholder={cs.account.emailPlaceholder}
            accessibilityLabel={cs.a11y.authEmailInput}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Field
            label={cs.account.passwordLabel}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (error) setError('');
            }}
            placeholder={cs.account.passwordPlaceholder}
            accessibilityLabel={cs.a11y.authPasswordInput}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            textContentType={mode === 'login' ? 'password' : 'newPassword'}
          />

          {!!visibleError && (
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {visibleError}
            </Text>
          )}

          {/* ── Primary CTA ── */}
          <View style={styles.primaryButton}>
            <GlowButton
              label={submitLabel}
              onPress={handleSubmit}
              glow={busy || sessionRecoveryRequired ? 'none' : 'soft'}
              loading={busy === 'submit'}
              disabled={busy !== null && busy !== 'submit'}
              accessibilityLabel={submitLabel}
            />
          </View>

          {/* ── Forgot password ── */}
          {mode === 'login' && !resetOpen && (
            <Pressable
              onPress={() => {
                trackUiInteraction('auth_reset_open');
                setResetOpen(true);
                setResetEmail(email.trim());
                setError('');
              }}
              style={({ pressed }) => [styles.forgotLink, pressed && styles.pressed]}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.authForgotPassword}
              accessibilityState={{ disabled: busy !== null }}
              hitSlop={8}
            >
              <Text style={styles.forgotText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.account.forgotPassword}
              </Text>
            </Pressable>
          )}

          {resetOpen && (
            <View style={styles.resetCard}>
              <Text style={styles.resetPrompt} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.account.resetPrompt}
              </Text>
              <TextInput
                style={styles.input}
                value={resetEmail}
                onChangeText={setResetEmail}
                placeholder={cs.account.emailPlaceholder}
                placeholderTextColor={Colors.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                accessibilityLabel={cs.a11y.authResetEmailInput}
                maxFontSizeMultiplier={FontScaleCap.body}
              />
              <GlowButton
                label={cs.account.resetSend}
                onPress={handleSendReset}
                variant="secondary"
                glow="none"
                height={52}
                loading={busy === 'reset'}
                disabled={busy !== null && busy !== 'reset'}
                accessibilityLabel={cs.account.resetSend}
              />
            </View>
          )}

          {/* ── Divider ── */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.account.orDivider}
            </Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ── Social ── */}
          {appleSupported && (
            <SocialButton
              light
              label={cs.account.continueWithApple}
              icon={<AppleIcon size={20} color={Colors.black} />}
              onPress={() => handleSocial('apple')}
              accessibilityLabel={cs.a11y.authSignInApple}
              disabled={busy != null}
            />
          )}
          {googleConfigured && (
            <SocialButton
              label={cs.account.continueWithGoogle}
              icon={<GoogleIcon size={20} color={Colors.foam} />}
              onPress={() => handleSocial('google')}
              accessibilityLabel={cs.a11y.authSignInGoogle}
              disabled={busy != null}
            />
          )}

          {/* ── Terms consent (covers e-mail registration and social sign-in) ── */}
          <Text style={styles.legalNote} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.account.termsNotePrefix}
            <Text
              style={styles.legalLink}
              onPress={() => void Linking.openURL(TERMS_URL)}
              accessibilityRole="link"
            >
              {cs.account.termsNoteTermsLink}
            </Text>
            {cs.account.termsNoteMiddle}
            <Text
              style={styles.legalLink}
              onPress={() => void Linking.openURL(PRIVACY_URL)}
              accessibilityRole="link"
            >
              {cs.account.termsNotePrivacyLink}
            </Text>
            {cs.account.termsNoteSuffix}
          </Text>

          {/* The other errand, as a link. Registering and signing in are not two
              equal choices to weigh at the top of the screen: almost everybody
              here is new, and the segmented control made the returning user's
              rarer job cost the newcomer a decision. */}
          <Pressable
            onPress={() => switchMode(mode === 'register' ? 'login' : 'register')}
            style={({ pressed }) => [styles.switchRow, pressed && styles.pressed]}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={
              mode === 'register' ? cs.a11y.authTabLogin : cs.a11y.authTabRegister
            }
            accessibilityState={{ disabled: busy !== null }}
          >
            <Text style={styles.switchText} maxFontSizeMultiplier={FontScaleCap.body}>
              {mode === 'register' ? cs.account.haveAccount : cs.account.noAccount}{' '}
              <Text style={styles.switchLink}>
                {mode === 'register' ? cs.account.tabLogin : cs.account.tabRegister}
              </Text>
            </Text>
          </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const TERMS_URL = 'https://tomasmach.github.io/na-pivo/terms.html';
const PRIVACY_URL = 'https://tomasmach.github.io/na-pivo/privacy.html';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  legalNote: {
    marginTop: Spacing.xs,
    fontWeight: '400',
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  legalLink: {
    color: Colors.foamMuted,
    textDecorationLine: 'underline',
  },
  flex: {
    flex: 1,
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
    fontWeight: '800',
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },

  // ── Scroll ──
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },

  // ── Mode toggle ──
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.stout3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.pill,
  },
  segmentSelected: {
    backgroundColor: Colors.amber,
  },
  segmentLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
  },
  segmentLabelSelected: {
    color: Colors.stout,
  },

  // ── Fields ──
  fieldGroup: {
    gap: Spacing.sm,
  },
  label: {
    fontWeight: '700',
    fontSize: 12,
    color: Colors.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 52,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    paddingHorizontal: 14,
    fontWeight: '500',
    fontSize: 16,
    color: Colors.foam,
  },
  errorText: {
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amberLight,
  },

  // ── Primary CTA ──
  primaryButton: {
    position: 'relative',
    marginTop: Spacing.xs,
  },

  // ── Forgot password ──
  forgotLink: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
  },
  forgotText: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.amber,
  },
  resetCard: {
    gap: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: withAlpha(Colors.stout2, 0.78),
    padding: Spacing.lg,
  },
  resetPrompt: {
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },

  // ── Divider ──
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginVertical: Spacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },

  // ── Social buttons ──
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  switchRow: {
    marginTop: Spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchText: { fontWeight: '500', fontSize: 15, color: Colors.foamMuted },
  switchLink: { fontWeight: '700', color: Colors.amber },
  socialButtonLight: {
    backgroundColor: Colors.white,
    borderColor: Colors.white,
  },
  socialButtonLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: Colors.foam,
  },
  socialButtonLabelLight: { color: Colors.black },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
