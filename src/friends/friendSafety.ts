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

import { showAppDialog } from '@/components/shared/AppDialog';
import { blockFriend, type FriendProfile } from '@/data/friendsClient';
import { t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';

/** `@nickname` (preferred) → display name → a friendly fallback. */
function nameOf(profile: FriendProfile | null | undefined): string {
  if (!profile) return t.friends.fallbackName;
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || t.friends.fallbackName;
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
        showAppDialog({
          title: t.profile.report.confirmTitle,
          message: t.profile.report.confirmBody(name),
          buttons: [
            { text: t.common.cancel, style: 'cancel' },
            {
              text: t.profile.report.confirmSubmit,
              style: 'destructive',
              onPress: () => {
                void reportProfileContent({
                  targetAccountId: profile.id,
                  reason: 'other',
                  comment: name,
                }).then((res) => {
                  showToast(res.ok ? t.friends.reportDone : res.detail || t.profile.edit.errorGeneric);
                });
              },
            },
          ],
        });
      };

      const confirmBlock = () => {
        showAppDialog({
          title: t.friends.blockTitle(name),
          message: t.friends.blockBody,
          buttons: [
            { text: t.common.cancel, style: 'cancel' },
            {
              text: t.friends.blockConfirm,
              style: 'destructive',
              onPress: () => {
                void blockFriend(profile.id).then((res) => {
                  if (res.ok) {
                    showToast(t.friends.blocked);
                    onChanged?.();
                  } else {
                    showToast(res.detail);
                  }
                });
              },
            },
          ],
        });
      };

      showAppDialog({
        title: t.friends.rowActionsTitle,
        buttons: [
          { text: t.friends.reportAction, onPress: confirmReport },
          { text: t.friends.blockAction, style: 'destructive', onPress: confirmBlock },
          { text: t.common.cancel, style: 'cancel' },
        ],
      });
    },
    [onChanged, reportProfileContent, showToast],
  );
}
