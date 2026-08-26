/**
 * Account management in the Tácek composition.
 *
 * The surface stays deliberately calm: identity and credential facts live in
 * one card, the one amber action owns sign-in methods, sign-out stays quietly
 * under the thumb, and export/deletion live in the shared overflow sheet.
 * Store calls remain in this screen; the extracted sheets are presentational.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoginMethodsSheet } from '@/account/LoginMethodsSheet';
import { PasswordSheet } from '@/account/PasswordSheet';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import {
  ChevronLeftIcon,
  MenuIcon,
  Share2Icon,
  Trash2Icon,
} from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { CounterCta } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { isAppleSignInSupported } from '@/data/socialAuth';
import type { AuthProvider } from '@/data/auth';
import { cs } from '@/i18n/cs';
import { Avatar } from '@/profile/Avatar';
import {
  selectAvatarUrl,
  selectIsSignedIn,
  selectNickname,
  useAccountStore,
} from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHEET_DISMISS_MS = 260;

/** DESIGN §6.2: the secondary action is a quiet `stout3` pill, never an
 *  outline. Same shape as `PrivacyScreen`'s full-policy button. */
function QuietPill({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.quietPill,
        pressed && !disabled && styles.quietPillPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Text
        style={styles.quietPillLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function providerName(provider: AuthProvider): string {
  if (provider === 'email') return cs.account.methodEmail;
  if (provider === 'google') return cs.account.methodGoogle;
  return cs.account.methodApple;
}

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);

  const profile = useAccountStore((state) => state.profile);
  const signedIn = useAccountStore(selectIsSignedIn);
  const nickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const linkGoogle = useAccountStore((state) => state.linkGoogle);
  const linkApple = useAccountStore((state) => state.linkApple);
  const unlink = useAccountStore((state) => state.unlink);
  const setPassword = useAccountStore((state) => state.setPassword);
  const logout = useAccountStore((state) => state.logout);
  const deleteAccount = useAccountStore((state) => state.deleteAccount);
  const exportAccountData = useAccountStore(
    (state) => state.exportAccountData,
  );
  const requestEmailVerification = useAccountStore(
    (state) => state.requestEmailVerification,
  );
  const refreshProfile = useAccountStore((state) => state.refreshProfile);

  const [busy, setBusy] = useState<string | null>(null);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dismissedNudge, setDismissedNudge] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordEmail, setPasswordEmail] = useState(profile?.email ?? '');
  const [passwordError, setPasswordError] = useState('');
  const [profileRetrying, setProfileRetrying] = useState(false);
  const sheetActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef<string | null>(null);
  const profileRetryingRef = useRef(false);

  const startBusy = useCallback((operation: string): boolean => {
    if (busyRef.current) return false;
    busyRef.current = operation;
    setBusy(operation);
    return true;
  }, []);

  const finishBusy = useCallback((operation: string) => {
    if (busyRef.current !== operation) return;
    busyRef.current = null;
    setBusy(null);
  }, []);

  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)' as Href);
    }
  }, [router]);

  const providers = useMemo(
    () => profile?.providers ?? [],
    [profile?.providers],
  );
  const hasEmail = providers.includes('email');
  const isClaimed = providers.length > 0;
  const appleSupported = isAppleSignInSupported();
  const logoutBusy = busy === 'logout';

  const runAfterSheetClose = useCallback((action: () => void) => {
    setMethodsOpen(false);
    setMoreOpen(false);
    if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
    sheetActionTimer.current = setTimeout(() => {
      sheetActionTimer.current = null;
      action();
    }, SHEET_DISMISS_MS);
  }, []);

  useEffect(
    () => () => {
      if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
    },
    [],
  );

  const openPasswordSheet = useCallback(() => {
    setPasswordError('');
    setPasswordEmail(profile?.email ?? '');
    setPasswordOpen(true);
  }, [profile?.email]);

  const handleVerifyEmail = useCallback(async () => {
    if (!startBusy('verify')) return;
    try {
      const result = await requestEmailVerification();
      showToast(
        result.ok
          ? cs.account.verifyEmailRequestedToast
          : result.detail || cs.account.errorGeneric,
      );
    } finally {
      finishBusy('verify');
    }
  }, [finishBusy, requestEmailVerification, showToast, startBusy]);

  const handleLink = useCallback(
    async (provider: 'google' | 'apple') => {
      const operation = `link_${provider}`;
      if (!startBusy(operation)) return;
      try {
        const result =
          provider === 'google' ? await linkGoogle() : await linkApple();
        if (result.ok) {
          showToast(
            provider === 'google'
              ? cs.account.linkedGoogleToast
              : cs.account.linkedAppleToast,
          );
        } else if (result.code !== 'cancelled') {
          showToast(result.detail || cs.account.errorGeneric);
        }
      } finally {
        finishBusy(operation);
      }
    },
    [finishBusy, linkApple, linkGoogle, showToast, startBusy],
  );

  const handleUnlink = useCallback(
    async (provider: AuthProvider) => {
      const operation = `unlink_${provider}`;
      if (!startBusy(operation)) return;
      try {
        const result = await unlink(provider);
        showToast(
          result.ok
            ? cs.account.unlinkedToast
            : result.detail || cs.account.errorGeneric,
        );
      } finally {
        finishBusy(operation);
      }
    },
    [finishBusy, showToast, startBusy, unlink],
  );

  const confirmUnlink = useCallback(
    (provider: AuthProvider) => {
      const name = providerName(provider);
      runAfterSheetClose(() => {
        showAppDialog({
          title: cs.account.unlinkConfirmTitle(name),
          message: cs.account.unlinkConfirmBody,
          buttons: [
            { text: cs.account.deleteConfirmCancel, style: 'cancel' },
            {
              text: cs.account.unlinkCta,
              style: 'destructive',
              onPress: () => void handleUnlink(provider),
            },
          ],
          cancelable: true,
        });
      });
    },
    [handleUnlink, runAfterSheetClose],
  );

  const handleSetPassword = useCallback(async () => {
    if (busyRef.current) return;
    if (newPassword.length < MIN_PASSWORD) {
      setPasswordError(cs.account.errorPasswordShort);
      return;
    }

    const hasProfileEmail = !!profile?.email;
    const email = passwordEmail.trim();
    if (!hasProfileEmail && !EMAIL_RE.test(email)) {
      setPasswordError(cs.account.errorEmailInvalid);
      return;
    }

    if (!startBusy('setPassword')) return;
    setPasswordError('');
    try {
      const result = await setPassword({
        password: newPassword,
        email: hasProfileEmail ? undefined : email,
      });
      if (result.ok) {
        setPasswordOpen(false);
        setNewPassword('');
        showToast(cs.account.setPasswordToast);
      } else {
        setPasswordError(result.detail || cs.account.errorGeneric);
      }
    } finally {
      finishBusy('setPassword');
    }
  }, [
    finishBusy,
    newPassword,
    passwordEmail,
    profile?.email,
    setPassword,
    showToast,
    startBusy,
  ]);

  const handleLogout = useCallback(async () => {
    if (!startBusy('logout')) return;
    try {
      const result = await logout();
      if (!result.ok) {
        showToast(result.detail || cs.account.errorGeneric);
        return;
      }
      leave();
    } finally {
      finishBusy('logout');
    }
  }, [finishBusy, leave, logout, showToast, startBusy]);

  const handleRetryProfile = useCallback(async () => {
    if (profileRetryingRef.current) return;
    profileRetryingRef.current = true;
    setProfileRetrying(true);
    try {
      await refreshProfile();
    } finally {
      profileRetryingRef.current = false;
      setProfileRetrying(false);
    }
  }, [refreshProfile]);

  const handleDelete = useCallback(() => {
    if (busyRef.current) return;
    showAppDialog({
      title: cs.account.deleteConfirmTitle,
      message: isClaimed
        ? cs.account.deleteConfirmBody
        : cs.account.deleteAnonymousConfirmBody,
      buttons: [
        { text: cs.account.deleteConfirmCancel, style: 'cancel' },
        {
          text: cs.account.deleteConfirmConfirm,
          style: 'destructive',
          onPress: async () => {
            if (!startBusy('delete')) return;
            try {
              const result = await deleteAccount();
              showToast(
                result.ok
                  ? cs.account.deleteToast
                  : result.detail || cs.account.errorGeneric,
              );
              if (result.ok) leave();
            } finally {
              finishBusy('delete');
            }
          },
        },
      ],
      cancelable: true,
    });
  }, [deleteAccount, finishBusy, isClaimed, leave, showToast, startBusy]);

  const handleExportData = useCallback(async () => {
    if (!startBusy('export')) return;
    setMoreOpen(false);
    try {
      const result = await exportAccountData();
      showToast(
        result.ok
          ? cs.account.exportDataToast
          : result.detail || cs.account.errorGeneric,
      );
    } finally {
      finishBusy('export');
    }
  }, [exportAccountData, finishBusy, showToast, startBusy]);

  const nudge = useMemo<Nudge | null>(() => {
    if (
      profile?.email &&
      !profile.emailVerified &&
      dismissedNudge !== 'verify'
    ) {
      return {
        kind: 'checkin',
        text: cs.account.nudgeVerify,
        ctaLabel:
          busy === 'verify' ? cs.account.loading : cs.account.nudgeVerifyCta,
        onPress: () => void handleVerifyEmail(),
        onDismiss: () => setDismissedNudge('verify'),
      };
    }

    if (
      providers.length === 1 &&
      !hasEmail &&
      dismissedNudge !== 'single-method'
    ) {
      const onlyProvider = providerName(providers[0]);
      return {
        kind: 'checkin',
        text: cs.account.nudgeSingleMethod(onlyProvider),
        ctaLabel: cs.account.setPasswordCta,
        onPress: () => runAfterSheetClose(openPasswordSheet),
        onDismiss: () => setDismissedNudge('single-method'),
      };
    }

    if (busy === 'export') {
      return {
        kind: 'dopito',
        label: cs.account.exportRunning,
        onPress: () => undefined,
      };
    }

    return null;
  }, [
    busy,
    dismissedNudge,
    handleVerifyEmail,
    hasEmail,
    openPasswordSheet,
    profile?.email,
    profile?.emailVerified,
    providers,
    runAfterSheetClose,
  ]);

  const linkedMethods = useMemo(
    () => providers.map(providerName).join(' · '),
    [providers],
  );

  const moreRows = useMemo<MoreRow[]>(
    () => [
      {
        key: 'export',
        label: cs.account.exportData,
        icon: Share2Icon,
        onPress: () => void handleExportData(),
        accessibilityLabel: cs.a11y.accountExportData,
      },
      {
        key: 'delete',
        label: cs.account.deleteAccount,
        icon: Trash2Icon,
        onPress: () => runAfterSheetClose(handleDelete),
        accessibilityLabel: cs.a11y.accountDelete,
      },
    ],
    [handleDelete, handleExportData, runAfterSheetClose],
  );

  const handleLinkFromSheet = useCallback(
    (provider: 'google' | 'apple') => {
      runAfterSheetClose(() => void handleLink(provider));
    },
    [handleLink, runAfterSheetClose],
  );

  const handlePasswordFromSheet = useCallback(() => {
    runAfterSheetClose(openPasswordSheet);
  }, [openPasswordSheet, runAfterSheetClose]);

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={leave}
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={cs.a11y.backButton}
      >
        <ChevronLeftIcon size={22} color={Colors.foam} />
      </Pressable>
      <Text
        style={styles.headerTitle}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {cs.account.accountTitle}
      </Text>
      <View style={styles.headerSpacer} />
      {profile ? (
        <Pressable
          onPress={() => setMoreOpen(true)}
          style={({ pressed }) => [
            styles.moreButton,
            pressed && styles.pressed,
          ]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.accountMore}
        >
          <MenuIcon size={20} color={Colors.mutedText} />
        </Pressable>
      ) : null}
    </View>
  );

  // Every hook stays above this guard: logout and deletion both update the
  // profile before navigation has necessarily finished.
  if (!profile) {
    return (
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + 8,
            paddingBottom: Math.max(insets.bottom, Spacing.sm),
          },
        ]}
      >
        {header}
        <View style={styles.unavailableState}>
          <Text
            style={styles.unavailableText}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.account.accountLoadError}
          </Text>
          <CounterCta
            label={profileRetrying ? cs.account.loading : cs.account.accountRetry}
            subLabel={null}
            onPress={() => void handleRetryProfile()}
            accessibilityLabel={
              profileRetrying ? cs.account.loading : cs.a11y.accountRetry
            }
            disabled={profileRetrying || busy === 'logout'}
          />
          <QuietPill
            label={
              logoutBusy
                ? cs.account.loading
                : signedIn
                  ? cs.account.logout
                  : cs.account.resetInvalidCta
            }
            onPress={() => {
              if (logoutBusy) return;
              if (signedIn) {
                void handleLogout();
              } else {
                leave();
              }
            }}
            accessibilityLabel={
              logoutBusy
                ? cs.account.loading
                : signedIn
                  ? cs.a11y.accountLogout
                  : cs.a11y.backButton
            }
            disabled={logoutBusy}
          />
        </View>
      </View>
    );
  }

  const displayName = profile.displayName.trim();
  const identityName =
    (nickname ? `@${nickname}` : '') ||
    displayName ||
    profile.email ||
    cs.account.anonymousName;
  const identityCaption =
    nickname && displayName && `@${nickname}` !== displayName
      ? displayName
      : null;

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      {header}

      <View
        style={styles.accountCard}
        accessibilityRole="text"
        accessibilityLabel={cs.a11y.accountIdentity(
          identityName,
          profile.email,
          linkedMethods,
        )}
      >
        <View style={styles.cardBody}>
          <Avatar
            uri={avatarUrl}
            nickname={nickname}
            displayName={profile.displayName}
            size={64}
            border="quiet"
          />
          <View style={styles.identity}>
            <Text
              style={styles.identityName}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {identityName}
            </Text>
            {identityCaption ? (
              <Text
                style={styles.identityMeta}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {identityCaption}
              </Text>
            ) : null}
            {profile.email ? (
              <Text
                style={styles.identityMeta}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {profile.email}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text
            style={styles.linkedMethods}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {isClaimed ? linkedMethods : cs.account.anonymousName}
          </Text>
          <Text
            style={styles.verification}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {!isClaimed
              ? cs.account.anonymousDataNote
              : profile.email
                ? profile.emailVerified
                  ? cs.account.emailVerified
                  : cs.account.emailUnverified
                : cs.account.emailMissing}
          </Text>
        </View>
      </View>

      <View style={styles.spacer} />

      <NudgeSlot nudge={nudge} />

      <CounterCta
        label={cs.account.ctaMethods}
        subLabel={null}
        onPress={() => setMethodsOpen(true)}
        accessibilityLabel={cs.a11y.accountMethods}
      />

      {isClaimed ? (
        <QuietPill
          label={logoutBusy ? cs.account.loading : cs.account.logout}
          onPress={() => void handleLogout()}
          accessibilityLabel={
            logoutBusy ? cs.account.loading : cs.a11y.accountLogout
          }
          disabled={logoutBusy}
        />
      ) : null}

      <LoginMethodsSheet
        visible={methodsOpen}
        providers={providers}
        appleSupported={appleSupported}
        busy={busy}
        onClose={() => setMethodsOpen(false)}
        onSetPassword={handlePasswordFromSheet}
        onLink={handleLinkFromSheet}
        onUnlink={confirmUnlink}
      />

      <PasswordSheet
        visible={passwordOpen}
        hasProfileEmail={!!profile.email}
        email={passwordEmail}
        password={newPassword}
        error={passwordError}
        busy={busy === 'setPassword'}
        onChangeEmail={(value) => {
          setPasswordEmail(value);
          if (passwordError) setPasswordError('');
        }}
        onChangePassword={(value) => {
          setNewPassword(value);
          if (passwordError) setPasswordError('');
        }}
        onSave={() => void handleSetPassword()}
        onClose={() => setPasswordOpen(false)}
      />

      <MoreSheet
        visible={moreOpen}
        title={cs.account.moreTitle}
        rows={moreRows}
        onClose={() => setMoreOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 20,
    gap: 12,
  },
  header: {
    minHeight: 44,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
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
    marginLeft: 12,
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  headerSpacer: {
    flex: 1,
  },
  moreButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountCard: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  identity: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  identityName: {
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  identityMeta: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  cardFooter: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  linkedMethods: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  verification: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  spacer: {
    flex: 1,
  },
  quietPill: {
    minHeight: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  quietPillPressed: {
    opacity: 0.65,
  },
  quietPillLabel: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.foam,
    includeFontPadding: false,
  },
  unavailableState: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.md,
  },
  unavailableText: {
    fontWeight: '500',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
