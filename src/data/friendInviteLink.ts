/**
 * Invite deep-link plumbing (Parta 3.0 §A5).
 *
 * Growth invites arrive as a link the user taps: the custom scheme
 * `napivo://parta/pozvanka?code=<code>` (kept for compatibility) or the public
 * web landing `https://na-pivo.cz/p/<code>`. This module owns the JS half of the
 * claim flow so the UI route can stay thin:
 *   - parse the code out of either URL shape,
 *   - stash it until the user confirms on the claim screen (its CTA claims and
 *     clears it; backing out clears it).
 *
 * The link carries only an opaque random code — never the inviter's account id,
 * nickname, or any PII (the identity is resolved server-side after auth). All
 * helpers are best-effort and never throw.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { sendFriendRequest, type FriendActionResult } from './friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from './friendsQueue';
import {
  PrivateAccountMutationFrozenError,
  runPrivateAccountMutation,
} from './privateAccountBoundary';
import { usePartaSignalStore } from '@/stores/partaSignalStore';

const PENDING_INVITE_CODE_KEY = 'na-pivo-pending-invite-code';

function inviteRequestKey(code: string): string {
  return `invite:${code}`;
}

/**
 * Extract the invite code from a deep link. Handles both the custom-scheme
 * `?code=` form and the web-landing `/p/<code>` path. Returns null when the URL
 * carries no code.
 */
export function parseInviteCodeFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  // Only the dedicated friend-invite route may claim `?code=`. Party-table
  // links carry a code too and must never be mistaken for a friend request.
  const custom = /^napivo:\/\/parta\/pozvanka(?:[?#]|$)/i.test(url);
  const query = custom ? /[?&]code=([^&#\s]+)/.exec(url) : null;
  if (query?.[1]) {
    try {
      const decoded = decodeURIComponent(query[1]).trim();
      return decoded.length > 0 ? decoded : null;
    } catch {
      return null;
    }
  }
  // 2. web landing path form https://na-pivo.cz/p/<code>.
  const path = /^https:\/\/na-pivo\.cz\/p\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i.exec(url);
  if (path?.[1]) {
    const code = path[1].trim();
    return code.length > 0 ? code : null;
  }
  return null;
}

/**
 * Latest-invocation-wins sequencing for the stashed invite code: each
 * stash/clear records its intent synchronously, BEFORE any await and before
 * the private-account mutation captures its lease, so a slower older write can
 * never land last. A stale completion reconciles storage to the newest desired
 * state inside its own already-captured mutation — no queued mutations and no
 * fresh mutations started from a stale completion.
 */
let pendingInviteWriteSequence = 0;
let latestPendingInviteIntent: { sequence: number; code: string | null } | null = null;

async function applyAndReconcilePendingInviteWrite(
  sequence: number,
  requestedCode: string | null,
): Promise<void> {
  if (requestedCode === null) {
    await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY);
  } else {
    await AsyncStorage.setItem(PENDING_INVITE_CODE_KEY, requestedCode);
  }
  const latest = latestPendingInviteIntent;
  if (!latest || latest.sequence <= sequence) return;
  // This invocation is stale: settle storage to the newest desired state.
  if (latest.code === null) {
    await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY);
  } else {
    await AsyncStorage.setItem(PENDING_INVITE_CODE_KEY, latest.code);
  }
}

/** Persist an invite code until the account is ready to claim it. Never throws. */
export async function stashPendingInviteCode(code: string): Promise<void> {
  const sequence = ++pendingInviteWriteSequence;
  latestPendingInviteIntent = { sequence, code };
  try {
    await runPrivateAccountMutation(() => applyAndReconcilePendingInviteWrite(sequence, code));
  } catch {
    // A cold-start invite that fails to persist simply isn't restored later.
  }
}

/** Read the stashed invite code without clearing it. Never throws. */
export async function peekPendingInviteCode(): Promise<string | null> {
  try {
    return await runPrivateAccountMutation(async () =>
      AsyncStorage.getItem(PENDING_INVITE_CODE_KEY),
    );
  } catch {
    return null;
  }
}

/** Clear any stashed invite code (e.g. after a manual dismiss). Never throws. */
export async function clearPendingInviteCode(): Promise<void> {
  const sequence = ++pendingInviteWriteSequence;
  latestPendingInviteIntent = { sequence, code: null };
  try {
    await runPrivateAccountMutation(() => applyAndReconcilePendingInviteWrite(sequence, null));
  } catch {
    // Nothing to do.
  }
}

/**
 * Claim an invite code: send the friend request, and on success (or a queued
 * transient failure) raise the pending-request UX signal so FriendsScreen
 * refreshes and shows the new outgoing/accepted state. Returns `{ ok: true }`
 * once the request is either delivered or durably queued.
 */
async function claimInviteCodeWithinBoundary(code: string): Promise<FriendActionResult> {
  const result = await sendFriendRequest({ inviteCode: code });
  if (result.ok) {
    usePartaSignalStore.getState().requestRefresh();
  }
  if (!result.ok && isRetriableFriendError(result)) {
    await enqueueFriendOp({ op: 'request', key: inviteRequestKey(code), inviteCode: code });
    usePartaSignalStore.getState().requestRefresh();
    return { ok: true };
  }
  return result;
}

const ACCOUNT_TRANSITION_ERROR: FriendActionResult = {
  ok: false,
  code: 'account_transition',
  detail: 'Účet se právě mění. Pozvánku zkus za chvilku znovu.',
};

/** True when the backend accepted the invite immediately (additive outcome). */
export function isInviteClaimAccepted(result: FriendActionResult): boolean {
  return result.ok && result.status === 'accepted';
}

export type InviteClaimState = 'loading' | 'self' | 'valid';

/**
 * Pure claim-state decision for a resolved, valid inviter: stays 'loading'
 * while the own account id is not hydrated yet (the screen keeps its loading
 * copy and no actionable CTA), then collapses to exactly one of 'self' (the
 * user opened their own code) or 'valid'.
 */
export function inviteClaimState(
  inviterId: string | null,
  ownAccountId: string | null,
): InviteClaimState {
  if (!inviterId || !ownAccountId) return 'loading';
  return inviterId === ownAccountId ? 'self' : 'valid';
}

/**
 * Where the claim screen lands after a delivered-or-queued claim: straight to
 * friends when the backend accepted immediately, otherwise to the outgoing
 * requests (a pending request or one still sitting in the offline queue).
 * Permanent failures never route — the screen keeps showing the error.
 */
export function inviteClaimRoute(result: FriendActionResult): string {
  return isInviteClaimAccepted(result)
    ? '/friends/parta/people?focus=friends'
    : '/friends/parta/people?focus=outgoing';
}

export async function claimInviteCode(code: string): Promise<FriendActionResult> {
  try {
    return await runPrivateAccountMutation(async () =>
      claimInviteCodeWithinBoundary(code),
    );
  } catch (error) {
    if (error instanceof PrivateAccountMutationFrozenError) return ACCOUNT_TRANSITION_ERROR;
    return ACCOUNT_TRANSITION_ERROR;
  }
}
