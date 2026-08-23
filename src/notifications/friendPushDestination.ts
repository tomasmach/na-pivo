import type { FriendTapPayload } from './pubReminderNotifications';
import type { InviteNavigationCoordinator } from '@/data/inviteNavigation';

function query(path: string, params: Record<string, string | null>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (entries.length === 0) return path;
  return `${path}?${entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}

/** One resolver shared by warm taps and cold starts. */
export function friendPushDestination(payload?: FriendTapPayload): string {
  switch (payload?.kind) {
    case 'friend_request':
      return query('/friends/parta/people', {
        focus: 'requests',
        friendshipId: payload.friendshipId,
      });
    case 'friend_accepted':
      return '/friends/parta/people?focus=friends';
    case 'friend_at_pub':
      return query('/friends/parta', { focus: 'presence', activityId: payload.activityId });
    case 'friend_plan':
      return query('/friends/parta', { focus: 'plans', activityId: payload.activityId });
    case 'friend_rsvp':
    case 'friend_cheers':
      return query('/friends/parta', { focus: 'activity', activityId: payload.activityId });
    default:
      return '/friends/parta';
  }
}

/** Claim process ownership before the caller performs the router push. */
export function claimFriendPushDestination(
  coordinator: InviteNavigationCoordinator,
  payload?: FriendTapPayload,
): string {
  coordinator.handleExplicitEntry(
    `notification:${payload?.notificationId ?? `friend-${Date.now()}`}`,
  );
  return friendPushDestination(payload);
}
