/**
 * Edit profile (route `/profile/edit`) — a single scrollable form (not a wizard)
 * that lets a signed-in user change their avatar, nickname, real name, and
 * visibility in one place. Presented as a fullScreenModal sliding up from the
 * bottom.
 *
 * Cards:
 *   1. Avatar — current image + "Změnit fotku" (pick → upload) + "Odebrat fotku".
 *   2. Nickname — the shared "@" field with live availability; pre-filled, and
 *      the availability call is skipped while the value is unchanged.
 *   3. Jméno (nepovinné) — free-text display name.
 *   4. Viditelnost — toggle + short GDPR copy.
 *
 * "Uložit" PATCHes only the changed fields, shows the "Profil uložen" toast, and
 * pops back. Nickname errors are shown inline (not via toast). Avatar changes
 * apply immediately (their own endpoints) and are NOT part of the Uložit batch.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
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
import { ChevronLeftIcon, Trash2Icon, PencilIcon } from '@/components/shared/IconGlyph';
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
  selectIsPublic,
} from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';

export default function ProfileEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);

  const profile = useAccountStore((s) => s.profile);
  const initialNickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const initialIsPublic = useAccountStore(selectIsPublic);
  const updateProfile = useAccountStore((s) => s.updateProfile);
  const uploadAvatar = useAccountStore((s) => s.uploadAvatar);
  const removeAvatar = useAccountStore((s) => s.removeAvatar);

  const [nicknameInput, setNicknameInput] = useState(initialNickname ?? '');
  const [nicknameReady, setNicknameReady] = useState(true); // unchanged ⇒ ready
  const [nicknameError, setNicknameError] = useState('');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [isPublic, setIsPublic] = useState(initialIsPublic);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  // Permission permanently denied (canAskAgain=false) → offer Settings, not re-prompt.
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Avatar ──
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
      if (!result.ok) setAvatarError(result.detail || cs.profile.setup.avatarUploadError);
    } finally {
      setAvatarBusy(false);
    }
  }, [avatarBusy, uploadAvatar]);

  const handleRemoveAvatar = useCallback(async () => {
    if (avatarBusy) return;
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const result = await removeAvatar();
      if (!result.ok) setAvatarError(result.detail || cs.profile.edit.errorGeneric);
    } finally {
      setAvatarBusy(false);
    }
  }, [avatarBusy, removeAvatar]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (saving) return;

    const trimmedNickname = nicknameInput.trim();
    const trimmedName = displayName.trim();
    const nicknameChanged = trimmedNickname !== (initialNickname ?? '');
    const nameChanged = trimmedName !== (profile?.displayName ?? '').trim();
    const visibilityChanged = isPublic !== initialIsPublic;

    // A changed nickname must be submit-ready (valid + available).
    if (nicknameChanged && !nicknameReady) {
      setNicknameError(cs.profile.setup.nicknameInvalid);
      return;
    }

    // Nothing changed → just close.
    if (!nicknameChanged && !nameChanged && !visibilityChanged) {
      router.back();
      return;
    }

    const params: { nickname?: string; displayName?: string; isPublic?: boolean } = {};
    if (nicknameChanged) params.nickname = trimmedNickname;
    if (nameChanged) params.displayName = trimmedName;
    if (visibilityChanged) params.isPublic = isPublic;

    setNicknameError('');
    setSaving(true);
    try {
      const result = await updateProfile(params);
      if (result.ok) {
        showToast(cs.profile.edit.savedToast);
        router.back();
        return;
      }
      // Nickname conflicts surface inline; anything else is a generic inline note.
      // The backend may send a coded body (`nickname_taken`/`nickname_*`) or a
      // bare status (`http_409`/`http_4xx`).
      const isTaken = result.code === 'nickname_taken' || result.code === 'http_409';
      const isNicknameError =
        isTaken || result.code.startsWith('nickname_') || result.code.startsWith('http_4');
      if (nicknameChanged && isNicknameError) {
        setNicknameError(
          isTaken ? cs.profile.setup.nicknameTaken : result.detail || nicknameServerReasonMessage(result.code),
        );
      } else {
        setNicknameError(result.detail || cs.profile.edit.errorGeneric);
      }
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    nicknameInput,
    displayName,
    isPublic,
    nicknameReady,
    initialNickname,
    initialIsPublic,
    profile?.displayName,
    updateProfile,
    showToast,
    router,
  ]);

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.profileClose}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle}>{cs.profile.edit.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Avatar card ── */}
          <Text style={styles.sectionHeader}>{cs.profile.edit.avatarHeader}</Text>
          <View style={styles.avatarCard}>
            {/* The avatar itself is the primary tap target; the amber badge
                signals it opens the photo picker. */}
            <Pressable
              onPress={handlePickAvatar}
              disabled={avatarBusy}
              style={({ pressed }) => [styles.avatarTap, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.profilePickPhoto}
            >
              <Avatar
                uri={avatarUrl}
                nickname={initialNickname}
                displayName={profile?.displayName}
                size={104}
              />
              <View style={styles.avatarBadge}>
                {avatarBusy ? (
                  <ActivityIndicator size="small" color={Colors.stout} />
                ) : (
                  <PencilIcon size={15} color={Colors.stout} />
                )}
              </View>
            </Pressable>
            <View style={styles.avatarActions}>
              <Pressable
                onPress={handlePickAvatar}
                style={({ pressed }) => [styles.avatarBtn, styles.avatarBtnPrimary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.profilePickPhoto}
                disabled={avatarBusy}
              >
                <Text style={styles.avatarBtnPrimaryText}>{cs.profile.edit.changePhoto}</Text>
              </Pressable>
              {!!avatarUrl && (
                <Pressable
                  onPress={handleRemoveAvatar}
                  style={({ pressed }) => [styles.avatarBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.profileRemovePhoto}
                  disabled={avatarBusy}
                >
                  <Trash2Icon size={15} color={Colors.mutedText} />
                  <Text style={styles.avatarBtnText}>{cs.profile.edit.removePhoto}</Text>
                </Pressable>
              )}
            </View>
          </View>
          {!!avatarError && (
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {avatarError}
            </Text>
          )}
          {permissionBlocked && (
            <Pressable
              onPress={() => void Linking.openSettings()}
              style={({ pressed }) => [styles.avatarBtn, styles.avatarBtnPrimary, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.profile.setup.openSettings}
            >
              <Text style={styles.avatarBtnPrimaryText}>{cs.profile.setup.openSettings}</Text>
            </Pressable>
          )}

          {/* ── Nickname ── */}
          <Text style={styles.sectionHeader}>{cs.profile.edit.nicknameHeader}</Text>
          <NicknameField
            value={nicknameInput}
            onChangeText={(value) => {
              setNicknameInput(value);
              if (nicknameError) setNicknameError('');
            }}
            initialValue={initialNickname ?? ''}
            onReadyChange={setNicknameReady}
          />
          {!!nicknameError && (
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {nicknameError}
            </Text>
          )}

          {/* ── Display name ── */}
          <Text style={styles.sectionHeader}>{cs.profile.edit.displayNameHeader}</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={cs.profile.edit.displayNamePlaceholder}
            placeholderTextColor={Colors.mutedText}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={120}
            accessibilityLabel={cs.a11y.profileDisplayNameInput}
            maxFontSizeMultiplier={FontScaleCap.body}
          />

          {/* ── Visibility ── */}
          <Text style={styles.sectionHeader}>{cs.profile.edit.visibilityHeader}</Text>
          <View style={styles.consentCard}>
            <VisibilityToggle
              value={isPublic}
              onToggle={setIsPublic}
              label={cs.profile.edit.visibilityToggleLabel}
              accessibilityLabel={cs.a11y.profileVisibilityToggle(
                isPublic ? cs.a11y.toggleOn : cs.a11y.toggleOff,
              )}
            />
            <View style={styles.consentDivider} />
            <Text style={styles.consentText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.profile.edit.consent}
            </Text>
            {!isPublic && (
              <Text style={styles.consentPrivate} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.profile.edit.consentPrivate}
              </Text>
            )}
          </View>
        </ScrollView>

        {/* ── Sticky save bar — primary action always reachable, never lost
            below the fold of a long form. ── */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <GlowButton
            label={saving ? cs.profile.edit.saving : cs.profile.edit.save}
            onPress={handleSave}
            glow={saving ? 'none' : 'soft'}
            accessibilityLabel={cs.profile.edit.save}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  flex: { flex: 1 },

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
    fontSize: 22,
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
    gap: Spacing.sm,
  },

  // ── Section header ──
  sectionHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.sm,
    marginLeft: 2,
  },

  // ── Avatar card ──
  avatarCard: {
    alignItems: 'center',
    gap: Spacing.lg,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  avatarTap: {
    position: 'relative',
  },
  // Amber "edit" badge pinned to the avatar's bottom-right corner.
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    borderWidth: 3,
    borderColor: Colors.stout2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  avatarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: Radius.pill,
    paddingHorizontal: 18,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  avatarBtnPrimary: {
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  avatarBtnPrimaryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.amber,
  },
  avatarBtnText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },

  // ── Input ──
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
    marginLeft: 2,
  },

  // ── Visibility card ──
  consentCard: {
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
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

  // ── Sticky save bar ──
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.stout,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  pressed: {
    opacity: 0.7,
  },
});
