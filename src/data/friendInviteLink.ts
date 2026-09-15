/**
 * Invite deep-link plumbing (Parta 3.0 §A5).
 *
 * Growth invites arrive as a link the user taps: the custom scheme
 * `napivo://parta/pozvanka?code=<code>` (kept for compatibility) or the public
 * web landing `https://na-pivo.cz/p/<code>`. This module owns the JS half of the
 * claim flow so the UI route can stay thin:
 *   - parse the code out of either URL shape,
 *   - stash it until the (auto-created) anonymous account is ready,
 *   - claim it (send the friend request) and raise the pending-request UX signal.
 *
 * The link carries only an opaque random code — never the inviter's account id,
 * nickname, or any PII (the identity is resolved server-side after auth). All
 * helpers are best-effort and never throw.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { sendFriendRequest, type FriendActionResult } from './friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from './friendsQueue';
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
  // 1. ?code=<code> query param (custom scheme, and web fallback if present).
  const query = /[?&]code=([^&#\s]+)/.exec(url);
  if (query?.[1]) {
    const decoded = decodeURIComponent(query[1]).trim();
    return decoded.length > 0 ? decoded : null;
  }
  // 2. web landing path form https://na-pivo.cz/p/<code>.
  const path = /\/p\/([A-Za-z0-9_-]+)/.exec(url);
  if (path?.[1]) {
    const code = path[1].trim();
    return code.length > 0 ? code : null;
  }
  return null;
}

/** Persist an invite code until the account is ready to claim it. Never throws. */
export async function stashPendingInviteCode(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_INVITE_CODE_KEY, code);
  } catch {
    // A cold-start invite that fails to persist simply isn't auto-claimed.
  }
}

/** Read the stashed invite code without clearing it. Never throws. */
export async function peekPendingInviteCode(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PENDING_INVITE_CODE_KEY);
  } catch {
    return null;
  }
}

/** Read AND clear the stashed invite code (one-shot). Never throws. */
export async function consumePendingInviteCode(): Promise<string | null> {
  try {
    const code = await AsyncStorage.getItem(PENDING_INVITE_CODE_KEY);
    if (code) await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY);
    return code;
  } catch {
    return null;
  }
}

/** Clear any stashed invite code (e.g. after a manual dismiss). Never throws. */
export async function clearPendingInviteCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY);
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
export async function claimInviteCode(code: string): Promise<FriendActionResult> {
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

/**
 * Launch-time helper: if an invite code was stashed before the account existed,
 * consume and claim it now. Returns the claim result, or null when nothing was
 * pending.
 */
export async function consumeAndClaimPendingInviteCode(): Promise<FriendActionResult | null> {
  const code = await peekPendingInviteCode();
  if (!code) return null;
  const result = await claimInviteCode(code);
  if (result.ok || !isRetriableFriendError(result)) {
    await clearPendingInviteCode();
  }
  return result;
}
