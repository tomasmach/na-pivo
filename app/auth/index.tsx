/**
 * Auth screen — sign in / sign up (route `/auth`).
 *
 * A two-tab toggle switches between "Přihlásit se" and "Registrovat". Both modes
 * share email + password fields (register adds an optional display name). Below
 * the primary CTA: a "nebo" divider, then the native social buttons (Apple only
 * on iOS) and a "Zapomenuté heslo?" inline flow.
 *
 * Every store action resolves to an AuthResult and never throws. On `ok:true`
 * we pop back to settings; on `ok:false` with code !== 'cancelled' we surface
 * `detail` inline. Client-side validation (valid email, password >= 8 chars)
 * runs before any network call so obvious mistakes show instantly.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { AppleIcon, GoogleIcon } from '@/components/shared/BrandIcon';
import { GlowButton } from '@/components/shared/GlowButton';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { isAppleSignInSupported, isGoogleSignInConfigured } from '@/data/socialAuth';

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
      <Text style={styles.label}>{label}</Text>
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
}

function SocialButton({ label, icon, onPress, accessibilityLabel, disabled }: SocialButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.socialButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      {icon}
      <Text style={styles.socialButtonLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
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

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<null | 'submit' | 'google' | 'apple'>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  const appleSupported = useMemo(() => isAppleSignInSupported(), []);
  const googleConfigured = useMemo(() => isGoogleSignInConfigured(), []);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (busy) return;
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setError(cs.account.errorEmailInvalid);
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(cs.account.errorPasswordShort);
      return;
    }
    setError('');
    setBusy('submit');
    try {
      const result =
        mode === 'login'
          ? await login({ email: trimmedEmail, password })
          : await register({
              email: trimmedEmail,
              password,
              displayName: displayName.trim() || undefined,
            });

      if (result.ok) {
        if (mode === 'register' && !result.profile.emailVerified) {
          showToast(cs.account.verifyEmailSentToast);
        }
        router.back();
        return;
      }
      if (result.code !== 'cancelled') {
        setError(result.detail || cs.account.errorGeneric);
      }
    } finally {
      setBusy(null);
    }
  }, [busy, email, password, displayName, mode, login, register, router, showToast]);

  const handleSocial = useCallback(
    async (provider: 'google' | 'apple') => {
      if (busy) return;
      setError('');
      setBusy(provider);
      try {
        const result = provider === 'google' ? await signInGoogle() : await signInApple();
        if (result.ok) {
          router.back();
          return;
        }
        if (result.code !== 'cancelled') {
          setError(result.detail || cs.account.errorGeneric);
        }
      } finally {
        setBusy(null);
      }
    },
    [busy, signInGoogle, signInApple, router],
  );

  const handleSendReset = useCallback(async () => {
    const trimmed = resetEmail.trim();
    if (!isValidEmail(trimmed)) {
      setError(cs.account.errorEmailInvalid);
      return;
    }
    setError('');
    const result = await requestPasswordReset(trimmed);
    if (!result.ok) {
      setError(result.detail || cs.account.errorGeneric);
      return;
    }
    setResetOpen(false);
    setResetEmail('');
    showToast(cs.account.resetSentToast);
  }, [resetEmail, requestPasswordReset, showToast]);

  const submitLabel =
    busy === 'submit'
      ? cs.account.loading
      : mode === 'login'
        ? cs.account.submitLogin
        : cs.account.submitRegister;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle}>{cs.account.authTitle}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.account.intro}
          </Text>

          {/* ── Mode toggle ── */}
          <View style={styles.segmented}>
            {(['login', 'register'] as const).map((value) => {
              const selected = value === mode;
              const label = value === 'login' ? cs.account.tabLogin : cs.account.tabRegister;
              return (
                <Pressable
                  key={value}
                  onPress={() => switchMode(value)}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={
                    value === 'login' ? cs.a11y.authTabLogin : cs.a11y.authTabRegister
                  }
                >
                  <Text
                    style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Fields ── */}
          {mode === 'register' && (
            <Field
              label={cs.account.nameLabel}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={cs.account.namePlaceholder}
              accessibilityLabel={cs.a11y.authNameInput}
              autoComplete="name"
              textContentType="name"
            />
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

          {!!error && (
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {error}
            </Text>
          )}

          {/* ── Primary CTA ── */}
          <View style={styles.primaryButton}>
            <GlowButton
              label={submitLabel}
              onPress={handleSubmit}
              glow={busy ? 'none' : 'soft'}
              accessibilityLabel={submitLabel}
            />
            {busy === 'submit' && (
              <View style={styles.buttonSpinner} pointerEvents="none">
                <ActivityIndicator color={Colors.stout} />
              </View>
            )}
          </View>

          {/* ── Forgot password ── */}
          {mode === 'login' && !resetOpen && (
            <Pressable
              onPress={() => {
                setResetOpen(true);
                setResetEmail(email.trim());
                setError('');
              }}
              style={({ pressed }) => [styles.forgotLink, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.authForgotPassword}
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
                accessibilityLabel={cs.account.resetSend}
              />
            </View>
          )}

          {/* ── Divider ── */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{cs.account.orDivider}</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ── Social ── */}
          {appleSupported && (
            <SocialButton
              label={cs.account.continueWithApple}
              icon={<AppleIcon size={20} color={Colors.foam} />}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
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
    fontFamily: Fonts.display.extrabold,
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
  intro: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
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
    fontFamily: Fonts.ui.semibold,
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
    fontFamily: Fonts.ui.bold,
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
    fontFamily: Fonts.ui.medium,
    fontSize: 16,
    color: Colors.foam,
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amberLight,
  },

  // ── Primary CTA ──
  primaryButton: {
    position: 'relative',
    marginTop: Spacing.xs,
  },
  buttonSpinner: {
    position: 'absolute',
    top: 0,
    right: 24,
    bottom: 0,
    justifyContent: 'center',
  },

  // ── Forgot password ──
  forgotLink: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
  },
  forgotText: {
    fontFamily: Fonts.ui.semibold,
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
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.medium,
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
  socialButtonLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
