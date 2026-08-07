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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoginMethodsSheet } from '@/account/LoginMethodsSheet';
import { PasswordSheet } from '@/account/PasswordSheet';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import {
  ChevronLeftIcon,
  MenuIcon,
  MailIcon,
  Trash2Icon,
} from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { CounterCta, CounterSecondary } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { isAppleSignInSupported } from '@/data/socialAuth';
import type { AuthProvider } from '@/data/auth';
import { cs } from '@/i18n/cs';
import { Avatar } from '@/profile/Avatar';
import {
  selectAvatarUrl,
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

  const [busy, setBusy] = useState<string | null>(null);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dismissedNudge, setDismissedNudge] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordEmail, setPasswordEmail] = useState(profile?.email ?? '');
  const [passwordError, setPasswordError] = useState('');
  const sheetActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const providers = useMemo(
    () => profile?.providers ?? [],
    [profile?.providers],
  );
  const hasEmail = providers.includes('email');
  const appleSupported = isAppleSignInSupported();

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
    if (busy) return;
    setBusy('verify');
    try {
      const result = await requestEmailVerification();
      showToast(
        result.ok
          ? cs.account.verifyEmailRequestedToast
          : result.detail || cs.account.errorGeneric,
      );
    } finally {
      setBusy(null);
    }
  }, [busy, requestEmailVerification, showToast]);

  const handleLink = useCallback(
    async (provider: 'google' | 'apple') => {
      if (busy) return;
      setBusy(`link_${provider}`);
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
        setBusy(null);
      }
    },
    [busy, linkApple, linkGoogle, showToast],
  );

  const handleUnlink = useCallback(
    async (provider: AuthProvider) => {
      if (busy) return;
      setBusy(`unlink_${provider}`);
      try {
        const result = await unlink(provider);
        showToast(
          result.ok
            ? cs.account.unlinkedToast
            : result.detail || cs.account.errorGeneric,
        );
      } finally {
        setBusy(null);
      }
    },
    [busy, showToast, unlink],
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
    if (busy) return;
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

    setPasswordError('');
    setBusy('setPassword');
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
      setBusy(null);
    }
  }, [
    busy,
    newPassword,
    passwordEmail,
    profile?.email,
    setPassword,
    showToast,
  ]);

  const handleLogout = useCallback(async () => {
    if (busy) return;
    setBusy('logout');
    try {
      const result = await logout();
      if (!result.ok) {
        showToast(result.detail || cs.account.errorGeneric);
        return;
      }
      router.back();
    } finally {
      setBusy(null);
    }
  }, [busy, logout, router, showToast]);

  const handleDelete = useCallback(() => {
    showAppDialog({
      title: cs.account.deleteConfirmTitle,
      message: cs.account.deleteConfirmBody,
      buttons: [
        { text: cs.account.deleteConfirmCancel, style: 'cancel' },
        {
          text: cs.account.deleteConfirmConfirm,
          style: 'destructive',
          onPress: async () => {
            if (busy) return;
            setBusy('delete');
            try {
              const result = await deleteAccount();
              showToast(
                result.ok
                  ? cs.account.deleteToast
                  : result.detail || cs.account.errorGeneric,
              );
              if (result.ok) router.back();
            } finally {
              setBusy(null);
            }
          },
        },
      ],
      cancelable: true,
    });
  }, [busy, deleteAccount, router, showToast]);

  const handleExportData = useCallback(async () => {
    if (busy) return;
    setMoreOpen(false);
    setBusy('export');
    try {
      const result = await exportAccountData();
      showToast(
        result.ok
          ? cs.account.exportDataToast
          : result.detail || cs.account.errorGeneric,
      );
    } finally {
      setBusy(null);
    }
  }, [busy, exportAccountData, showToast]);

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
        icon: MailIcon,
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
        onPress={() => router.back()}
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
            {linkedMethods}
          </Text>
          <Text
            style={styles.verification}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {profile.email
              ? profile.emailVerified
                ? cs.account.emailVerified
                : cs.account.emailUnverified
              : cs.account.emailMissing}
          </Text>
        </View>
      </View>

      <NudgeSlot nudge={nudge} />

      <CounterCta
        label={cs.account.ctaMethods}
        subLabel={null}
        onPress={() => setMethodsOpen(true)}
        accessibilityLabel={cs.a11y.accountMethods}
      />

      <CounterSecondary
        label={busy === 'logout' ? cs.account.loading : cs.account.logout}
        onPress={() => void handleLogout()}
        accessibilityLabel={cs.a11y.accountLogout}
      />

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
    paddingHorizontal: 24,
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
    flex: 1,
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  cardBody: {
    flex: 1,
    minHeight: 132,
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
    marginTop: 20,
    paddingTop: 12,
    paddingBottom: 8,
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
  pressed: {
    opacity: 0.6,
  },
});
