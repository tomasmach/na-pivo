import {
  parseFriendInviteCodeFromUrl,
  parsePartyInviteCodeFromUrl,
} from './inviteUrl';

export type InviteSystemIntent =
  | { kind: 'friend'; code: string }
  | { kind: 'party'; code: string }
  | null;

export function inviteSystemIntent(path: string): InviteSystemIntent {
  try {
    const friendCode = parseFriendInviteCodeFromUrl(path);
    if (friendCode) return { kind: 'friend', code: friendCode };
    const partyCode = parsePartyInviteCodeFromUrl(path);
    return partyCode ? { kind: 'party', code: partyCode } : null;
  } catch {
    return null;
  }
}

/**
 * Turns the two public invite URL families into routes Expo Router owns.
 * Everything else stays untouched so ordinary app routes and links keep their
 * normal router semantics.
 */
export function canonicalizeInviteSystemPath(
  path: string,
  inviteRequestId: string,
  intent: InviteSystemIntent = inviteSystemIntent(path),
): string {
  try {
    if (intent?.kind === 'friend') {
      return `/parta/pozvanka?code=${encodeURIComponent(intent.code)}`;
    }

    if (intent?.kind === 'party') {
      return (
        `/party-live?joinCode=${encodeURIComponent(intent.code)}` +
        `&invite=${encodeURIComponent(inviteRequestId)}`
      );
    }

    return path;
  } catch {
    return path;
  }
}
