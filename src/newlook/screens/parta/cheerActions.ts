import { cheerFriend, clearFriendCheer } from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t } from '@/i18n';

import { toast } from '../../ui/store';
import { usePartaStore } from './partaStore';

function patchRow(accountId: string, mine: boolean, cheers?: number) {
  usePartaStore.getState().setDashboard((d) => ({
    ...d,
    presence: d.presence.map((p) =>
      p.account.id !== accountId
        ? p
        : {
            ...p,
            myReaction: mine ? 'cheers' : null,
            reactions: { cheers: cheers ?? Math.max(0, (p.reactions?.cheers ?? 0) + (mine ? 1 : -1)) },
          },
    ),
  }));
}

/** "Na zdraví" to a friend sitting out, and a second tap takes it back. Offline it waits in the queue. */
export async function toggleCheer(accountId: string): Promise<void> {
  const row = usePartaStore.getState().dashboard?.presence.find((p) => p.account.id === accountId);
  if (!row) return;
  const next = row.myReaction !== 'cheers';
  trackUiInteraction('parta_reaction_add', next ? 'select' : 'toggle_off');
  patchRow(accountId, next);
  const res = next ? await cheerFriend(accountId) : await clearFriendCheer(accountId);
  if (res.ok) {
    patchRow(accountId, next, res.reactions.cheers);
    if (next) toast({ kind: 'saved', title: t.nv.parta.cheered, icon: 'beer' });
    return;
  }
  if (isRetriableFriendError(res)) {
    await enqueueFriendOp(next ? { op: 'friend-cheer', accountId } : { op: 'friend-cheer-clear', accountId });
    // Taking a cheer back says nothing online either, so offline it stays quiet too.
    if (next) toast({ kind: 'offline', title: t.nv.parta.cheerOffline, sub: t.nv.parta.cheerOfflineSub, icon: 'cloud-off' });
    return;
  }
  patchRow(accountId, !next);
  toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
}
