/**
 * Account management screen — shown when signed in (route `/account`).
 *
 * Sections:
 *  1. Header card — display name / email + a verified badge or an "Ověřit
 *     e-mail" action.
 *  2. "Způsoby přihlášení" card — link/unlink rows for E-mail, Google, Apple,
 *     plus a "Nastavit heslo" form when the account has no password yet.
 *  3. "Odhlásit se" — secondary GlowButton.
 *  4. Danger zone — "Smazat účet" behind a native confirm alert.
 *
 * The store actions never throw (AuthResult / AuthActionResult), so each handler
 * just branches on `ok` and surfaces `detail` via a toast. Provider sheets that
 * the user dismisses come back with code 'cancelled' — we show nothing then.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import {
  ChevronLeftIcon,
  CheckIcon,
  DownloadIcon,
  MailIcon,
  PencilIcon,
  LinkIcon,
  KeyRoundIcon,
} from '@/components/shared/IconGlyph';
import { AppleIcon, GoogleIcon } from '@/components/shared/BrandIcon';
import { GlowButton } from '@/components/shared/GlowButton';
import { Avatar } from '@/profile/Avatar';
import {
  useAccountStore,
  selectNickname,
  selectAvatarUrl,
} from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { isAppleSignInSupported } from '@/data/socialAuth';
import type { AuthProvider } from '@/data/auth';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);

  const profile = useAccountStore((s) => s.profile);
  const nickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const linkGoogle = useAccountStore((s) => s.linkGoogle);
  const linkApple = useAccountStore((s) => s.linkApple);
  const unlink = useAccountStore((s) => s.unlink);
  const setPassword = useAccountStore((s) => s.setPassword);
  const logout = useAccountStore((s) => s.logout);
  const deleteAccount = useAccountStore((s) => s.deleteAccount);
  const exportAccountData = useAccountStore((s) => s.exportAccountData);
  const requestEmailVerification = useAccountStore((s) => s.requestEmailVerification);

  const [busy, setBusy] = useState<null | string>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [pwEmail, setPwEmail] = useState(profile?.email ?? '');
  const [pwError, setPwError] = useState('');

  const handleVerifyEmail = useCallback(async () => {
    if (busy) return;
    setBusy('verify');
    try {
      const result = await requestEmailVerification();
      if (result.ok) {
        showToast(cs.account.verifyEmailRequestedToast);
      } else {
        showToast(result.detail || cs.account.errorGeneric);
      }
    } finally {
      setBusy(null);
    }
  }, [busy, requestEmailVerification, showToast]);

  const handleLink = useCallback(
    async (provider: 'google' | 'apple') => {
      if (busy) return;
      setBusy(`link_${provider}`);
      try {
        const result = provider === 'google' ? await linkGoogle() : await linkApple();
        if (result.ok) {
          showToast(
            provider === 'google' ? cs.account.linkedGoogleToast : cs.account.linkedAppleToast,
          );
        } else if (result.code !== 'cancelled') {
          showToast(result.detail || cs.account.errorGeneric);
        }
      } finally {
        setBusy(null);
      }
    },
    [busy, linkGoogle, linkApple, showToast],
  );

  const handleUnlink = useCallback(
    async (provider: AuthProvider) => {
      if (busy) return;
      setBusy(`unlink_${provider}`);
      try {
        const result = await unlink(provider);
        if (result.ok) {
          showToast(cs.account.unlinkedToast);
        } else {
          // last_credential (or any other error) → show its detail.
          showToast(result.detail || cs.account.errorGeneric);
        }
      } finally {
        setBusy(null);
      }
    },
    [busy, unlink, showToast],
  );

  const handleSetPassword = useCallback(async () => {
    if (busy) return;
    if (newPassword.length < MIN_PASSWORD) {
      setPwError(cs.account.errorPasswordShort);
      return;
    }
    // An email is required only when the account has none yet (e.g. a social-only
    // sign-up). When the profile already carries one, send it unchanged.
    const hasProfileEmail = !!profile?.email;
    const email = pwEmail.trim();
    if (!hasProfileEmail && !EMAIL_RE.test(email)) {
      setPwError(cs.account.errorEmailInvalid);
      return;
    }
    setPwError('');
    setBusy('setPassword');
    try {
      const result = await setPassword({
        password: newPassword,
        email: hasProfileEmail ? undefined : email,
      });
      if (result.ok) {
        setPwOpen(false);
        setNewPassword('');
        showToast(cs.account.setPasswordToast);
      } else {
        setPwError(result.detail || cs.account.errorGeneric);
      }
    } finally {
      setBusy(null);
    }
  }, [busy, newPassword, pwEmail, profile?.email, setPassword, showToast]);

  const handleLogout = useCallback(async () => {
    if (busy) return;
    setBusy('logout');
    await logout();
    setBusy(null);
    router.back();
  }, [busy, logout, router]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      cs.account.deleteConfirmTitle,
      cs.account.deleteConfirmBody,
      [
        { text: cs.account.deleteConfirmCancel, style: 'cancel' },
        {
          text: cs.account.deleteConfirmConfirm,
          style: 'destructive',
          onPress: async () => {
            const result = await deleteAccount();
            showToast(result.ok ? cs.account.deleteToast : result.detail || cs.account.errorGeneric);
            if (result.ok) router.back();
          },
        },
      ],
      { cancelable: true },
    );
  }, [deleteAccount, showToast, router]);

  const handleExportData = useCallback(async () => {
    if (busy) return;
    setBusy('export');
    try {
      const result = await exportAccountData();
      if (result.ok) {
        showToast(cs.account.exportDataToast(result.filename));
        Alert.alert(
          cs.account.exportDataSavedTitle,
          cs.account.exportDataSavedBody(result.uri),
        );
      } else {
        showToast(result.detail || cs.account.errorGeneric);
      }
    } finally {
      setBusy(null);
    }
  }, [busy, exportAccountData, showToast]);

  // The screen is only reachable while signed in; guard defensively so a logout
  // racing with navigation never crashes on a null profile. (Placed after every
  // hook so hook order stays stable across renders.)
  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea} edges={[]}>
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
          <Text style={styles.headerTitle}>{cs.account.accountTitle}</Text>
          <View style={styles.headerSpacer} />
        </View>
      </SafeAreaView>
    );
  }

  const providers = profile.providers;
  const hasEmail = providers.includes('email');
  const hasGoogle = providers.includes('google');
  const hasApple = providers.includes('apple');
  const appleSupported = isAppleSignInSupported();
  // Only credentials count as removable methods; an account must always keep at
  // least one. The backend enforces this too (last_credential), but disabling
  // the affordance avoids a confusing tap.
  const canUnlink = providers.length > 1;

  const displayTitle = profile.displayName.trim() || profile.email || cs.account.anonymousName;

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
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
        <Text style={styles.headerTitle}>{cs.account.accountTitle}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity card ── */}
        <View style={styles.identityCard}>
          <Pressable
            onPress={() => router.push('/profile/edit')}
            style={({ pressed }) => [styles.avatarWrap, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.profileEdit}
            hitSlop={6}
          >
            <Avatar uri={avatarUrl} nickname={nickname} displayName={profile.displayName} size={72} />
            <View style={styles.avatarEditBadge}>
              <PencilIcon size={13} color={Colors.stout} />
            </View>
          </Pressable>
          <Text style={styles.identityName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {nickname ? `@${nickname}` : displayTitle}
          </Text>
          {!!profile.email && (
            <Text style={styles.identityEmail} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {profile.email}
            </Text>
          )}
          {!!profile.email &&
            (profile.emailVerified ? (
              <View style={styles.verifiedBadge}>
                <CheckIcon size={14} color={Colors.success} />
                <Text style={styles.verifiedText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.account.emailVerified}
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={handleVerifyEmail}
                style={({ pressed }) => [styles.verifyCta, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.accountVerifyEmail}
                hitSlop={6}
              >
                {busy === 'verify' ? (
                  <ActivityIndicator size="small" color={Colors.amber} />
                ) : (
                  <MailIcon size={14} color={Colors.amber} />
                )}
                <Text style={styles.verifyCtaText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.account.verifyEmailCta}
                </Text>
              </Pressable>
            ))}
        </View>

        {/* ── Sign-in methods ── */}
        <Text style={styles.sectionHeader}>{cs.account.methodsHeader}</Text>
        <View style={styles.methodsCard}>
          <MethodRow
            icon={<KeyRoundIcon size={18} color={Colors.foamMuted} />}
            title={cs.account.methodEmail}
            linked={hasEmail}
            // Email cannot be "linked" via a native sheet; offer "Nastavit heslo"
            // instead when it is missing.
            onLink={hasEmail ? undefined : () => setPwOpen(true)}
            linkLabel={cs.account.setPasswordCta}
            onUnlink={hasEmail && canUnlink ? () => handleUnlink('email') : undefined}
            busy={busy === 'unlink_email'}
            providerName={cs.account.methodEmail}
          />
          <MethodRow
            icon={<GoogleIcon size={18} color={Colors.foamMuted} />}
            title={cs.account.methodGoogle}
            linked={hasGoogle}
            onLink={hasGoogle ? undefined : () => handleLink('google')}
            onUnlink={hasGoogle && canUnlink ? () => handleUnlink('google') : undefined}
            busy={busy === 'link_google' || busy === 'unlink_google'}
            providerName={cs.account.methodGoogle}
            borderTop
          />
          {appleSupported && (
            <MethodRow
              icon={<AppleIcon size={18} color={Colors.foamMuted} />}
              title={cs.account.methodApple}
              linked={hasApple}
              onLink={hasApple ? undefined : () => handleLink('apple')}
              onUnlink={hasApple && canUnlink ? () => handleUnlink('apple') : undefined}
              busy={busy === 'link_apple' || busy === 'unlink_apple'}
              providerName={cs.account.methodApple}
              borderTop
            />
          )}
        </View>

        {/* ── Set password form ── */}
        {pwOpen && (
          <View style={styles.pwCard}>
            <Text style={styles.pwHeader}>{cs.account.setPasswordHeader}</Text>
            {!profile.email && (
              <TextInput
                style={styles.input}
                value={pwEmail}
                onChangeText={setPwEmail}
                placeholder={cs.account.emailPlaceholder}
                placeholderTextColor={Colors.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                accessibilityLabel={cs.a11y.authEmailInput}
                maxFontSizeMultiplier={FontScaleCap.body}
              />
            )}
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={(value) => {
                setNewPassword(value);
                if (pwError) setPwError('');
              }}
              placeholder={cs.account.passwordPlaceholder}
              placeholderTextColor={Colors.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              accessibilityLabel={cs.a11y.authNewPasswordInput}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            {!!pwError && (
              <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
                {pwError}
              </Text>
            )}
            <GlowButton
              label={busy === 'setPassword' ? cs.account.loading : cs.account.setPasswordSave}
              onPress={handleSetPassword}
              variant="secondary"
              glow="none"
              height={52}
              accessibilityLabel={cs.a11y.accountSetPassword}
            />
          </View>
        )}

        {/* ── Data ── */}
        <Text style={styles.sectionHeader}>{cs.account.dataHeader}</Text>
        <View style={styles.methodsCard}>
          <AccountActionRow
            icon={<DownloadIcon size={18} color={Colors.foamMuted} />}
            title={cs.account.exportData}
            subtitle={cs.account.exportDataSubtitle}
            onPress={handleExportData}
            busy={busy === 'export'}
            accessibilityLabel={cs.a11y.accountExportData}
          />
        </View>

        {/* ── Sign out ── */}
        <View style={styles.logoutButton}>
          <GlowButton
            label={busy === 'logout' ? cs.account.loading : cs.account.logout}
            onPress={handleLogout}
            variant="secondary"
            glow="none"
            accessibilityLabel={cs.a11y.accountLogout}
          />
        </View>

        {/* ── Danger zone ── */}
        <Text style={styles.sectionHeader}>{cs.account.dangerHeader}</Text>
        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [styles.dangerRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.accountDelete}
        >
          <Text style={styles.dangerText} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.account.deleteAccount}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Method row — one sign-in provider with link / unlink affordances.
// ---------------------------------------------------------------------------

interface MethodRowProps {
  icon: React.ReactNode;
  title: string;
  linked: boolean;
  providerName: string;
  onLink?: () => void;
  linkLabel?: string;
  onUnlink?: () => void;
  busy?: boolean;
  borderTop?: boolean;
}

function MethodRow({
  icon,
  title,
  linked,
  providerName,
  onLink,
  linkLabel,
  onUnlink,
  busy,
  borderTop,
}: MethodRowProps) {
  return (
    <View style={[styles.methodRow, borderTop && styles.methodRowBorderTop]}>
      <View style={styles.methodIconWell}>{icon}</View>
      <Text style={styles.methodTitle} maxFontSizeMultiplier={FontScaleCap.body}>
        {title}
      </Text>

      {busy ? (
        <ActivityIndicator size="small" color={Colors.amber} />
      ) : (
        <View style={styles.methodRight}>
          {linked && (
            <View style={styles.methodLinked}>
              <CheckIcon size={16} color={Colors.success} />
            </View>
          )}
          {linked && onUnlink && (
            <Pressable
              onPress={onUnlink}
              style={({ pressed }) => [styles.methodAction, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.accountUnlinkProvider(providerName)}
              hitSlop={6}
            >
              <Text style={styles.methodActionText}>{cs.account.unlinkCta}</Text>
            </Pressable>
          )}
          {!linked && onLink && (
            <Pressable
              onPress={onLink}
              style={({ pressed }) => [
                styles.methodAction,
                styles.methodActionLink,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.accountLinkProvider(providerName)}
              hitSlop={6}
            >
              <LinkIcon size={14} color={Colors.amber} />
              <Text style={styles.methodActionLinkText}>{linkLabel ?? cs.account.linkCta}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

interface AccountActionRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  rightIcon?: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  busy?: boolean;
  borderTop?: boolean;
}

function AccountActionRow({
  icon,
  title,
  subtitle,
  rightIcon,
  onPress,
  accessibilityLabel,
  busy,
  borderTop,
}: AccountActionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.actionRow,
        borderTop && styles.methodRowBorderTop,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.methodIconWell}>{icon}</View>
      <View style={styles.actionText}>
        <Text style={styles.methodTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.actionSubtitle} maxFontSizeMultiplier={FontScaleCap.body}>
            {subtitle}
          </Text>
        )}
      </View>
      {busy ? <ActivityIndicator size="small" color={Colors.amber} /> : rightIcon}
    </Pressable>
  );
}

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

  // ── Scroll ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },

  // ── Identity card ──
  identityCard: {
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  avatarWrap: {
    marginBottom: Spacing.xs,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: Colors.stout2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
  },
  identityEmail: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.success, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.success, 0.4),
  },
  verifiedText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.success,
  },
  verifyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.xs,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  verifyCtaText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  // ── Section header ──
  sectionHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.sm,
    marginLeft: Spacing.xs,
  },

  // ── Methods card ──
  methodsCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 60,
  },
  methodRowBorderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  methodIconWell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTitle: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  methodRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  methodLinked: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.success, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
  },
  methodActionText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  methodActionLink: {
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  methodActionLinkText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 64,
  },
  actionText: {
    flex: 1,
    gap: 3,
  },
  actionSubtitle: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
  },

  // ── Set password form ──
  pwCard: {
    gap: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: withAlpha(Colors.stout2, 0.78),
    padding: Spacing.lg,
  },
  pwHeader: {
    fontFamily: Fonts.display.bold,
    fontSize: 18,
    color: Colors.foam,
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

  // ── Sign out ──
  logoutButton: {
    marginTop: Spacing.sm,
  },

  // ── Danger zone ──
  dangerRow: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.glow, 0.4),
    backgroundColor: withAlpha(Colors.glow, 0.08),
  },
  dangerText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.glow,
  },

  pressed: {
    opacity: 0.7,
  },
});
