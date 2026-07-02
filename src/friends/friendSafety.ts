/**
 * Shared safety-action menu for Parta surfaces (Parta 3.0 §G1).
 *
 * The block / report flow is reachable from several places — the friend profile
 * overflow, a long-press on a friend or feed row, and a card header — so the
 * confirm-and-fire logic lives here once. Report reuses the existing
 * `reportProfileContent` account action; block calls the new `blockFriend`
 * endpoint and asks the caller to refresh via `onChanged`.
 */

import { useCallback } from 'react';
import { Alert } from 'react-native';

import { blockFriend, type FriendProfile } from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';

/** `@nickname` (preferred) → display name → a friendly fallback. */
function nameOf(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kamarád';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kamarád';
}

/**
 * Returns an `openSafetyMenu(profile)` that pops the report/block action sheet
 * (each with its own confirmation). `onChanged` fires after a successful block so
 * the caller can drop the now-removed friend from view.
 */
export function useFriendSafety(onChanged?: () => void) {
  const showToast = useToastStore((s) => s.show);
  const reportProfileContent = useAccountStore((s) => s.reportProfileContent);

  return useCallback(
    (profile: FriendProfile) => {
      if (!profile?.id) return;
      const name = nameOf(profile);

      const confirmReport = () => {
        Alert.alert(cs.profile.report.confirmTitle, cs.profile.report.confirmBody(name), [
          { text: cs.common.cancel, style: 'cancel' },
          {
            text: cs.profile.report.confirmSubmit,
            style: 'destructive',
            onPress: () => {
              void reportProfileContent({
                targetAccountId: profile.id,
                reason: 'other',
                comment: name,
              }).then((res) => {
                showToast(res.ok ? cs.friends.reportDone : res.detail || cs.profile.edit.errorGeneric);
              });
            },
          },
        ]);
      };

      const confirmBlock = () => {
        Alert.alert(cs.friends.blockTitle(name), cs.friends.blockBody, [
          { text: cs.common.cancel, style: 'cancel' },
          {
            text: cs.friends.blockConfirm,
            style: 'destructive',
            onPress: () => {
              void blockFriend(profile.id).then((res) => {
                if (res.ok) {
                  showToast(cs.friends.blocked);
                  onChanged?.();
                } else {
                  showToast(res.detail);
                }
              });
            },
          },
        ]);
      };

      Alert.alert(cs.friends.rowActionsTitle, undefined, [
        { text: cs.friends.reportAction, onPress: confirmReport },
        { text: cs.friends.blockAction, style: 'destructive', onPress: confirmBlock },
        { text: cs.common.cancel, style: 'cancel' },
      ]);
    },
    [onChanged, reportProfileContent, showToast],
  );
}
